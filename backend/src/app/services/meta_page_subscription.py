"""Detect and repair a missing Page messages webhook subscription."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

from app.services.meta_graph_client import MetaGraphApiError, graph_get, graph_post
from app.utils.logging import get_logger

logger = get_logger(__name__)

_REQUIRED_FIELDS = ("messages", "message_echoes")


def ensure_page_messages_subscription(
    *,
    page_id: str,
    token: str,
) -> dict[str, int]:
    """Ensure this app's Page subscription includes messages and echoes.

    Returns integer counter flags for the inbox import job. Failures are
    logged and recorded; they never raise.
    """
    app_id = os.getenv("META_APP_ID", "").strip()
    if not app_id:
        logger.warning(
            "META_APP_ID is not configured; skipping subscribed_apps check",
            extra={"page_id": page_id},
        )
        return {"subscription_failed": 1}
    try:
        payload = graph_get(f"{page_id}/subscribed_apps", token=token)
        current = _fields_for_app(payload, app_id=app_id)
        if current is not None and all(field in current for field in _REQUIRED_FIELDS):
            return {"subscription_ok": 1}
        merged = sorted(
            (current or set()) | set(_REQUIRED_FIELDS),
            key=str,
        )
        response = graph_post(
            f"{page_id}/subscribed_apps",
            params={"subscribed_fields": ",".join(merged)},
            token=token,
        )
        if response.get("success") is not True:
            raise MetaGraphApiError(
                status_code=502,
                message="Meta subscribed_apps POST did not return success: true",
            )
        logger.warning(
            "Repaired Meta Page subscribed_apps for this app",
            extra={"page_id": page_id, "fields": ",".join(merged)},
        )
        return {"subscription_repaired": 1}
    except MetaGraphApiError as exc:
        logger.warning(
            "Meta Page subscribed_apps check failed; continuing import",
            extra={
                "page_id": page_id,
                "status_code": exc.status_code,
                "error": str(exc)[:400],
            },
        )
        return {"subscription_failed": 1}
    except Exception:
        logger.exception(
            "Meta Page subscribed_apps check failed; continuing import",
            extra={"page_id": page_id},
        )
        return {"subscription_failed": 1}


def _fields_for_app(payload: Mapping[str, Any], *, app_id: str) -> set[str] | None:
    rows = payload.get("data")
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("id") or "").strip() != app_id:
            continue
        return _normalize_fields(row.get("subscribed_fields"))
    return None


def _normalize_fields(raw: Any) -> set[str]:
    if isinstance(raw, list):
        return {str(item).strip() for item in raw if str(item).strip()}
    if isinstance(raw, str):
        return {part.strip() for part in raw.split(",") if part.strip()}
    return set()
