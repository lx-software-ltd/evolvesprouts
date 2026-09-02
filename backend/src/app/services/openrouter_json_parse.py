"""Parse JSON from OpenRouter assistant text with optional repair retries.

Shared by lead AI suggestions, invoice parsing, and other structured-output
callers that ask models for strict JSON without ``response_format`` JSON mode.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.services.openrouter_client import (
    extract_message_text,
    openrouter_chat_completion,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)

JSON_SNIPPET_RADIUS = 80
DEFAULT_JSON_REPAIR_TIMEOUT_SECONDS = 60

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def prepare_openrouter_json_text(text: str) -> str:
    """Strip markdown fences and surrounding whitespace from model output."""
    cleaned = text.strip()
    fence = _JSON_FENCE_RE.search(cleaned)
    if fence:
        cleaned = fence.group(1).strip()
    return cleaned


def json_decode_error_snippet(text: str, error: json.JSONDecodeError) -> str:
    """Return a short slice of ``text`` around the parser failure offset."""
    offset = max(0, getattr(error, "pos", 0))
    start = max(0, offset - JSON_SNIPPET_RADIUS)
    end = min(len(text), offset + JSON_SNIPPET_RADIUS)
    snippet = text[start:end].replace("\n", "\\n").replace("\r", "\\r")
    return f"...{snippet}..."


def openrouter_json_text_candidates(text: str) -> list[str]:
    """Return ordered JSON substrings to attempt before invoking repair."""
    cleaned = prepare_openrouter_json_text(text)
    candidates = [cleaned]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        sliced = cleaned[start : end + 1]
        if sliced not in candidates:
            candidates.append(sliced)
    return candidates


def repair_openrouter_json_text(
    broken_text: str,
    parse_error: str,
    *,
    timeout: int = DEFAULT_JSON_REPAIR_TIMEOUT_SECONDS,
) -> str:
    """Ask OpenRouter to rewrite ``broken_text`` as valid JSON."""
    repair_user = (
        "The following text was supposed to be a single valid JSON document but "
        f"failed to parse with this error: {parse_error}. "
        "Return the same data as STRICT, valid JSON only. "
        "Escape any embedded double quotes inside string values. "
        "Do not add commentary, markdown, or code fences. "
        "Preserve the original keys and structure exactly.\n\n"
        "BROKEN_JSON_BEGIN\n"
        f"{broken_text}\n"
        "BROKEN_JSON_END"
    )
    body = openrouter_chat_completion(
        system_prompt="You repair malformed JSON documents and return strict JSON only.",
        user_content=repair_user,
        timeout=timeout,
        temperature=0,
    )
    return extract_message_text(body)


def loads_openrouter_json(
    text: str,
    *,
    context: str,
    timeout: int = DEFAULT_JSON_REPAIR_TIMEOUT_SECONDS,
) -> Any:
    """Parse JSON from OpenRouter assistant text, repairing once on failure.

    ``context`` is a short label for logs and error messages (for example
    ``"lead close suggestion"`` or ``"single invoice"``).
    """
    candidates = openrouter_json_text_candidates(text)
    last_error: json.JSONDecodeError | None = None
    repair_source = candidates[-1]

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as initial:
            last_error = initial
            repair_source = candidate

    if last_error is None:
        raise RuntimeError(f"No JSON object found for {context}")

    snippet = json_decode_error_snippet(repair_source, last_error)
    logger.warning(
        "OpenRouter JSON parse failed; attempting repair",
        extra={
            "context": context,
            "error": str(last_error),
            "snippet": snippet,
            "length": len(repair_source),
        },
    )
    try:
        repaired = repair_openrouter_json_text(
            repair_source,
            str(last_error),
            timeout=timeout,
        )
    except Exception as repair_exc:
        logger.warning(
            "OpenRouter JSON repair call failed",
            extra={"context": context, "error": repr(repair_exc)},
        )
        raise RuntimeError(
            f"Parser returned invalid JSON for {context}: {last_error} near {snippet}"
        ) from last_error

    for candidate in openrouter_json_text_candidates(repaired):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    try:
        return json.loads(repaired)
    except json.JSONDecodeError as after_repair:
        repaired_snippet = json_decode_error_snippet(repaired, after_repair)
        logger.warning(
            "OpenRouter JSON repair returned invalid JSON",
            extra={
                "context": context,
                "error": str(after_repair),
                "snippet": repaired_snippet,
            },
        )
        raise RuntimeError(
            f"Parser returned invalid JSON for {context} even after repair: "
            f"{after_repair} near {repaired_snippet}"
        ) from after_repair
