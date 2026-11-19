"""Detect and repair a missing Page messages webhook subscription."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.services.meta_graph_client import MetaGraphApiError, graph_get, graph_post
from app.utils.logging import get_logger

logger = get_logger(__name__)

_MESSAGES_FIELD = "messages"


def ensure_page_messages_subscription(
    *,
    page_id: str,
    token: str,
) -> dict[str, int]:
    """Ensure the Page app subscription includes ``messages``.

    Returns integer counter flags for the inbox import job. Failures are
    logged and recorded; they never raise.
    """
    try:
        payload = graph_get(f"{page_id}/subscribed_apps", token=token)
        if _messages_subscribed(payload):
            return {"subscription_ok": 1}
        graph_post(
            f"{page_id}/subscribed_apps",
            params={"subscribed_fields": _MESSAGES_FIELD},
            token=token,
        )
        logger.warning(
            "Repaired Meta Page subscribed_apps; messages was missing",
            extra={"page_id": page_id},
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


def _messages_subscribed(payload: Mapping[str, Any]) -> bool:
    rows = payload.get("data")
    if not isinstance(rows, list):
        return False
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        fields = row.get("subscribed_fields")
        if isinstance(fields, list) and _MESSAGES_FIELD in fields:
            return True
        if isinstance(fields, str) and _MESSAGES_FIELD in {
            part.strip() for part in fields.split(",")
        }:
            return True
    return False
