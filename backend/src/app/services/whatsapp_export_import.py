"""Persist parsed WhatsApp chat exports into conversations (no new leads)."""

from __future__ import annotations

import hashlib
import os
from typing import Any

from sqlalchemy.orm import Session

from app.db.models.enums import WhatsAppMessageDirection
from app.services.whatsapp_export_parse import (
    ParsedExportChat,
    ParsedExportMessage,
    extract_phone_hint,
)
from app.services.whatsapp_ingest import store_whatsapp_message
from app.utils.logging import get_logger, mask_pii

logger = get_logger(__name__)

_SOURCE_DETAIL = "whatsapp_export"
_MAX_WA_MESSAGE_ID_LENGTH = 128


def import_parsed_whatsapp_chats(
    session: Session,
    chats: list[ParsedExportChat],
    *,
    counterparty_wa_id: str | None,
    business_display_names: list[str],
) -> dict[str, int]:
    """Write export chats using synthetic message ids and content dedup."""
    counters = {
        "stored": 0,
        "duplicates": 0,
        "skipped": 0,
        "leads_created": 0,
        "contacts_created": 0,
        "conversations": 0,
        "skipped_no_wa_id": 0,
    }
    configured_names = _configured_business_names(business_display_names)
    for chat in chats:
        wa_id = _resolve_wa_id(chat, counterparty_wa_id=counterparty_wa_id)
        if wa_id is None:
            counters["skipped_no_wa_id"] += 1
            counters["skipped"] += 1
            logger.info(
                "Skipped WhatsApp export chat without a counterparty phone",
                extra={"filename": chat.filename, "title": mask_pii(chat.title)},
            )
            continue
        counters["conversations"] += 1
        outbound_names = _outbound_senders(chat, configured_names)
        for message in chat.messages:
            direction = (
                WhatsAppMessageDirection.OUTBOUND
                if _normalized_name(message.sender) in outbound_names
                else WhatsAppMessageDirection.INBOUND
            )
            profile_name = chat.title if direction is WhatsAppMessageDirection.INBOUND else None
            store_whatsapp_message(
                session,
                wa_id=wa_id,
                profile_name=profile_name,
                message=_to_ingest_message(wa_id, message, direction),
                direction=direction,
                counters=counters,
                create_leads=False,
                source_detail=_SOURCE_DETAIL,
                match_existing_content=True,
            )
    return counters


def _resolve_wa_id(
    chat: ParsedExportChat, *, counterparty_wa_id: str | None
) -> str | None:
    if counterparty_wa_id:
        return _digits(counterparty_wa_id)
    if chat.counterparty_hint:
        return _digits(chat.counterparty_hint)
    for message in chat.messages:
        hinted = extract_phone_hint(message.sender)
        if hinted:
            return hinted
    return None


def _outbound_senders(chat: ParsedExportChat, configured_names: set[str]) -> set[str]:
    senders = {_normalized_name(message.sender) for message in chat.messages}
    senders.discard("")
    if configured_names:
        return {name for name in senders if name in configured_names}
    title = _normalized_name(chat.title)
    inbound_guess = title if title in senders else None
    if inbound_guess and len(senders) >= 2:
        return {name for name in senders if name != inbound_guess}
    if len(senders) == 2:
        # Prefer the sender that does not look like a phone as the business.
        phone_senders = {name for name in senders if extract_phone_hint(name)}
        if len(phone_senders) == 1:
            return senders - phone_senders
    return set()


def _configured_business_names(explicit: list[str]) -> set[str]:
    names = {_normalized_name(item) for item in explicit}
    env_raw = os.getenv("WHATSAPP_EXPORT_BUSINESS_NAMES", "")
    for item in env_raw.split(","):
        names.add(_normalized_name(item))
    names.discard("")
    return names


def _to_ingest_message(
    wa_id: str,
    message: ParsedExportMessage,
    direction: WhatsAppMessageDirection,
) -> dict[str, Any]:
    stamp = str(int(message.sent_at.timestamp()))
    body = message.body or ""
    digest = hashlib.sha256(
        f"{wa_id}|{stamp}|{direction.value}|{body}".encode("utf-8")
    ).hexdigest()
    message_id = f"export:{digest}"[:_MAX_WA_MESSAGE_ID_LENGTH]
    payload: dict[str, Any] = {
        "id": message_id,
        "timestamp": stamp,
        "type": "text" if message.message_type == "text" else message.message_type,
    }
    if message.message_type == "text":
        payload["text"] = {"body": message.body or ""}
    else:
        payload[message.message_type] = {"caption": message.body}
    return payload


def _normalized_name(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _digits(value: str) -> str | None:
    digits = "".join(char for char in value if char.isdigit())
    return digits or None
