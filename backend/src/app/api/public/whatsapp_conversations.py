"""Token-authenticated public WhatsApp conversation API.

These endpoints expose conversation names, dates, and message text only.
They never return WhatsApp numbers, ``wa_id``, or last-four fallback names.
"""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import parse_limit, parse_uuid, query_param
from app.api.assets.assets_common import split_route_parts
from app.api.public.token_auth import require_api_token
from app.db.engine import get_engine
from app.db.models.whatsapp import WhatsAppConversation, WhatsAppMessage
from app.db.repositories.whatsapp import WhatsAppRepository
from app.exceptions import NotFoundError, ValidationError
from app.utils import json_response

_MAX_SEARCH_LENGTH = 120
_ANONYMOUS_DISPLAY_NAME = "WhatsApp contact"
_FALLBACK_NAME_RE = re.compile(r"^WhatsApp\s+\d{4}$", re.IGNORECASE)


def handle_public_whatsapp_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/public/whatsapp routes."""
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "public" or parts[1] != "whatsapp":
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


def public_conversation_name(conversation: WhatsAppConversation) -> str:
    """Return a display name that never includes a WhatsApp number."""
    contact = conversation.contact
    contact_name = ""
    if contact is not None:
        contact_name = " ".join(
            part for part in [contact.first_name, contact.last_name] if part
        ).strip()
    profile_name = (conversation.profile_name or "").strip()
    wa_id = conversation.wa_id or ""
    for candidate in (profile_name, contact_name):
        if candidate and not _exposes_phone(candidate, wa_id):
            return candidate
    return _ANONYMOUS_DISPLAY_NAME


def _exposes_phone(value: str, wa_id: str) -> bool:
    """True when a label is a phone, wa_id, or last-four fallback name."""
    if wa_id and (value == wa_id or wa_id in value):
        return True
    if _FALLBACK_NAME_RE.match(value):
        return True
    digits = re.sub(r"\D", "", value)
    letters = re.sub(r"[^A-Za-z]", "", value)
    return len(digits) >= 8 and len(letters) == 0


def _list_conversations(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event)
    search = _parse_search(query_param(event, "q"))
    cursor_last_message_at, cursor_id = _parse_cursor(query_param(event, "cursor"))

    with Session(get_engine()) as session:
        repository = WhatsAppRepository(session)
        rows = repository.list_conversations(
            limit=limit + 1,
            cursor_last_message_at=cursor_last_message_at,
            cursor_id=cursor_id,
            search=search,
            search_wa_id=False,
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
        repository = WhatsAppRepository(session)
        conversation = repository.get_conversation_by_id(conversation_id)
        if conversation is None:
            raise NotFoundError("WhatsAppConversation", str(conversation_id))
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


def _serialize_conversation(conversation: WhatsAppConversation) -> dict[str, Any]:
    return {
        "id": str(conversation.id),
        "name": public_conversation_name(conversation),
        "first_inbound_at": _isoformat(conversation.first_inbound_at),
        "last_message_at": _isoformat(conversation.last_message_at),
        "created_at": _isoformat(conversation.created_at),
    }


def _serialize_message(message: WhatsAppMessage) -> dict[str, Any]:
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


def _encode_cursor(conversation: WhatsAppConversation) -> str | None:
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
