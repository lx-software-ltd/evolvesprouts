"""OpenRouter invoice parser integration via AWS proxy."""

from __future__ import annotations

import base64
import json
import math
import os
import re
import time
from typing import Any
from collections.abc import Mapping, Sequence

from app.services.aws_clients import get_s3_client, get_secretsmanager_client
from app.services.openrouter_json_parse import loads_openrouter_json
from app.services.secrets import SECRETS_CACHE_TTL_SECONDS
from app.services.aws_proxy import http_invoke
from app.utils.logging import get_logger

logger = get_logger(__name__)

_api_key_cache: tuple[str, float] | None = None
_PDF_PLUGIN_ID = "file-parser"
_DEFAULT_PDF_ENGINE = "mistral-ocr"

# Transient upstream failures that are worth a fast retry inside the same
# Lambda invocation. These cover provider rate limits (429), gateway
# timeouts (504), and other temporarily-unavailable responses both as HTTP
# status codes and as the ``error.code`` field that OpenRouter sometimes
# returns inside a 200 envelope (for example ``code=504`` when the upstream
# model timed out but the OpenRouter edge replied 200).
_RETRYABLE_HTTP_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
_RETRYABLE_ENVELOPE_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})
_MAX_RETRY_ATTEMPTS = 3  # initial attempt + 2 retries
# Exponential backoff between attempts (seconds): ``[i]`` is the wait BEFORE
# attempt ``i + 2``. Length must be at least ``_MAX_RETRY_ATTEMPTS - 1``.
_RETRY_BACKOFF_SCHEDULE_SECONDS: tuple[float, ...] = (2.0, 4.0)
_MAX_RETRY_AFTER_SECONDS = 5.0


