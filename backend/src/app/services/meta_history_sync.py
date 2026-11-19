"""Backfill recent Messenger and Instagram threads from the Graph API."""

from __future__ import annotations

import os
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.enums import MetaChannel, MetaMessageDirection
from app.db.models.meta import MetaConversation
from app.services import meta_history_graph_fetch as graph_fetch
from app.services.meta_graph_client import (
    MetaGraphApiError,
    graph_get,
    is_graph_skippable_failure,
    resolve_page_access_token,
)
from app.services.meta_ingest import is_own_instagram_handle, store_meta_message
from app.services.meta_page_subscription import ensure_page_messages_subscription
from app.utils.logging import get_logger, mask_pii
from app.utils.validators import parse_instagram_username

logger = get_logger(__name__)

_SOURCE_DETAIL = "meta_history_sync"
_MAX_PAGES = 80
_INCREMENTAL_LOOKBACK = timedelta(hours=24)
_MAX_PAGES_COLD = 3


def sync_meta_channel_history(
    session: Session,
    channel: MetaChannel,
    *,
    incremental: bool = False,
    create_leads: bool = False,
) -> dict[str, int]:
    """Import the last 20 Graph messages per conversation for one channel."""
    counters = {
        "stored": 0,
        "duplicates": 0,
        "skipped": 0,
        "partial_threads": 0,
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
    counters.update(
        ensure_page_messages_subscription(page_id=page_id, token=page_token)
    )
    iba_id = _instagram_business_account_id(page_id, token=page_token)
    if iba_id:
        self_ids.add(iba_id)
    channel_latest = _channel_watermark(session, channel) if incremental else None
    stop_before = (
        channel_latest - _INCREMENTAL_LOOKBACK if channel_latest is not None else None
    )
    max_pages = (
        _MAX_PAGES_COLD if incremental and channel_latest is None else _MAX_PAGES
    )
    after: str | None = None
    pages = 0
    while pages < max_pages:
        pages += 1
        try:
            payload = graph_fetch.list_conversation_page(
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
        stop_paging = False
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            if stop_before is not None:
                updated = _parse_graph_datetime(row.get("updated_time"))
                if updated is not None and updated <= stop_before:
                    counters["stopped_at_watermark"] = 1
                    stop_paging = True
                    break
            _ingest_conversation(
                session,
                row,
                channel=channel,
                page_id=page_id,
                self_ids=self_ids,
                counters=counters,
                page_token=page_token,
                incremental=incremental,
                create_leads=create_leads,
            )
            _commit_progress(session)
        if stop_paging:
            break
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


def _channel_watermark(session: Session, channel: MetaChannel) -> datetime | None:
    """Latest stored conversation activity for the channel, if any."""
    statement = select(func.max(MetaConversation.last_message_at)).where(
        MetaConversation.channel == channel
    )
    value = session.execute(statement).scalar_one_or_none()
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _parse_graph_datetime(raw_value: Any) -> datetime | None:
    if not isinstance(raw_value, str) or not raw_value.strip():
        return None
    normalized = raw_value.strip().replace("Z", "+00:00")
    if len(normalized) >= 5 and normalized[-5] in "+-" and normalized[-3] != ":":
        normalized = f"{normalized[:-2]}:{normalized[-2:]}"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _instagram_business_account_id(page_id: str, *, token: str) -> str | None:
    """Return the Page-linked Instagram professional id when Graph exposes it."""
    try:
        payload = graph_get(
            page_id,
            params={"fields": "instagram_business_account"},
            token=token,
        )
    except MetaGraphApiError as exc:
        logger.warning(
            "Could not load Page instagram_business_account; continuing import",
            extra={"page_id": page_id, "status_code": exc.status_code},
        )
        return None
    account = payload.get("instagram_business_account")
    if not isinstance(account, Mapping):
        return None
    account_id = str(account.get("id") or "").strip()
    return account_id or None


def _thread_last_message_at(
    session: Session, channel: MetaChannel, platform_user_id: str
) -> datetime | None:
    statement = select(MetaConversation.last_message_at).where(
        MetaConversation.channel == channel,
        MetaConversation.platform_user_id == platform_user_id,
    )
    value = session.execute(statement).scalar_one_or_none()
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _ingest_conversation(
    session: Session,
    row: Mapping[str, Any],
    *,
    channel: MetaChannel,
    page_id: str,
    self_ids: set[str],
    counters: dict[str, int],
    page_token: str,
    incremental: bool = False,
    create_leads: bool = False,
) -> None:
    conversation_id = str(row.get("id") or "").strip()
    detail = row
    if detail.get("participants") is None and conversation_id:
        try:
            fetched = graph_get(
                conversation_id,
                params={"fields": graph_fetch.CONVERSATION_FIELDS},
                token=page_token,
            )
        except MetaGraphApiError as exc:
            if is_graph_skippable_failure(exc):
                counters["skipped"] += 1
                logger.warning(
                    "Skipped Graph conversation detail fetch",
                    extra={
                        "conversation_id": conversation_id,
                        "status_code": exc.status_code,
                        "graph_error_code": exc.code,
                        "graph_error_subcode": exc.error_subcode,
                        "fbtrace_id": exc.fbtrace_id,
                    },
                )
                return
            raise
        if fetched:
            detail = {**dict(row), **fetched}
    platform_user_id, profile_name, instagram_handle = _counterparty(
        detail, self_ids=self_ids
    )
    if platform_user_id is None:
        counters["skipped"] += 1
        return
    if channel is MetaChannel.INSTAGRAM and (
        is_own_instagram_handle(profile_name)
        or is_own_instagram_handle(instagram_handle)
    ):
        counters["skipped"] += 1
        logger.info(
            "Skipped Instagram history thread for the configured business handle"
        )
        return
    if incremental:
        thread_wm = _thread_last_message_at(session, channel, platform_user_id)
        updated = _parse_graph_datetime(detail.get("updated_time"))
        if thread_wm is not None and updated is not None and updated <= thread_wm:
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
            message_rows = graph_fetch.conversation_messages(
                conversation_id,
                token=page_token,
                counters=counters,
            )
        except MetaGraphApiError as exc:
            if is_graph_skippable_failure(exc):
                counters["skipped"] += 1
                logger.warning(
                    "Skipped Graph conversation message fetch",
                    extra={
                        "conversation_id": conversation_id,
                        "status_code": exc.status_code,
                        "graph_error_code": exc.code,
                        "graph_error_subcode": exc.error_subcode,
                        "fbtrace_id": exc.fbtrace_id,
                    },
                )
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
            instagram_handle=instagram_handle,
            self_ids=self_ids,
            counters=counters,
            create_leads=create_leads,
        )


def _ingest_graph_message(
    session: Session,
    message_row: Mapping[str, Any],
    *,
    channel: MetaChannel,
    platform_user_id: str,
    page_id: str,
    profile_name: str | None,
    instagram_handle: str | None,
    self_ids: set[str],
    counters: dict[str, int],
    create_leads: bool = False,
) -> None:
    message_id = message_row.get("id")
    if not isinstance(message_id, str) or not message_id.strip():
        counters["skipped"] += 1
        return
    sender = message_row.get("from")
    sender_id = ""
    sender_username: str | None = None
    if isinstance(sender, Mapping):
        sender_id = str(sender.get("id") or "").strip()
        raw_username = sender.get("username")
        if isinstance(raw_username, str) and raw_username.strip():
            sender_username = raw_username.strip()
    is_echo = sender_id in self_ids if sender_id else False
    webhook_message = {
        "mid": message_id.strip(),
        "text": message_row.get("message"),
        "is_echo": is_echo,
        "attachments": _graph_attachments(message_row.get("attachments")),
    }
    if sender_username:
        webhook_message["username"] = sender_username
    before_stored = counters["stored"]
    store_meta_message(
        session,
        channel=channel,
        platform_user_id=platform_user_id,
        page_id=page_id,
        profile_name=profile_name,
        instagram_handle=instagram_handle,
        message=webhook_message,
        timestamp=message_row.get("created_time"),
        direction=(
            MetaMessageDirection.OUTBOUND if is_echo else MetaMessageDirection.INBOUND
        ),
        counters=counters,
        create_leads=create_leads,
        source_detail=_SOURCE_DETAIL,
    )
    if (
        counters["stored"] == before_stored
        and counters.get("skipped", 0) >= 0
        and webhook_message.get("text") in (None, "")
        and not webhook_message.get("attachments")
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
) -> tuple[str | None, str | None, str | None]:
    participants = row.get("participants")
    data = participants.get("data") if isinstance(participants, Mapping) else None
    if not isinstance(data, list):
        return None, None, None
    for participant in data:
        if not isinstance(participant, Mapping):
            continue
        participant_id = str(participant.get("id") or "").strip()
        if not participant_id or participant_id in self_ids:
            continue
        raw_name = participant.get("name")
        raw_username = participant.get("username")
        name = raw_name.strip() if isinstance(raw_name, str) else ""
        username = raw_username.strip() if isinstance(raw_username, str) else ""
        handle = parse_instagram_username(
            username or None, platform_user_id=participant_id
        )
        if is_own_instagram_handle(username) or is_own_instagram_handle(handle):
            self_ids.add(participant_id)
            continue
        profile = name or username or None
        return participant_id, profile, handle
    return None, None, None


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
