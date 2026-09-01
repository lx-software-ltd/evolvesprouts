"""Backfill recent Messenger and Instagram threads from the Graph API."""

from __future__ import annotations

import os
from typing import Any
from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.db.models.enums import MetaChannel, MetaMessageDirection
from app.services.meta_graph_client import (
    MetaGraphApiError,
    graph_get,
    is_graph_payload_too_large,
    is_graph_skippable_failure,
    resolve_page_access_token,
)
from app.services.meta_ingest import is_own_instagram_handle, store_meta_message
from app.utils.logging import get_logger, mask_pii

logger = get_logger(__name__)

_SOURCE_DETAIL = "meta_history_sync"
_CONVERSATION_LIMIT = 5
_MESSAGE_LIMIT = 20
_MESSAGE_PAGE = 5
_MAX_PAGES = 80
_MESSAGE_FIELDS = "id,created_time,from{id,name,username},message"
_CONVERSATION_FIELDS = "id,participants.limit(5){id,name,username}"


def sync_meta_channel_history(
    session: Session,
    channel: MetaChannel,
) -> dict[str, int]:
    """Import the last 20 Graph messages per conversation for one channel."""
    counters = {
        "stored": 0,
        "duplicates": 0,
        "skipped": 0,
        "leads_created": 0,
        "contacts_created": 0,
        "conversations": 0,
        "skipped_no_body": 0,
    }
    page_id = os.getenv("META_PAGE_ID", "").strip()
    if not page_id:
        raise MetaGraphApiError(
            status_code=500, message="META_PAGE_ID is not configured"
        )
    self_ids = {page_id}
    instagram_user_id = os.getenv("META_INSTAGRAM_USER_ID", "").strip()
    if instagram_user_id:
        self_ids.add(instagram_user_id)

    platform = "instagram" if channel is MetaChannel.INSTAGRAM else "messenger"
    page_token = resolve_page_access_token()
    after: str | None = None
    pages = 0
    while pages < _MAX_PAGES:
        pages += 1
        try:
            payload = _list_conversation_page(
                page_id,
                platform=platform,
                after=after,
                token=page_token,
            )
        except MetaGraphApiError as exc:
            if is_graph_skippable_failure(exc) and pages > 1:
                counters["skipped"] += 1
                break
            raise
        rows = payload.get("data")
        if not isinstance(rows, list):
            break
        for row in rows:
            if isinstance(row, Mapping):
                _ingest_conversation(
                    session,
                    row,
                    channel=channel,
                    page_id=page_id,
                    self_ids=self_ids,
                    counters=counters,
                    page_token=page_token,
                )
                _commit_progress(session)
        paging = payload.get("paging")
        cursors = paging.get("cursors") if isinstance(paging, Mapping) else None
        next_after = cursors.get("after") if isinstance(cursors, Mapping) else None
        if not isinstance(next_after, str) or not next_after.strip():
            break
        after = next_after.strip()
    return counters


def _commit_progress(session: Session) -> None:
    commit = getattr(session, "commit", None)
    if callable(commit):
        commit()