def parse_invoice_from_assets(assets: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Parse invoice details from expense attachment assets.

    Single OpenRouter chat completion (with internal retry on transient
    upstream errors), then parse the result. This is intentionally the same
    one-call shape as the original synchronous parser at PR #1624 / commit
    b6f8990b that was working before the bulk-import flow moved to async —
    layered engine fallbacks were tried and rolled back because they
    amplify rate limits and introduce more failure modes than they fix.
    Unescaped-quote ``JSONDecodeError`` cases are still handled by
    ``loads_openrouter_json`` instead of by forcing JSON mode.
    """
    if not assets:
        raise ValueError("At least one asset is required for parsing")

    logger.info("Starting invoice parse", extra={"asset_count": len(assets)})
    content: list[dict[str, Any]] = [{"type": "text", "text": _schema_prompt()}]
    for asset in assets:
        content.append(_build_attachment_content(asset))

    has_pdf = any(
        _normalize_content_type(asset) == "application/pdf" for asset in assets
    )
    body = _openrouter_chat_completion(
        system_prompt="You extract invoice data and return strict JSON only.",
        user_content_blocks=content,
        has_pdf_attachment=has_pdf,
        timeout=30,
    )
    parsed = _parse_completion_body(body)
    logger.info("Invoice parse completed successfully")
    return _normalize_result(parsed)


_MAX_BULK_INVOICES = 100


def parse_bulk_expense_invoices_from_assets(
    assets: Sequence[Mapping[str, Any]],
    *,
    timeout: int = 25,
) -> list[dict[str, Any]]:
    """Parse many invoice rows from one combined PDF (or images) via OpenRouter.

    Returns a list of normalized invoice dicts (same shape as
    ``parse_invoice_from_assets``). Mirrors the single-invoice parser's call
    pattern exactly — one OpenRouter chat completion, the same system prompt,
    the configured PDF engine.

    If the bulk attempt fails for any reason (empty model response, refusal,
    JSON parse failure, HTTP error, or zero rows) this falls back to
    ``parse_invoice_from_assets`` and returns its result wrapped as a
    one-element list. The acceptance criterion the user has stated repeatedly
    is "make bulk work as well as single"; this guarantees that whenever the
    single-invoice parser can extract anything from the PDF, the bulk parser
    returns at least that one row instead of failing the whole import.
    """
    if not assets:
        raise ValueError("At least one asset is required for parsing")

    logger.info("Starting bulk invoice parse", extra={"asset_count": len(assets)})
    content: list[dict[str, Any]] = [{"type": "text", "text": _bulk_schema_prompt()}]
    for asset in assets:
        content.append(_build_attachment_content(asset))

    has_pdf = any(
        _normalize_content_type(asset) == "application/pdf" for asset in assets
    )

    bulk_error: Exception | None = None
    raw_invoices: list[dict[str, Any]] = []
    try:
        body = _openrouter_chat_completion(
            system_prompt="You extract invoice data and return strict JSON only.",
            user_content_blocks=content,
            has_pdf_attachment=has_pdf,
            timeout=timeout,
        )
        raw_invoices = _parse_bulk_invoices_payload(body)
    except RuntimeError as exc:
        bulk_error = exc
        logger.warning(
            "Bulk parse failed; will fall back to single-invoice parser",
            extra={"error": repr(exc)},
        )

    if raw_invoices:
        if len(raw_invoices) > _MAX_BULK_INVOICES:
            raise RuntimeError(
                f"Parser returned too many invoices (max {_MAX_BULK_INVOICES})"
            )
        normalized = [_normalize_result(entry) for entry in raw_invoices]
        logger.info(
            "Bulk invoice parse completed successfully",
            extra={"invoice_count": len(normalized)},
        )
        return normalized

    logger.info(
        "Bulk parse produced no rows; falling back to single-invoice parser",
        extra={"bulk_error": repr(bulk_error) if bulk_error is not None else None},
    )
    try:
        single_result = parse_invoice_from_assets(assets)
    except Exception as single_exc:
        if bulk_error is not None:
            raise RuntimeError(
                f"Bulk parse failed: {bulk_error}; single-invoice fallback "
                f"also failed: {single_exc}"
            ) from single_exc
        raise RuntimeError(
            "Parser found no invoice rows in this document, and the "
            f"single-invoice fallback also failed: {single_exc}"
        ) from single_exc

    logger.info(
        "Bulk parse completed via single-invoice fallback",
        extra={"invoice_count": 1},
    )
    return [single_result]


def _openrouter_chat_completion(
    *,
    system_prompt: str,
    user_content_blocks: list[dict[str, Any]],
    has_pdf_attachment: bool,
    timeout: int,
) -> str:
    """POST to OpenRouter and return the raw HTTP response body string.

    Note: this intentionally does NOT set ``response_format={"type":
    "json_object"}``. JSON mode was added in commit ``3874b3b6`` to mask a
    ``JSONDecodeError`` triggered by unescaped quotes in line-item
    descriptions, but it caused models to emit empty ``{}`` /
    ``completion_tokens=0`` on borderline PDFs (a worse failure shape).
    The same JSONDecodeError it was meant to mask is now handled by the
    ``loads_openrouter_json`` pathway, so we drop JSON mode and let the model
    emit natural JSON the same way it did in the original synchronous
    parser at commit ``b6f8990b``.
    """
    endpoint_url = _require_env("OPENROUTER_CHAT_COMPLETIONS_URL")
    model = _require_env("OPENROUTER_MODEL")
    api_key = _get_api_key()

    payload: dict[str, Any] = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content_blocks},
        ],
    }
    if has_pdf_attachment:
        payload["plugins"] = [
            {
                "id": _PDF_PLUGIN_ID,
                "pdf": {"engine": _pdf_parser_engine()},
            }
        ]

    serialized_payload = json.dumps(payload)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    last_status: int = 0
    last_body: str = ""
    last_envelope_code: int | None = None
    for attempt in range(1, _MAX_RETRY_ATTEMPTS + 1):
        response = http_invoke(
            method="POST",
            url=endpoint_url,
            headers=headers,
            body=serialized_payload,
            timeout=timeout,
        )

        status_code = int(response.get("status", 0) or 0)
        body = str(response.get("body", "") or "")
        last_status = status_code
        last_body = body

        http_retryable = (
            status_code < 200 or status_code >= 300
        ) and status_code in _RETRYABLE_HTTP_STATUSES

        envelope_code: int | None = None
        if 200 <= status_code < 300:
            envelope_code = _envelope_error_code(body)
        envelope_retryable = (
            envelope_code is not None and envelope_code in _RETRYABLE_ENVELOPE_CODES
        )
        last_envelope_code = envelope_code

        if (http_retryable or envelope_retryable) and attempt < _MAX_RETRY_ATTEMPTS:
            response_headers = response.get("headers")
            delay = _retry_delay_seconds(response_headers, attempt)
            preview = _format_openrouter_error_preview(body)
            logger.warning(
                "OpenRouter transient error; retrying",
                extra={
                    "attempt": attempt,
                    "status_code": status_code,
                    "envelope_error_code": envelope_code,
                    "delay_seconds": delay,
                    "response_preview": preview or None,
                },
            )
            time.sleep(delay)
            continue

        if status_code < 200 or status_code >= 300:
            preview = _format_openrouter_error_preview(body)
            logger.warning(
                "OpenRouter request failed",
                extra={
                    "status_code": status_code,
                    "response_preview": preview or None,
                    "attempts": attempt,
                },
            )
            detail = f": {preview}" if preview else ""
            raise RuntimeError(
                f"OpenRouter request failed with status {status_code}{detail}"
            )
        return body

    preview = _format_openrouter_error_preview(last_body)
    detail = f": {preview}" if preview else ""
    if last_status < 200 or last_status >= 300:
        raise RuntimeError(
            f"OpenRouter request failed with status {last_status}{detail}"
        )
    if last_envelope_code is not None:
        raise RuntimeError(
            f"OpenRouter returned transient error (code={last_envelope_code}){detail}"
        )
    raise RuntimeError(f"OpenRouter request failed{detail}")


def _envelope_error_code(body: str) -> int | None:
    """Return the integer ``error.code`` from a 2xx OpenRouter body, or ``None``.

    OpenRouter sometimes responds with HTTP 200 but a body of the form
    ``{"error": {"message": "...", "code": 504}, ...}`` when the upstream
    model call failed at the edge (gateway timeout, provider rate limit,
    etc). Treat those identically to the matching HTTP status for retry
    purposes.
    """
    if not body:
        return None
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    err = payload.get("error")
    if not isinstance(err, dict):
        return None
    code = err.get("code")
    if isinstance(code, bool):
        return None
    if isinstance(code, int):
        return code
    if isinstance(code, str) and code.strip().lstrip("-").isdigit():
        try:
            return int(code.strip())
        except ValueError:
            return None
    return None


def _retry_delay_seconds(response_headers: Any, attempt: int) -> float:
    """Return the backoff delay before the next attempt, honoring ``Retry-After``.

    ``attempt`` is the 1-indexed attempt that just failed (so the next
    attempt is ``attempt + 1``). Without an explicit ``Retry-After``, the
    delay is taken from the exponential schedule
    ``_RETRY_BACKOFF_SCHEDULE_SECONDS`` (e.g. 2s, 4s, ...). The schedule is
    indexed by ``attempt - 1``; if the schedule is shorter than the number
    of retries, the last value is reused.
    """
    if isinstance(response_headers, Mapping):
        for key, value in response_headers.items():
            if isinstance(key, str) and key.lower() == "retry-after":
                parsed = _parse_retry_after_seconds(value)
                if parsed is not None:
                    return min(max(parsed, 0.0), _MAX_RETRY_AFTER_SECONDS)
                break
    if not _RETRY_BACKOFF_SCHEDULE_SECONDS:
        return 0.0
    idx = max(0, attempt - 1)
    if idx >= len(_RETRY_BACKOFF_SCHEDULE_SECONDS):
        idx = len(_RETRY_BACKOFF_SCHEDULE_SECONDS) - 1
    return float(_RETRY_BACKOFF_SCHEDULE_SECONDS[idx])


def _parse_retry_after_seconds(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, int | float) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def _format_openrouter_error_preview(body: str) -> str:
    """Return a short, human-readable summary of an OpenRouter error body.

    OpenRouter typically returns ``{"error": {"message": "...", "code": N,
    "metadata": {...}}, "user_id": "..."}`` on 4xx/5xx responses. Surface only
    the actionable message + code so the persisted bulk-import job row stays
    readable and does not leak unrelated fields like ``user_id`` or the full
    metadata blob.
    """
    text = body.strip()
    if not text:
        return ""
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        flat = text.replace("\n", " ").replace("\r", " ")
        return flat[:500] + ("..." if len(flat) > 500 else "")

    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            message = str(err.get("message") or "").strip()
            code = err.get("code")
            if message and code is not None:
                return f"{message} (code={code})"
            if message:
                return message
            return json.dumps(err)[:500]
        if isinstance(err, str) and err.strip():
            return err.strip()[:500]
        msg = payload.get("message")
        if isinstance(msg, str) and msg.strip():
            return msg.strip()[:500]

    flat = text.replace("\n", " ").replace("\r", " ")
    return flat[:500] + ("..." if len(flat) > 500 else "")


def _build_attachment_content(asset: Mapping[str, Any]) -> dict[str, Any]:
    bucket = _require_env("ASSETS_BUCKET_NAME")
    max_file_bytes = _parse_max_file_bytes()

    s3_key = str(asset.get("s3_key") or "").strip()
    if not s3_key:
        raise RuntimeError("Attachment is missing s3_key")
    response = get_s3_client().get_object(Bucket=bucket, Key=s3_key)
    body = response["Body"].read()
    if len(body) > max_file_bytes:
        raise RuntimeError(f"Attachment {asset.get('id')} exceeds parser size limit")
    content_type = _normalize_content_type(asset)
    filename = str(asset.get("file_name") or "attachment")

    if content_type.startswith("image/"):
        encoded = base64.b64encode(body).decode("utf-8")
        data_url = f"data:{content_type};base64,{encoded}"
        return {
            "type": "image_url",
            "image_url": {
                "url": data_url,
            },
        }

    mime_primary = content_type.split(";", 1)[0].strip()
    if mime_primary == "text/plain":
        text = body.decode("utf-8")
        return {"type": "text", "text": text}

    encoded = base64.b64encode(body).decode("utf-8")
    data_url = f"data:{content_type};base64,{encoded}"
    return {
        "type": "file",
        "file": {
            "filename": filename,
            "file_data": data_url,
        },
    }


def _normalize_content_type(asset: Mapping[str, Any]) -> str:
    content_type = str(asset.get("content_type") or "").strip().lower()
    if content_type:
        return content_type
    lowered_name = str(asset.get("file_name") or "").lower()
    if lowered_name.endswith(".pdf"):
        return "application/pdf"
    if lowered_name.endswith(".png"):
        return "image/png"
    if lowered_name.endswith(".jpg") or lowered_name.endswith(".jpeg"):
        return "image/jpeg"
    if lowered_name.endswith(".webp"):
        return "image/webp"
    if lowered_name.endswith(".txt"):
        return "text/plain"
    return "application/octet-stream"


def _extract_message_text(body: str) -> str:
    """Pull the model-generated text out of an OpenRouter chat completion body.

    Raises ``RuntimeError`` with a diagnostic message when the response cannot
    yield usable text (top-level/per-choice error, model refusal, truncation,
    content-filter block, or empty ``content`` for any other reason). This
    avoids the previous failure mode where an empty string was passed to
    ``json.loads`` and produced ``Expecting value: line 1 column 1 (char 0)``.
    """
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise RuntimeError("OpenRouter response must be a JSON object")

    top_error = payload.get("error")
    if isinstance(top_error, dict):
        message_text = top_error.get("message") or json.dumps(top_error)[:300]
        code = top_error.get("code")
        suffix = f" (code={code})" if code is not None else ""
        raise RuntimeError(f"OpenRouter returned error: {message_text}{suffix}")
    if isinstance(top_error, str) and top_error.strip():
        raise RuntimeError(f"OpenRouter returned error: {top_error.strip()[:300]}")

    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("OpenRouter response choices are missing")
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise RuntimeError("OpenRouter response choice has invalid shape")

    choice_error = first_choice.get("error")
    if isinstance(choice_error, dict):
        message_text = choice_error.get("message") or json.dumps(choice_error)[:300]
        raise RuntimeError(f"OpenRouter choice returned error: {message_text}")

    message = first_choice.get("message")
    if not isinstance(message, dict):
        raise RuntimeError("OpenRouter response message is missing")

    refusal = message.get("refusal")
    if isinstance(refusal, str) and refusal.strip():
        raise RuntimeError(f"Model refused to extract: {refusal.strip()[:500]}")

    content = message.get("content")
    if isinstance(content, list):
        text_parts = [
            str(item.get("text"))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        raw_text = "\n".join(part for part in text_parts if part)
    else:
        raw_text = str(content or "")
    cleaned = (
        raw_text.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )
    if cleaned:
        return cleaned

    raise _empty_response_error(payload, first_choice)


def _empty_response_error(
    payload: Mapping[str, Any], first_choice: Mapping[str, Any]
) -> RuntimeError:
    """Build a diagnostic ``RuntimeError`` for an empty model response."""
    finish_reason = first_choice.get("finish_reason") or first_choice.get(
        "finishReason"
    )
    usage = payload.get("usage") if isinstance(payload, dict) else None
    completion_tokens = (
        usage.get("completion_tokens") if isinstance(usage, dict) else None
    )
    details: list[str] = []
    if finish_reason:
        details.append(f"finish_reason={finish_reason}")
    if completion_tokens is not None:
        details.append(f"completion_tokens={completion_tokens}")
    suffix = f" ({'; '.join(details)})" if details else ""

    if finish_reason == "length":
        return RuntimeError(
            f"Model output was truncated before any JSON was produced{suffix}. "
            "The document may be too long for one parse; try a smaller PDF."
        )
    if finish_reason == "content_filter":
        return RuntimeError(f"Model output was blocked by the content filter{suffix}.")
    return RuntimeError(
        f"Model returned an empty response{suffix}. The PDF may be unreadable "
        "to this engine, the model may have failed to extract any text, or "
        "the request may have been rejected upstream."
    )


def _parse_completion_body(body: str) -> dict[str, Any]:
    cleaned = _extract_message_text(body)
    parsed = loads_openrouter_json(cleaned, context="single invoice")
    if not isinstance(parsed, dict):
        raise RuntimeError("Parser response payload is not an object")
    return parsed


# Top-level keys the bulk parser will accept as "the invoices array" without
# any further inspection. Order does not matter for correctness, but ``invoices``
# and ``records`` are checked first because the prompt asks for those two.
_BULK_LIST_KEY_ALIASES = (
    "invoices",
    "records",
    "data",
    "results",
    "rows",
    "items",
    "expenses",
    "transactions",
    "charges",
    "entries",
)

# Keys that, if present on a dict, strongly suggest the dict is an invoice row.
# Used to disambiguate when the model wraps the rows under an unexpected key,
# and to wrap a single top-level invoice object as a one-row import.
_INVOICE_ROW_HINT_KEYS = (
    "vendor_name",
    "invoice_number",
    "invoice_date",
    "due_date",
    "currency",
    "subtotal",
    "tax",
    "total",
    "amount",
    "line_items",
)


def _looks_like_invoice_dict(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    return any(key in value for key in _INVOICE_ROW_HINT_KEYS)


def _coerce_bulk_invoice_list(parsed: Any) -> list[Any]:
    """Best-effort coercion of a parsed JSON value into a list of invoice rows.

    Handles common shape variations the model emits in practice: the requested
    ``{"invoices":[...]}`` shape, alias keys (``data``, ``results``, ...), an
    unknown key whose value is the only list-of-dicts in the object, multiple
    candidate lists (the most invoice-like one wins), and a single invoice
    object at the top level (wrapped as a one-row list).
    """
    if isinstance(parsed, list):
        return parsed
    if not isinstance(parsed, dict):
        raise RuntimeError("Bulk parser response payload has invalid shape")

    # JSON mode forces an object, so ``{}`` is the model's only way of saying
    # "I could not extract anything from this document". Treat it as zero rows
    # rather than a malformed wrapper so the empty-result path produces an
    # actionable message in ``parse_bulk_expense_invoices_from_assets``.
    if not parsed:
        return []

    for key in _BULK_LIST_KEY_ALIASES:
        candidate = parsed.get(key)
        if isinstance(candidate, list):
            return candidate

    list_candidates: list[list[Any]] = [
        value
        for value in parsed.values()
        if isinstance(value, list) and any(isinstance(item, dict) for item in value)
    ]
    if len(list_candidates) == 1:
        return list_candidates[0]
    if len(list_candidates) > 1:
        scored = sorted(
            (
                (sum(1 for item in lst if _looks_like_invoice_dict(item)), idx, lst)
                for idx, lst in enumerate(list_candidates)
            ),
            key=lambda triple: (-triple[0], triple[1]),
        )
        best_score, _idx, best_list = scored[0]
        if best_score > 0:
            return best_list

    if _looks_like_invoice_dict(parsed):
        return [parsed]

    keys_preview = ", ".join(sorted(parsed.keys())[:10]) or "<empty object>"
    raise RuntimeError(
        "Bulk parser response must be an array or an object with an array of "
        f"invoice rows; got top-level keys: {keys_preview}"
    )


def _parse_bulk_invoices_payload(body: str) -> list[dict[str, Any]]:
    """Parse OpenRouter envelope and return raw invoice objects for bulk import."""
    cleaned = _extract_message_text(body)
    parsed = loads_openrouter_json(cleaned, context="bulk invoices")
    raw_list = _coerce_bulk_invoice_list(parsed)

    invoices: list[dict[str, Any]] = []
    for entry in raw_list:
        if isinstance(entry, dict):
            invoices.append(entry)
    return invoices


def _normalize_result(parsed: dict[str, Any]) -> dict[str, Any]:
    line_items = parsed.get("line_items")
    normalized_line_items: list[dict[str, Any]] = []
    if isinstance(line_items, list):
        for item in line_items:
            if not isinstance(item, dict):
                continue
            normalized_line_items.append(
                {
                    "description": _optional_text(
                        item.get("description"), max_length=500
                    ),
                    "quantity": _optional_number(item.get("quantity")),
                    "unit_price": _optional_money(item.get("unit_price")),
                    "amount": _optional_money(item.get("amount")),
                }
            )

    subtotal = _optional_money(parsed.get("subtotal"))
    if subtotal is None:
        subtotal = _first_optional_money(
            parsed,
            (
                "sub_total",
                "net_amount",
                "pretax_total",
                "amount_ex_tax",
                "subtotal_ex_tax",
            ),
        )

    tax = _optional_money(parsed.get("tax"))
    if tax is None:
        tax = _first_optional_money(
            parsed,
            (
                "tax_amount",
                "gst",
                "vat",
                "sales_tax",
            ),
        )

    total = _optional_money(parsed.get("total"))
    if total is None:
        total = _first_optional_money(
            parsed,
            (
                "grand_total",
                "invoice_total",
                "total_amount",
                "amount_due",
                "balance_due",
                "balance",
                "amount",
            ),
        )

    if total is None:
        total = _sum_line_item_amounts(normalized_line_items)

    currency = _optional_currency(parsed.get("currency"))
    if currency is None and _infer_usd_from_dollar_signs(parsed):
        currency = "USD"

    return {
        "vendor_name": _optional_text(parsed.get("vendor_name"), max_length=255),
        "invoice_number": _optional_text(parsed.get("invoice_number"), max_length=128),
        "invoice_date": _optional_iso_date(parsed.get("invoice_date")),
        "due_date": _optional_iso_date(parsed.get("due_date")),
        "currency": currency,
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "line_items": normalized_line_items,
        "confidence": _optional_number(parsed.get("confidence")),
        "raw": parsed,
    }


def _get_api_key() -> str:
    global _api_key_cache
    now = time.monotonic()
    if _api_key_cache is not None:
        cached_value, loaded_at = _api_key_cache
        if now - loaded_at <= SECRETS_CACHE_TTL_SECONDS:
            return cached_value
    secret_arn = _require_env("OPENROUTER_API_KEY_SECRET_ARN")
    response = get_secretsmanager_client().get_secret_value(SecretId=secret_arn)
    secret_string = response.get("SecretString")
    if not secret_string and response.get("SecretBinary"):
        secret_string = base64.b64decode(response["SecretBinary"]).decode("utf-8")
    if not secret_string:
        raise RuntimeError("OpenRouter API key secret is empty")
    key = _extract_key(secret_string)
    _api_key_cache = (key, now)
    return key


def _extract_key(secret_string: str) -> str:
    raw = secret_string.strip()
    if not raw:
        raise RuntimeError("OpenRouter API key value is blank")
    if raw.startswith("{"):
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise RuntimeError("OpenRouter secret JSON must be an object")
        for key_name in (
            "openrouter_api_key",
            "OPENROUTER_API_KEY",
            "api_key",
            "key",
            "token",
        ):
            candidate = payload.get(key_name)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        raise RuntimeError("OpenRouter API key is missing in secret JSON")
    return raw


def _optional_text(value: Any, *, max_length: int) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized:
        return None
    return normalized[:max_length]


def _optional_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _optional_money(value: Any) -> float | None:
    """Parse a monetary field from JSON (handles formatted strings from the model)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return float(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    return _parse_money_string(str(value))


def _first_optional_money(
    parsed: dict[str, Any], keys: tuple[str, ...]
) -> float | None:
    for key in keys:
        found = _optional_money(parsed.get(key))
        if found is not None:
            return found
    return None


def _sum_line_item_amounts(line_items: list[dict[str, Any]]) -> float | None:
    """Use sum of line amounts as total only when every line has a parsed amount."""
    if not line_items:
        return None
    amounts: list[float] = []
    for item in line_items:
        raw = item.get("amount")
        if raw is None:
            return None
        parsed = _optional_money(raw)
        if parsed is None:
            return None
        amounts.append(parsed)
    return sum(amounts)


def _parse_money_string(raw: str) -> float | None:
    s = raw.strip()
    if not s:
        return None

    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg = True
        s = s[1:-1].strip()
    elif s.startswith("-"):
        neg = True
        s = s[1:].strip()

    s = re.sub(
        r"\s*(USD|EUR|GBP|AUD|NZD|CAD|HKD|CNY|JPY|CHF|SGD|INR|[A-Z]{3})\s*$",
        "",
        s,
        flags=re.IGNORECASE,
    ).strip()

    for sym in (
        "$",
        "\u00a3",
        "\u20ac",
        "\u00a5",
        "\u20b9",
        "\u00a2",
        "\u20a1",
    ):
        s = s.replace(sym, "")
    s = s.replace("\u00a0", " ").strip()

    compact = s.replace(" ", "")
    m = re.search(
        r"[+-]?(?:\d[\d.,]*\d|\d+\.\d+|\.\d+|\d+)",
        compact,
    )
    if not m:
        return None
    numeric = m.group(0)
    try:
        normalized = _normalize_decimal_grouping(numeric)
        out = float(normalized)
    except ValueError:
        return None
    return -out if neg else out


def _normalize_decimal_grouping(s: str) -> str:
    """Turn locale-style digit grouping into a float() parseable string."""
    negative = s.startswith("-")
    s = s.lstrip("+").lstrip("-")
    if not s:
        raise ValueError
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2 and parts[1].isdigit():
            lead = parts[0].replace(".", "")
            s = f"{lead}.{parts[1]}"
        else:
            s = s.replace(",", "")
    prefix = "-" if negative else ""
    return prefix + s


def _optional_iso_date(value: Any) -> str | None:
    normalized = _optional_text(value, max_length=20)
    if normalized is None:
        return None
    try:
        from datetime import date

        parsed = date.fromisoformat(normalized)
        return parsed.isoformat()
    except ValueError:
        return None


_MONETARY_STRING_KEYS = (
    "subtotal",
    "tax",
    "total",
    "grand_total",
    "invoice_total",
    "total_amount",
    "amount_due",
    "balance_due",
    "balance",
    "amount",
    "sub_total",
    "net_amount",
    "pretax_total",
    "amount_ex_tax",
    "subtotal_ex_tax",
    "tax_amount",
    "gst",
    "vat",
    "sales_tax",
)

# Dollar prefixes that are not US dollars (avoid inferring USD from these).
_DISAMBIGUATED_DOLLAR_MARKERS = (
    "HK$",
    "NT$",
    "S$",
    "SG$",
    "NZ$",
    "CA$",
    "C$",
    "A$",
    "MX$",
    "AU$",
)

_OTHER_CURRENCY_MARKERS_RE = re.compile(r"[£€¥₹\u00a3\u20ac\u00a5\u20b9]")


def _optional_currency(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    compact = raw.replace("\u00a0", " ").replace(" ", "").upper()
    if compact in {"$", "US$", "USD"}:
        return "USD"
    if re.fullmatch(r"\$+", raw.strip()):
        return "USD"
    normalized = _optional_text(raw, max_length=3)
    if normalized is None:
        return None
    letters_only = re.sub(r"[^A-Za-z]", "", normalized)
    if len(letters_only) == 3:
        return letters_only.upper()
    return None


def _infer_usd_from_dollar_signs(parsed: dict[str, Any]) -> bool:
    """True when monetary strings show $ but no other currency markers."""
    parts: list[str] = []
    for key in _MONETARY_STRING_KEYS:
        val = parsed.get(key)
        if isinstance(val, str) and val.strip():
            parts.append(val)
    line_items = parsed.get("line_items")
    if isinstance(line_items, list):
        for item in line_items:
            if not isinstance(item, dict):
                continue
            for li_key in ("amount", "unit_price"):
                val = item.get(li_key)
                if isinstance(val, str) and val.strip():
                    parts.append(val)
    if not parts:
        return False
    combined = "\n".join(parts)
    if "$" not in combined:
        return False
    upper = combined.upper()
    for marker in _DISAMBIGUATED_DOLLAR_MARKERS:
        if marker.upper() in upper:
            return False
    if _OTHER_CURRENCY_MARKERS_RE.search(combined):
        return False
    return True


def _parse_max_file_bytes() -> int:
    raw = os.getenv("OPENROUTER_MAX_FILE_BYTES", "").strip()
    if not raw:
        return 15 * 1024 * 1024
    try:
        parsed = int(raw)
    except ValueError:
        return 15 * 1024 * 1024
    return max(1, parsed)


def _pdf_parser_engine() -> str:
    configured = os.getenv("OPENROUTER_PDF_ENGINE", "").strip().lower()
    if configured in {"pdf-text", "mistral-ocr", "native"}:
        return configured
    return _DEFAULT_PDF_ENGINE


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value


def _schema_prompt() -> str:
    return (
        "Extract invoice data and return strict JSON only with shape: "
        '{"vendor_name": "string|null", "invoice_number": "string|null", '
        '"invoice_date": "YYYY-MM-DD|null", "due_date": "YYYY-MM-DD|null", '
        '"currency": "string|null", "subtotal": "number|null", "tax": "number|null", '
        '"total": "number|null", "line_items": [{"description":"string|null","quantity":"number|null",'
        '"unit_price":"number|null","amount":"number|null"}], "confidence":"number|null"}. '
        "Use null for unknown values. No markdown. No prose. "
        "For subtotal, tax, and total prefer JSON numbers; if you use strings, use "
        "plain digits only (no currency symbols or thousands separators) when possible. "
        "If the invoice shows only the $ symbol for money (not HK$, S$, etc.), set "
        "currency to USD. "
        "Input may be plain text pasted in an email body rather than a PDF or image."
    )


def _bulk_schema_prompt() -> str:
    return (
        "Extract every invoice from this document and return strict JSON only "
        "with shape: "
        '{"invoices":[{"vendor_name":"string|null",'
        '"invoice_number":"string|null","invoice_date":"YYYY-MM-DD|null",'
        '"due_date":"YYYY-MM-DD|null","currency":"string|null",'
        '"subtotal":"number|null","tax":"number|null","total":"number|null",'
        '"line_items":[{"description":"string|null","quantity":"number|null",'
        '"unit_price":"number|null","amount":"number|null"}],'
        '"confidence":"number|null"}]}. '
        "If the document contains only one invoice, return it as a "
        "single-element array. "
        "Use null for unknown values. No markdown. No prose. "
        "For subtotal, tax, and total prefer JSON numbers; if you use strings, use "
        "plain digits only (no currency symbols or thousands separators) when possible. "
        "If a row shows only the $ symbol for money (not HK$, S$, etc.), set "
        "currency to USD."
    )
