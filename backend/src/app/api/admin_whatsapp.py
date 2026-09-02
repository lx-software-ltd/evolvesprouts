"""Admin WhatsApp conversation API handlers (read-only)."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_inbox_cursors import (
    encode_last_message_cursor,
    isoformat_inbox_datetime,
    parse_inbox_limit,
    parse_inbox_search,
    parse_last_message_cursor,
)
from app.api.admin_inbox_import import handle_whatsapp_import_jobs
from app.api.admin_party_related import (
    conversation_contact_ids_for_party,
    parse_related_party_ids,
)
from app.api.admin_request import (
    parse_uuid,
    query_param,
    require_admin_identity,
    split_route_parts,
)
from app.db.engine import get_engine
from app.db.models.whatsapp import WhatsAppConversation, WhatsAppMessage
from app.db.repositories.whatsapp import WhatsAppRepository
from app.exceptions import NotFoundError
from app.utils import json_response, method_not_allowed, not_found


def handle_admin_whatsapp_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/whatsapp routes."""
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "whatsapp":
        return not_found(event)

    identity = require_admin_identity(event)

    import_response = handle_whatsapp_import_jobs(
        event, method, parts, actor_sub=identity.user_sub
    )
    if import_response is not None:
        return import_response

    if len(parts) == 3 and parts[2] == "conversations":
        if method != "GET":
            return method_not_allowed(event)
        return _list_conversations(event)

    if len(parts) == 5 and parts[2] == "conversations" and parts[4] == "messages":
        if method != "GET":
            return method_not_allowed(event)
        return _list_messages(event, conversation_id=parse_uuid(parts[3]))

    return not_found(event)


def _list_conversations(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_inbox_limit(query_param(event, "limit"))
    search = parse_inbox_search(query_param(event, "q"))
    contact_id, family_id, organization_id = parse_related_party_ids(event)
    cursor_last_message_at, cursor_id = parse_last_message_cursor(
        query_param(event, "cursor")
    )

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
                "total_count": total_count,
            },
            event=event,
        )


def _list_messages(
    event: Mapping[str, Any],
    *,
    conversation_id: UUID,
) -> dict[str, Any]:
    limit = parse_inbox_limit(query_param(event, "limit"))

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
        "first_inbound_at": isoformat_inbox_datetime(conversation.first_inbound_at),
        "last_message_at": isoformat_inbox_datetime(conversation.last_message_at),
        "inbound_count": conversation.inbound_count,
        "outbound_count": conversation.outbound_count,
        "created_at": isoformat_inbox_datetime(conversation.created_at),
    }


def _serialize_message(message: WhatsAppMessage) -> dict[str, Any]:
    return {
        "id": str(message.id),
        "wa_message_id": message.wa_message_id,
        "direction": message.direction.value,
        "message_type": message.message_type,
        "body": message.body,
        "sent_at": isoformat_inbox_datetime(message.sent_at),
    }
