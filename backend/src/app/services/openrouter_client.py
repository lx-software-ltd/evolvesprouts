"""Shared OpenRouter chat-completions client via the AWS HTTP proxy.

Used by invoice parsing and lead close suggestions. In-VPC Lambdas must not
call OpenRouter directly; all traffic goes through ``http_invoke``.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any
from collections.abc import Mapping, Sequence

from app.services.aws_clients import get_secretsmanager_client
from app.services.aws_proxy import http_invoke
from app.services.secrets import SECRETS_CACHE_TTL_SECONDS
from app.utils.logging import get_logger

logger = get_logger(__name__)

_api_key_cache: tuple[str, float] | None = None

_RETRYABLE_HTTP_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
_RETRYABLE_ENVELOPE_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})
_MAX_RETRY_ATTEMPTS = 3
_RETRY_BACKOFF_SCHEDULE_SECONDS: tuple[float, ...] = (2.0, 4.0)
_MAX_RETRY_AFTER_SECONDS = 5.0


def require_env(name: str) -> str:
    """Return a required non-empty environment variable."""
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value


def get_openrouter_api_key() -> str:
    """Load and cache the OpenRouter API key from Secrets Manager."""
    global _api_key_cache
    now = time.monotonic()
    if _api_key_cache is not None:
        cached_value, loaded_at = _api_key_cache
        if now - loaded_at <= SECRETS_CACHE_TTL_SECONDS:
            return cached_value
    secret_arn = require_env("OPENROUTER_API_KEY_SECRET_ARN")
    response = get_secretsmanager_client().get_secret_value(SecretId=secret_arn)
    secret_string = response.get("SecretString")
    if not secret_string and response.get("SecretBinary"):
        import base64

        secret_string = base64.b64decode(response["SecretBinary"]).decode("utf-8")
    if not secret_string:
        raise RuntimeError("OpenRouter API key secret is empty")
    key = _extract_key(str(secret_string))
    _api_key_cache = (key, now)
    return key


def openrouter_chat_completion(
    *,
    system_prompt: str,
    user_content: str | Sequence[Mapping[str, Any]],
    timeout: int,
    temperature: float = 0,
    plugins: Sequence[Mapping[str, Any]] | None = None,
    max_attempts: int | None = None,
) -> str:
    """POST a chat completion and return the raw HTTP response body string.

    Intentionally does not force JSON response mode (same rationale as the
    expense parser: JSON mode can yield empty ``{}`` on borderline inputs).
    """
    endpoint_url = require_env("OPENROUTER_CHAT_COMPLETIONS_URL")
    model = require_env("OPENROUTER_MODEL")
    api_key = get_openrouter_api_key()

    user_message_content: Any
    if isinstance(user_content, str):
        user_message_content = user_content
    else:
        user_message_content = list(user_content)

    payload: dict[str, Any] = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message_content},
        ],
    }
    if plugins:
        payload["plugins"] = list(plugins)

    serialized_payload = json.dumps(payload)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    attempts = max_attempts if max_attempts is not None else _MAX_RETRY_ATTEMPTS
    if attempts < 1:
        raise ValueError("max_attempts must be at least 1")

    last_status = 0
    last_body = ""
    last_envelope_code: int | None = None
    for attempt in range(1, attempts + 1):
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

        if (http_retryable or envelope_retryable) and attempt < attempts:
            delay = _retry_delay_seconds(response.get("headers"), attempt)
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


def extract_message_text(body: str) -> str:
    """Pull assistant text from an OpenRouter chat completion response body."""
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
        raise RuntimeError(f"Model refused: {refusal.strip()[:500]}")

    content = message.get("content")
    if isinstance(content, list):
        text_parts = [
            str(item.get("text"))
            for item in content
            if isinstance(item, dict)
            and item.get("type") == "text"
            and item.get("text")
        ]
        text = "\n".join(text_parts).strip()
    elif isinstance(content, str):
        text = content.strip()
    else:
        text = ""

    if not text:
        finish_reason = first_choice.get("finish_reason")
        raise RuntimeError(
            "OpenRouter response content is empty"
            + (f" (finish_reason={finish_reason})" if finish_reason else "")
        )
    return text


def configured_model_name() -> str:
    """Return the configured OpenRouter model id (for persistence metadata)."""
    return require_env("OPENROUTER_MODEL")


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


def _envelope_error_code(body: str) -> int | None:
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
                return f"{message} (code={code})"[:500]
            if message:
                return message[:500]
            return json.dumps(err)[:500]
        if isinstance(err, str) and err.strip():
            return err.strip()[:500]
    flat = text.replace("\n", " ").replace("\r", " ")
    return flat[:500] + ("..." if len(flat) > 500 else "")
