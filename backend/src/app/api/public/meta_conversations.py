"""Token-authenticated public Messenger and Instagram conversation API.

These endpoints expose conversation names, dates, and message text only.
They never return Page-scoped user ids, page ids, or last-four fallback names.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import parse_limit, parse_uuid, query_param
from app.api.inbox_common import (
    encode_last_message_cursor,
    isoformat_inbox_datetime,
    parse_inbox_search,
    parse_last_message_cursor,
    parse_meta_channel,
)
from app.api.public.token_auth import require_api_token
from app.api.shared_request import route_has_prefix, split_route_parts
from app.db.engine import get_engine
from app.db.models.contact import contact_full_name
from app.db.models.enums import MetaChannel
from app.db.models.meta import MetaConversation, MetaMessage
from app.db.repositories.meta import MetaRepository
from app.exceptions import NotFoundError
from app.utils import json_response, method_not_allowed, not_found

_ANONYMOUS_NAMES = {
    MetaChannel.FACEBOOK: "Messenger contact",
    MetaChannel.INSTAGRAM: "Instagram contact",
}


def handle_public_meta_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/public/meta routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "public", "meta"):
        return not_found(event)

    require_api_token(event, method)

    if len(parts) == 3 and parts[2] == "conversations":
        if method != "GET":
            return method_not_allowed(event)
        return _list_conversations(event)

    if len(parts) == 5 and parts[2] == "conversations" and parts[4] == "messages":
        if method != "GET":
            return method_not_allowed(event)
        return _list_messages(event, conversation_id=parse_uuid(parts[3]))

    return not_found(event)


def public_conversation_name(conversation: MetaConversation) -> str:
    """Return a display name that never includes a Page-scoped user id."""
    contact_name = contact_full_name(conversation.contact) or ""
    profile_name = (conversation.profile_name or "").strip()
    platform_user_id = conversation.platform_user_id or ""
    for candidate in (profile_name, contact_name):
        if candidate and not _exposes_scoped_id(candidate, platform_user_id):
            return candidate
    return _ANONYMOUS_NAMES.get(conversation.channel, "Meta contact")


def _exposes_scoped_id(value: str, platform_user_id: str) -> bool:
    """True when a label is the Page-scoped user id or a last-four fallback."""
    if platform_user_id and (value == platform_user_id or platform_user_id in value):
        return True
    last_four = platform_user_id[-4:] if len(platform_user_id) >= 4 else ""
    if last_four and value.endswith(last_four) and value.split()[-1] == last_four:
        return True
    return False


def _list_conversations(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event)
    search = parse_inbox_search(query_param(event, "q"))
    channel = parse_meta_channel(query_param(event, "channel"))
    cursor_last_message_at, cursor_id = parse_last_message_cursor(
        query_param(event, "cursor")
    )

    with Session(get_engine()) as session:
        repository = MetaRepository(session)
        rows = repository.list_conversations(
            limit=limit + 1,
            cursor_last_message_at=cursor_last_message_at,
            cursor_id=cursor_id,
            search=search,
            channel=channel,
            search_platform_user_id=False,
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        next_cursor = (
            encode_last_message_cursor(page_rows[-1].last_message_at, page_rows[-1].id)
            if has_more and page_rows
            else None
        )
        return json_response(
            200,
            {
                "items": [_serialize_conversation(row) for row in page_rows],
                "next_cursor": next_cursor,
            },
            event=event,
        )


def _list_messages(
    event: Mapping[str, Any],
    *,
    conversation_id: UUID,
) -> dict[str, Any]:
    limit = parse_limit(event)

    with Session(get_engine()) as session:
        repository = MetaRepository(session)
        conversation = repository.get_conversation_by_id(conversation_id)
        if conversation is None:
            raise NotFoundError("MetaConversation", str(conversation_id))
        messages = repository.list_messages(
            conversation_id=conversation_id,
            limit=limit,
        )
        return json_response(
            200,
            {
                "conversation": _serialize_conversation(conversation),
                "items": [_serialize_message(message) for message in messages],
            },
            event=event,
        )


def _serialize_conversation(conversation: MetaConversation) -> dict[str, Any]:
    return {
        "id": str(conversation.id),
        "channel": conversation.channel.value,
        "name": public_conversation_name(conversation),
        "first_inbound_at": isoformat_inbox_datetime(conversation.first_inbound_at),
        "last_message_at": isoformat_inbox_datetime(conversation.last_message_at),
        "created_at": isoformat_inbox_datetime(conversation.created_at),
    }


def _serialize_message(message: MetaMessage) -> dict[str, Any]:
    return {
        "id": str(message.id),
        "direction": message.direction.value,
        "body": message.body,
        "sent_at": isoformat_inbox_datetime(message.sent_at),
    }
