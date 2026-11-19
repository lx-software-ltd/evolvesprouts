"""Graph list/message fetch helpers for Meta history import."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.services.meta_graph_client import (
    MetaGraphApiError,
    graph_get,
    is_graph_partial_page_failure,
    is_graph_payload_too_large,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)

CONVERSATION_LIMIT = 5
MESSAGE_LIMIT = 20
MESSAGE_PAGE = 5
MESSAGE_FIELDS = "id,created_time,from{id,name,username},message"
CONVERSATION_FIELDS = "id,updated_time,participants.limit(5){id,name,username}"


def graph_get_reducing_limit(
    path: str,
    *,
    params: dict[str, str],
    token: str,
) -> dict[str, Any]:
    raw_limit = str(params.get("limit") or "1").strip()
    try:
        current = max(1, int(raw_limit))
    except ValueError:
        current = 1
    while True:
        attempt = dict(params)
        attempt["limit"] = str(current)
        try:
            return graph_get(path, params=attempt, token=token)
        except MetaGraphApiError as exc:
            if not is_graph_payload_too_large(exc) or current <= 1:
                raise
            current = max(1, current // 2)


def list_conversation_page(
    page_id: str,
    *,
    platform: str,
    after: str | None,
    token: str,
) -> dict[str, Any]:
    params = {
        "platform": platform,
        "fields": CONVERSATION_FIELDS,
        "limit": str(CONVERSATION_LIMIT),
    }
    if after:
        params["after"] = after
    try:
        return graph_get_reducing_limit(
            f"{page_id}/conversations",
            params=params,
            token=token,
        )
    except MetaGraphApiError as exc:
        if not is_graph_payload_too_large(exc):
            raise
        slim = dict(params)
        slim["fields"] = "id"
        slim["limit"] = "1"
        return graph_get(f"{page_id}/conversations", params=slim, token=token)


def conversation_messages(
    conversation_id: str,
    *,
    token: str,
    counters: dict[str, int],
) -> list[Mapping[str, Any]]:
    collected: list[Mapping[str, Any]] = []
    after: str | None = None
    while len(collected) < MESSAGE_LIMIT:
        remaining = MESSAGE_LIMIT - len(collected)
        params = {
            "fields": MESSAGE_FIELDS,
            "limit": str(min(MESSAGE_PAGE, remaining)),
        }
        if after:
            params["after"] = after
        try:
            payload = graph_get_reducing_limit(
                f"{conversation_id}/messages",
                params=params,
                token=token,
            )
        except MetaGraphApiError as exc:
            if collected and is_graph_partial_page_failure(exc):
                counters["skipped"] += 1
                logger.warning(
                    "Stopped Graph message paging; keeping earlier pages",
                    extra={
                        "conversation_id": conversation_id,
                        "collected": len(collected),
                        "status_code": exc.status_code,
                        "graph_error_code": exc.code,
                        "graph_error_subcode": exc.error_subcode,
                        "fbtrace_id": exc.fbtrace_id,
                    },
                )
                break
            raise
        rows = payload.get("data")
        if not isinstance(rows, list) or not rows:
            break
        collected.extend(row for row in rows if isinstance(row, Mapping))
        paging = payload.get("paging")
        cursors = paging.get("cursors") if isinstance(paging, Mapping) else None
        next_after = cursors.get("after") if isinstance(cursors, Mapping) else None
        if not isinstance(next_after, str) or not next_after.strip():
            break
        after = next_after.strip()
    return collected[:MESSAGE_LIMIT]
