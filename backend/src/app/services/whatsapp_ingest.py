"""Ingest WhatsApp Cloud API webhook payloads into conversations and CRM."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from collections.abc import Mapping

import phonenumbers
from phonenumbers.phonenumberutil import NumberParseException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Contact,
    ContactSource,
    ContactType,
    WhatsAppConversation,
    WhatsAppMessage,
    WhatsAppMessageDirection,
)
from app.db.repositories.whatsapp import WhatsAppRepository
from app.services.lead_funnel_automation import link_conversation_lead_and_advance
from app.utils.logging import get_logger, mask_pii

logger = get_logger(__name__)

_SOURCE_DETAIL = "whatsapp_webhook"
_MESSAGE_CHANGE_FIELDS = frozenset({"messages"})
_ECHO_CHANGE_FIELDS = frozenset({"smb_message_echoes", "message_echoes"})
_MAX_WA_ID_LENGTH = 32
_MAX_WA_MESSAGE_ID_LENGTH = 128
_MAX_PROFILE_NAME_LENGTH = 256
_MAX_MESSAGE_TYPE_LENGTH = 32


def ingest_webhook_payload(
    session: Session,
    payload: Mapping[str, Any],
) -> dict[str, int]:
    """Persist messages from one webhook delivery; returns ingest counters."""
    counters = {
        "stored": 0,
        "duplicates": 0,
        "skipped": 0,
        "leads_created": 0,
        "contacts_created": 0,
    }
    for entry in _as_list(payload.get("entry")):
        for change in _as_list(entry.get("changes")):
            field = change.get("field")
            value = change.get("value")
            if not isinstance(value, Mapping):
                continue
            if field in _MESSAGE_CHANGE_FIELDS:
                _ingest_message_change(session, value, counters)
            elif field in _ECHO_CHANGE_FIELDS:
                _ingest_echo_change(session, value, counters)
            elif field == "history":
                _ingest_history_change(session, value, counters)
    return counters


def _ingest_message_change(
    session: Session,
    value: Mapping[str, Any],
    counters: dict[str, int],
) -> None:
    profile_names = _profile_names_by_wa_id(value)
    for message in _as_list(value.get("messages")):
        wa_id = _normalized_id(message.get("from"), max_length=_MAX_WA_ID_LENGTH)
        if wa_id is None:
            counters["skipped"] += 1
            continue
        store_whatsapp_message(
            session,
            wa_id=wa_id,
            profile_name=profile_names.get(wa_id),
            message=message,
            direction=WhatsAppMessageDirection.INBOUND,
            counters=counters,
        )


def _ingest_echo_change(
    session: Session,
    value: Mapping[str, Any],
    counters: dict[str, int],
) -> None:
    echoes = _as_list(value.get("message_echoes")) or _as_list(value.get("messages"))
    for message in echoes:
        wa_id = _normalized_id(message.get("to"), max_length=_MAX_WA_ID_LENGTH)
        if wa_id is None:
            counters["skipped"] += 1
            continue
        store_whatsapp_message(
            session,
            wa_id=wa_id,
            profile_name=None,
            message=message,
            direction=WhatsAppMessageDirection.OUTBOUND,
            counters=counters,
        )


def _ingest_history_change(
    session: Session,
    value: Mapping[str, Any],
    counters: dict[str, int],
) -> None:
    """Persist one-time Cloud API coexistence history chunks (no new leads)."""
    for chunk in _as_list(value.get("history")):
        for thread in _as_list(chunk.get("threads")):
            wa_id = _normalized_id(thread.get("id"), max_length=_MAX_WA_ID_LENGTH)
            if wa_id is None:
                counters["skipped"] += 1
                continue
            for message in _as_list(thread.get("messages")):
                sender = _normalized_id(
                    message.get("from"), max_length=_MAX_WA_ID_LENGTH
                )
                direction = (
                    WhatsAppMessageDirection.INBOUND
                    if sender == wa_id
                    else WhatsAppMessageDirection.OUTBOUND
                )
                store_whatsapp_message(
                    session,
                    wa_id=wa_id,
                    profile_name=None,
                    message=message,
                    direction=direction,
                    counters=counters,
                    create_leads=False,
                    source_detail="whatsapp_history",
                )


def store_whatsapp_message(
    session: Session,
    *,
    wa_id: str,
    profile_name: str | None,
    message: Mapping[str, Any],
    direction: WhatsAppMessageDirection,
    counters: dict[str, int],
    create_leads: bool = True,
    create_contacts: bool = True,
    source_detail: str = _SOURCE_DETAIL,
    match_existing_content: bool = False,
) -> None:
    wa_message_id = _normalized_id(
        message.get("id"), max_length=_MAX_WA_MESSAGE_ID_LENGTH
    )
    sent_at = _parse_timestamp(message.get("timestamp"))
    if wa_message_id is None or sent_at is None:
        counters["skipped"] += 1
        return

    repository = WhatsAppRepository(session)
    if repository.find_message_by_wa_message_id(wa_message_id) is not None:
        counters["duplicates"] += 1
        return

    conversation = repository.get_conversation_by_wa_id(wa_id)
    if conversation is None:
        conversation = WhatsAppConversation(wa_id=wa_id, profile_name=profile_name)
        session.add(conversation)
        session.flush()
    elif profile_name and conversation.profile_name != profile_name:
        conversation.profile_name = profile_name

    body = _extract_body(message)
    if match_existing_content and repository.find_message_by_content(
        conversation_id=conversation.id,
        sent_at=sent_at,
        direction=direction,
        body=body,
    ):
        counters["duplicates"] += 1
        return

    session.add(
        WhatsAppMessage(
            conversation_id=conversation.id,
            wa_message_id=wa_message_id,
            direction=direction,
            message_type=_message_type(message),
            body=body,
            sent_at=sent_at,
        )
    )

    now = datetime.now(timezone.utc)
    if direction is WhatsAppMessageDirection.INBOUND:
        conversation.inbound_count = (conversation.inbound_count or 0) + 1
        if (
            conversation.first_inbound_at is None
            or sent_at < conversation.first_inbound_at
        ):
            conversation.first_inbound_at = sent_at
    else:
        conversation.outbound_count = (conversation.outbound_count or 0) + 1
    if conversation.last_message_at is None or sent_at > conversation.last_message_at:
        conversation.last_message_at = sent_at
    conversation.updated_at = now

    if create_contacts:
        _ensure_contact_and_lead(
            session,
            conversation=conversation,
            counters=counters,
            create_leads=create_leads,
            source_detail=source_detail,
            is_outbound=direction is WhatsAppMessageDirection.OUTBOUND,
        )

    session.flush()
    counters["stored"] += 1


def _ensure_contact_and_lead(
    session: Session,
    *,
    conversation: WhatsAppConversation,
    counters: dict[str, int],
    create_leads: bool = True,
    source_detail: str = _SOURCE_DETAIL,
    is_outbound: bool = False,
) -> None:
    if conversation.contact_id is None:
        contact, created = _find_or_create_contact(
            session, conversation=conversation, source_detail=source_detail
        )
        conversation.contact_id = contact.id
        if created:
            counters["contacts_created"] = counters.get("contacts_created", 0) + 1

    if conversation.contact_id is None:
        return
    created_before = counters.get("leads_created", 0)
    link_conversation_lead_and_advance(
        session,
        conversation=conversation,
        channel="whatsapp",
        counters=counters,
        create_leads=create_leads,
        is_outbound=is_outbound,
    )
    if counters.get("leads_created", 0) > created_before:
        logger.info(
            "Created sales lead from WhatsApp conversation",
            extra={
                "lead_id": str(conversation.lead_id),
                "conversation_id": str(conversation.id),
                "wa_id": mask_pii(conversation.wa_id),
            },
        )


def _find_or_create_contact(
    session: Session,
    *,
    conversation: WhatsAppConversation,
    source_detail: str = _SOURCE_DETAIL,
) -> tuple[Contact, bool]:
    phone_region, phone_national = _parse_wa_phone(conversation.wa_id)
    existing: Contact | None = None
    if phone_region and phone_national:
        existing = session.execute(
            select(Contact)
            .where(
                Contact.phone_region == phone_region,
                Contact.phone_national_number == phone_national,
                Contact.archived_at.is_(None),
            )
            .order_by(Contact.created_at.asc())
            .limit(1)
        ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    contact = Contact(
        first_name=_contact_first_name(conversation),
        contact_type=ContactType.OTHER,
        source=ContactSource.WHATSAPP,
        source_detail=source_detail,
        phone_region=phone_region,
        phone_national_number=phone_national,
    )
    session.add(contact)
    session.flush()
    return contact, True


def _contact_first_name(conversation: WhatsAppConversation) -> str:
    profile_name = (conversation.profile_name or "").strip()
    if profile_name:
        return profile_name[:100]
    return f"WhatsApp {conversation.wa_id[-4:]}"


def _parse_wa_phone(wa_id: str) -> tuple[str | None, str | None]:
    """Derive (region, national number) from a WhatsApp id (E.164 sans '+')."""
    if not wa_id.isdigit():
        return None, None
    try:
        parsed = phonenumbers.parse(f"+{wa_id}", None)
    except NumberParseException:
        return None, None
    if not phonenumbers.is_valid_number(parsed):
        return None, None
    region = phonenumbers.region_code_for_number(parsed)
    if not region:
        return None, None
    return region, phonenumbers.national_significant_number(parsed)


def _profile_names_by_wa_id(value: Mapping[str, Any]) -> dict[str, str]:
    names: dict[str, str] = {}
    for contact in _as_list(value.get("contacts")):
        wa_id = _normalized_id(contact.get("wa_id"), max_length=_MAX_WA_ID_LENGTH)
        profile = contact.get("profile")
        name = profile.get("name") if isinstance(profile, Mapping) else None
        if wa_id and isinstance(name, str) and name.strip():
            names[wa_id] = name.strip()[:_MAX_PROFILE_NAME_LENGTH]
    return names


def _message_type(message: Mapping[str, Any]) -> str:
    raw = message.get("type")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()[:_MAX_MESSAGE_TYPE_LENGTH]
    return "unknown"


def _extract_body(message: Mapping[str, Any]) -> str | None:
    """Extract display text for supported message types (no media download)."""
    message_type = _message_type(message)
    payload = message.get(message_type)
    if not isinstance(payload, Mapping):
        return None
    if message_type == "text":
        body = payload.get("body")
        return body if isinstance(body, str) else None
    if message_type == "button":
        text_value = payload.get("text")
        return text_value if isinstance(text_value, str) else None
    if message_type == "interactive":
        for key in ("button_reply", "list_reply"):
            reply = payload.get(key)
            if isinstance(reply, Mapping) and isinstance(reply.get("title"), str):
                return reply["title"]
        return None
    if message_type == "reaction":
        emoji = payload.get("emoji")
        return emoji if isinstance(emoji, str) else None
    caption = payload.get("caption")
    if isinstance(caption, str) and caption.strip():
        return caption
    return None


def _parse_timestamp(raw_value: Any) -> datetime | None:
    try:
        seconds = int(str(raw_value).strip())
    except (TypeError, ValueError):
        return None
    if seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc)


def _normalized_id(raw_value: Any, *, max_length: int) -> str | None:
    if not isinstance(raw_value, str):
        return None
    normalized = raw_value.strip()
    if not normalized or len(normalized) > max_length:
        return None
    return normalized


def _as_list(value: Any) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]
