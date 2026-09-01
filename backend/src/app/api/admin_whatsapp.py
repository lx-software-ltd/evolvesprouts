"""Admin WhatsApp conversation API handlers (read-only)."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_inbox_import import handle_whatsapp_import_jobs
from app.api.admin_party_related import (
    conversation_contact_ids_for_party,
    parse_related_party_ids,
)
from app.api.admin_request import parse_uuid, query_param
from app.api.assets.assets_common import extract_identity, split_route_parts
from app.db.engine import get_engine
from app.db.models.whatsapp import WhatsAppConversation, WhatsAppMessage
from app.db.repositories.whatsapp import WhatsAppRepository
from app.exceptions import NotFoundError, ValidationError
from app.utils import json_response

_DEFAULT_LIMIT = 25
_MAX_LIMIT = 100
_MAX_SEARCH_LENGTH = 120


def handle_admin_whatsapp_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/whatsapp routes."""
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "whatsapp":
        return json_response(404, {"error": "Not found"}, event=event)

    identity = extract_identity(event)
    if not identity.user_sub:
        raise ValidationError("Authenticated user is required", field="authorization")

    import_response = handle_whatsapp_import_jobs(
        event, method, parts, actor_sub=identity.user_sub
    )
    if import_response is not None:
        return import_response

    if len(parts) == 3 and parts[2] == "conversations":
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _list_conversations(event)

    if len(parts) == 5 and parts[2] == "conversations" and parts[4] == "messages":
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _list_messages(event, conversation_id=parse_uuid(parts[3]))

    return json_response(404, {"error": "Not found"}, event=event)


def _list_conversations(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = _parse_limit(query_param(event, "limit"))
    search = _parse_search(query_param(event, "q"))
    contact_id, family_id, organization_id = parse_related_party_ids(event)
    cursor_last_message_at, cursor_id = _parse_cursor(query_param(event, "cursor"))

    with Session(get_engine()) as session:
        repository = WhatsAppRepository(session)
        party_contact_ids = conversation_contact_ids_for_party(
            session, family_id=family_id, organization_id=organization_id
        )
        rows = repository.list_conversations(
            limit=limit + 1,
            cursor_last_message_at=cursor_last_message_at,
            cursor_id=cursor_id,
            search=search,
            contact_id=contact_id,
            contact_ids=party_contact_ids,
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        total_count = repository.count_conversations(
            search=search,
            contact_id=contact_id,
            contact_ids=party_contact_ids,
        )
        next_cursor = _encode_cursor(page_rows[-1]) if has_more and page_rows else None
        return json_response(
            200,
            {
                "items": [_serialize_conversation(row) for row in page_rows],
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _list_messages(
    event: Mapping[str, Any],
    *,
    conversation_id: UUID,
) -> dict[str, Any]:
    limit = _parse_limit(query_param(event, "limit"))

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
    contact = conversation.contact
    return {
        "id": str(conversation.id),
        "wa_id": conversation.wa_id,
        "profile_name": conversation.profile_name,
        "contact_id": str(conversation.contact_id) if conversation.contact_id else None,
        "contact_name": (
            " ".join(
                part for part in [contact.first_name, contact.last_name] if part
            ).strip()
            if contact is not None
            else None
        ),
        "lead_id": str(conversation.lead_id) if conversation.lead_id else None,
        "first_inbound_at": _isoformat(conversation.first_inbound_at),
        "last_message_at": _isoformat(conversation.last_message_at),
        "inbound_count": conversation.inbound_count,
        "outbound_count": conversation.outbound_count,
        "created_at": _isoformat(conversation.created_at),
    }


def _serialize_message(message: WhatsAppMessage) -> dict[str, Any]:
    return {
        "id": str(message.id),
        "wa_message_id": message.wa_message_id,
        "direction": message.direction.value,
        "message_type": message.message_type,
        "body": message.body,
        "sent_at": _isoformat(message.sent_at),
    }


def _parse_limit(raw_value: str | None) -> int:
    if raw_value is None or not raw_value.strip():
        return _DEFAULT_LIMIT
    try:
        limit = int(raw_value)
    except ValueError as exc:
        raise ValidationError("limit must be an integer", field="limit") from exc
    if limit < 1 or limit > _MAX_LIMIT:
        raise ValidationError(
            f"limit must be between 1 and {_MAX_LIMIT}", field="limit"
        )
    return limit


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