def _graph_get_reducing_limit(
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


def _list_conversation_page(
    page_id: str,
    *,
    platform: str,
    after: str | None,
    token: str,
) -> dict[str, Any]:
    params = {
        "platform": platform,
        "fields": _CONVERSATION_FIELDS,
        "limit": str(_CONVERSATION_LIMIT),
    }
    if after:
        params["after"] = after
    try:
        return _graph_get_reducing_limit(
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


def _conversation_messages(
    conversation_id: str, *, token: str
) -> list[Mapping[str, Any]]:
    collected: list[Mapping[str, Any]] = []
    after: str | None = None
    while len(collected) < _MESSAGE_LIMIT:
        remaining = _MESSAGE_LIMIT - len(collected)
        params = {
            "fields": _MESSAGE_FIELDS,
            "limit": str(min(_MESSAGE_PAGE, remaining)),
        }
        if after:
            params["after"] = after
        try:
            payload = _graph_get_reducing_limit(
                f"{conversation_id}/messages",
                params=params,
                token=token,
            )
        except MetaGraphApiError as exc:
            if is_graph_payload_too_large(exc) and collected:
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
    return collected[:_MESSAGE_LIMIT]


def _ingest_conversation(
    session: Session,
    row: Mapping[str, Any],
    *,
    channel: MetaChannel,
    page_id: str,
    self_ids: set[str],
    counters: dict[str, int],
    page_token: str,
) -> None:
    conversation_id = str(row.get("id") or "").strip()
    detail = row
    if detail.get("participants") is None and conversation_id:
        try:
            fetched = graph_get(
                conversation_id,
                params={"fields": _CONVERSATION_FIELDS},
                token=page_token,
            )
        except MetaGraphApiError as exc:
            if is_graph_skippable_failure(exc):
                counters["skipped"] += 1
                return
            raise
        if fetched:
            detail = {**dict(row), **fetched}
    platform_user_id, profile_name = _counterparty(detail, self_ids=self_ids)
    if platform_user_id is None:
        counters["skipped"] += 1
        return
    if channel is MetaChannel.INSTAGRAM and is_own_instagram_handle(profile_name):
        counters["skipped"] += 1
        logger.info(
            "Skipped Instagram history thread for the configured business handle"
        )
        return
    counters["conversations"] += 1
    messages_wrapper = detail.get("messages")
    nested_rows = (
        messages_wrapper.get("data") if isinstance(messages_wrapper, Mapping) else None
    )
    if isinstance(nested_rows, list):
        message_rows = [item for item in nested_rows if isinstance(item, Mapping)]
    else:
        if not conversation_id:
            counters["skipped"] += 1
            return
        try:
            message_rows = _conversation_messages(conversation_id, token=page_token)
        except MetaGraphApiError as exc:
            if is_graph_skippable_failure(exc):
                counters["skipped"] += 1
                return
            raise
    for message_row in message_rows:
        if not isinstance(message_row, Mapping):
            counters["skipped"] += 1
            continue
        _ingest_graph_message(
            session,
            message_row,
            channel=channel,
            platform_user_id=platform_user_id,
            page_id=page_id,
            profile_name=profile_name,
            self_ids=self_ids,
            counters=counters,
        )


def _ingest_graph_message(
    session: Session,
    message_row: Mapping[str, Any],
    *,
    channel: MetaChannel,
    platform_user_id: str,
    page_id: str,
    profile_name: str | None,
    self_ids: set[str],
    counters: dict[str, int],
) -> None:
    message_id = message_row.get("id")
    if not isinstance(message_id, str) or not message_id.strip():
        counters["skipped"] += 1
        return
    sender = message_row.get("from")
    sender_id = ""
    if isinstance(sender, Mapping):
        sender_id = str(sender.get("id") or "").strip()
    is_echo = sender_id in self_ids if sender_id else False
    webhook_message = {
        "mid": message_id.strip(),
        "text": message_row.get("message"),
        "is_echo": is_echo,
        "attachments": _graph_attachments(message_row.get("attachments")),
    }
    before_stored = counters["stored"]
    store_meta_message(
        session,
        channel=channel,
        platform_user_id=platform_user_id,
        page_id=page_id,
        profile_name=profile_name,
        message=webhook_message,
        timestamp=message_row.get("created_time"),
        direction=(
            MetaMessageDirection.OUTBOUND if is_echo else MetaMessageDirection.INBOUND
        ),
        counters=counters,
        create_leads=False,
        source_detail=_SOURCE_DETAIL,
    )
    if counters["stored"] == before_stored and counters.get("skipped", 0) >= 0:
        if webhook_message.get("text") in (None, "") and not webhook_message.get(
            "attachments"
        ):
            counters["skipped_no_body"] = counters.get("skipped_no_body", 0)
    logger.debug(
        "Imported Graph inbox message",
        extra={
            "channel": channel.value,
            "platform_user_id": mask_pii(platform_user_id),
        },
    )


def _counterparty(
    row: Mapping[str, Any], *, self_ids: set[str]
) -> tuple[str | None, str | None]:
    participants = row.get("participants")
    data = participants.get("data") if isinstance(participants, Mapping) else None
    if not isinstance(data, list):
        return None, None
    for participant in data:
        if not isinstance(participant, Mapping):
            continue
        participant_id = str(participant.get("id") or "").strip()
        if not participant_id or participant_id in self_ids:
            continue
        name = participant.get("name") or participant.get("username")
        profile = name.strip() if isinstance(name, str) and name.strip() else None
        return participant_id, profile
    return None, None


def _graph_attachments(raw_value: Any) -> list[dict[str, Any]]:
    wrapper = raw_value.get("data") if isinstance(raw_value, Mapping) else raw_value
    if not isinstance(wrapper, list):
        return []
    attachments: list[dict[str, Any]] = []
    for item in wrapper:
        if not isinstance(item, Mapping):
            continue
        mime_type = item.get("mime_type") or item.get("type")
        title = item.get("name") or item.get("title")
        attachments.append(
            {
                "type": str(mime_type).split("/", 1)[0] if mime_type else "attachment",
                "payload": {"title": title} if isinstance(title, str) else {},
            }
        )
    return attachments
