"""Token-authenticated public Messenger and Instagram conversation API.

These endpoints expose conversation names, dates, and message text only.
They never return Page-scoped user ids, page ids, or last-four fallback names.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import parse_limit, parse_uuid, query_param
from app.api.assets.assets_common import split_route_parts
from app.api.public.token_auth import require_api_token
from app.db.engine import get_engine
from app.db.models.enums import MetaChannel
from app.db.models.meta import MetaConversation, MetaMessage
from app.db.repositories.meta import MetaRepository
from app.exceptions import NotFoundError, ValidationError
from app.utils import json_response

_MAX_SEARCH_LENGTH = 120
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
    if len(parts) < 2 or parts[0] != "public" or parts[1] != "meta":
        return json_response(404, {"error": "Not found"}, event=event)

    require_api_token(event, method)

    if len(parts) == 3 and parts[2] == "conversations":
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _list_conversations(event)

    if len(parts) == 5 and parts[2] == "conversations" and parts[4] == "messages":
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _list_messages(event, conversation_id=parse_uuid(parts[3]))

    return json_response(404, {"error": "Not found"}, event=event)


def public_conversation_name(conversation: MetaConversation) -> str:
    """Return a display name that never includes a Page-scoped user id."""
    contact = conversation.contact
    contact_name = ""
    if contact is not None:
        contact_name = " ".join(
            part for part in [contact.first_name, contact.last_name] if part
        ).strip()
    profile_name = (conversation.profile_name or "").strip()
    platform_user_id = conversation.platform_user_id or ""
    for candidate in (profile_name, contact_name):
        if candidate and not _exposes_scoped_id(candidate, platform_user_id):
            return candidate
    return _ANONYMOUS_NAMES.get(conversation.channel, "Meta contact")


def _exposes_scoped_id(value: str, platform_user_id: str) -> bool:
    """True when a label is the Page-scoped user id or a last-four fallback."""
    if platform_user_id and (
        value == platform_user_id or platform_user_id in value
    ):
        return True
    last_four = platform_user_id[-4:] if len(platform_user_id) >= 4 else ""
    if last_four and value.endswith(last_four) and value.split()[-1] == last_four:
        return True
    return False


def _list_conversations(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event)
    search = _parse_search(query_param(event, "q"))
    channel = _parse_channel(query_param(event, "channel"))
    cursor_last_message_at, cursor_id = _parse_cursor(query_param(event, "cursor"))

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
        next_cursor = _encode_cursor(page_rows[-1]) if has_more and page_rows else None
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
        "first_inbound_at": _isoformat(conversation.first_inbound_at),
        "last_message_at": _isoformat(conversation.last_message_at),
        "created_at": _isoformat(conversation.created_at),
    }


def _serialize_message(message: MetaMessage) -> dict[str, Any]:
    return {
        "id": str(message.id),
        "direction": message.direction.value,
        "body": message.body,
        "sent_at": _isoformat(message.sent_at),
    }


def _parse_search(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None
    normalized = raw_value.strip()
    if not normalized:
        return None
    if len(normalized) > _MAX_SEARCH_LENGTH:
        raise ValidationError("q is too long", field="q")
    return normalized


def _parse_channel(raw_value: str | None) -> MetaChannel | None:
    if raw_value is None or not raw_value.strip():
        return None
    normalized = raw_value.strip().lower()
    try:
        return MetaChannel(normalized)
    except ValueError as exc:
        raise ValidationError(
            "channel must be facebook or instagram", field="channel"
        ) from exc


def _encode_cursor(conversation: MetaConversation) -> str | None:
    if conversation.last_message_at is None:
        return None
    payload = json.dumps(
        {
            "last_message_at": _normalize_datetime(
                conversation.last_message_at
            ).isoformat(),
            "id": str(conversation.id),
        }
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")


def _parse_cursor(cursor: str | None) -> tuple[datetime | None, UUID | None]:
    if not cursor:
        return None, None
    try:
        padding = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(cursor + padding))
        last_message_at_raw = payload["last_message_at"]
        if not isinstance(last_message_at_raw, str):
            raise ValueError("last_message_at must be a string")
        last_message_at = _normalize_datetime(
            datetime.fromisoformat(last_message_at_raw.replace("Z", "+00:00"))
        )
        conversation_id = UUID(str(payload["id"]))
        return last_message_at, conversation_id
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValidationError("Invalid cursor", field="cursor") from exc


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _isoformat(value: datetime | None) -> str | None:
    return _normalize_datetime(value).isoformat() if value is not None else None
