"""Ingest Messenger and Instagram webhook payloads into conversations and CRM."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.db.models import (
    Contact,
    ContactSource,
    ContactType,
    FunnelStage,
    LeadEventType,
    LeadType,
    MetaChannel,
    MetaConversation,
    MetaMessage,
    MetaMessageDirection,
    SalesLead,
)
from app.db.repositories.meta import MetaRepository
from app.db.repositories.sales_lead import SalesLeadRepository
from app.utils.logging import get_logger, mask_pii

logger = get_logger(__name__)

_SYSTEM_ACTOR = "system"
_SOURCE_DETAIL = "meta_webhook"
_MAX_PLATFORM_USER_ID_LENGTH = 128
_MAX_PAGE_ID_LENGTH = 128
_MAX_PLATFORM_MESSAGE_ID_LENGTH = 256
_MAX_PROFILE_NAME_LENGTH = 256
_MAX_MESSAGE_TYPE_LENGTH = 32
_MS_TIMESTAMP_THRESHOLD = 10_000_000_000
_CHANNEL_BY_OBJECT = {
    "page": MetaChannel.FACEBOOK,
    "instagram": MetaChannel.INSTAGRAM,
}
_ANONYMOUS_NAMES = {
    MetaChannel.FACEBOOK: "Messenger contact",
    MetaChannel.INSTAGRAM: "Instagram contact",
}
_CONTACT_SOURCES = {
    MetaChannel.FACEBOOK: ContactSource.FACEBOOK,
    MetaChannel.INSTAGRAM: ContactSource.INSTAGRAM,
}


def ingest_webhook_payload(
    session: Session,
    payload: Mapping[str, Any],
) -> dict[str, int]:
    """Persist Messenger/Instagram messages from one delivery; returns counters."""
    counters = {
        "stored": 0,
        "duplicates": 0,
        "skipped": 0,
        "leads_created": 0,
        "contacts_created": 0,
    }
    object_name = payload.get("object")
    if object_name == "whatsapp_business_account":
        return counters
    channel = _CHANNEL_BY_OBJECT.get(str(object_name or ""))
    if channel is None:
        counters["skipped"] += 1
        return counters

    for entry in _as_list(payload.get("entry")):
        page_id = _normalized_id(entry.get("id"), max_length=_MAX_PAGE_ID_LENGTH)
        events = list(_as_list(entry.get("messaging")))
        for change in _as_list(entry.get("changes")):
            value = change.get("value")
            if isinstance(value, Mapping):
                events.extend(_as_list(value.get("messaging")))
        for event in events:
            _ingest_messaging_event(
                session,
                event,
                channel=channel,
                page_id=page_id,
                counters=counters,
            )
    return counters


def _ingest_messaging_event(
    session: Session,
    event: Mapping[str, Any],
    *,
    channel: MetaChannel,
    page_id: str | None,
    counters: dict[str, int],
) -> None:
    message = event.get("message")
    if not isinstance(message, Mapping):
        counters["skipped"] += 1
        return

    is_echo = bool(message.get("is_echo"))
    sender_id = _normalized_id(
        _nested_id(event.get("sender")), max_length=_MAX_PLATFORM_USER_ID_LENGTH
    )
    recipient_id = _normalized_id(
        _nested_id(event.get("recipient")), max_length=_MAX_PLATFORM_USER_ID_LENGTH
    )
    platform_user_id = recipient_id if is_echo else sender_id
    if platform_user_id is None:
        counters["skipped"] += 1
        return

    resolved_page_id = page_id
    if resolved_page_id is None:
        resolved_page_id = sender_id if is_echo else recipient_id

    store_meta_message(
        session,
        channel=channel,
        platform_user_id=platform_user_id,
        page_id=resolved_page_id,
        profile_name=_profile_name(event, message),
        message=message,
        timestamp=event.get("timestamp"),
        direction=(
            MetaMessageDirection.OUTBOUND if is_echo else MetaMessageDirection.INBOUND
        ),
        counters=counters,
    )


def store_meta_message(
    session: Session,
    *,
    channel: MetaChannel,
    platform_user_id: str,
    page_id: str | None,
    profile_name: str | None,
    message: Mapping[str, Any],
    timestamp: Any,
    direction: MetaMessageDirection,
    counters: dict[str, int],
    create_leads: bool = True,
    create_contacts: bool = True,
    source_detail: str = _SOURCE_DETAIL,
) -> None:
    platform_message_id = _normalized_id(
        message.get("mid"), max_length=_MAX_PLATFORM_MESSAGE_ID_LENGTH
    )
    sent_at = _parse_timestamp(timestamp)
    if platform_message_id is None or sent_at is None:
        counters["skipped"] += 1
        return

    repository = MetaRepository(session)
    if repository.find_message_by_platform_message_id(platform_message_id) is not None:
        counters["duplicates"] += 1
        return

    conversation = repository.get_conversation_by_platform_user(
        channel=channel,
        platform_user_id=platform_user_id,
    )
    if conversation is None:
        conversation = MetaConversation(
            channel=channel,
            platform_user_id=platform_user_id,
            page_id=page_id,
            profile_name=profile_name,
        )
        session.add(conversation)
        session.flush()
    else:
        if profile_name and conversation.profile_name != profile_name:
            conversation.profile_name = profile_name
        if page_id and conversation.page_id != page_id:
            conversation.page_id = page_id

    session.add(
        MetaMessage(
            conversation_id=conversation.id,
            platform_message_id=platform_message_id,
            direction=direction,
            message_type=_message_type(message),
            body=_extract_body(message),
            sent_at=sent_at,
        )
    )

    now = datetime.now(timezone.utc)
    if direction is MetaMessageDirection.INBOUND:
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

    if direction is MetaMessageDirection.INBOUND and create_contacts:
        _ensure_contact_and_lead(
            session,
            conversation=conversation,
            counters=counters,
            create_leads=create_leads,
            source_detail=source_detail,
        )

    session.flush()
    counters["stored"] += 1


def _ensure_contact_and_lead(
    session: Session,
    *,
    conversation: MetaConversation,
    counters: dict[str, int],
    create_leads: bool = True,
    source_detail: str = _SOURCE_DETAIL,
) -> None:
    if conversation.contact_id is None:
        contact = _create_contact(
            session, conversation=conversation, source_detail=source_detail
        )
        conversation.contact_id = contact.id
        counters["contacts_created"] = counters.get("contacts_created", 0) + 1

    contact_id = conversation.contact_id
    if contact_id is None:
        return

    if conversation.lead_id is not None or not create_leads:
        return

    lead_repository = SalesLeadRepository(session)
    open_lead = lead_repository.find_open_by_contact(contact_id)
    if open_lead is not None:
        conversation.lead_id = open_lead.id
        return

    lead = lead_repository.create_with_event(
        SalesLead(
            contact_id=contact_id,
            lead_type=LeadType.OTHER,
            funnel_stage=FunnelStage.NEW,
        ),
        LeadEventType.CREATED,
        metadata={
            "channel": conversation.channel.value,
            "conversation_id": str(conversation.id),
        },
        to_stage=FunnelStage.NEW,
        created_by=_SYSTEM_ACTOR,
    )
    conversation.lead_id = lead.id
    counters["leads_created"] += 1
    logger.info(
        "Created sales lead from Meta conversation",
        extra={
            "lead_id": str(lead.id),
            "conversation_id": str(conversation.id),
            "channel": conversation.channel.value,
            "platform_user_id": mask_pii(conversation.platform_user_id),
        },
    )


def _create_contact(
    session: Session,
    *,
    conversation: MetaConversation,
    source_detail: str = _SOURCE_DETAIL,
) -> Contact:
    contact = Contact(
        first_name=_contact_first_name(conversation),
        contact_type=ContactType.OTHER,
        source=_CONTACT_SOURCES[conversation.channel],
        source_detail=source_detail,
    )
    session.add(contact)
    session.flush()
    return contact


def _contact_first_name(conversation: MetaConversation) -> str:
    profile_name = (conversation.profile_name or "").strip()
    if profile_name:
        return profile_name[:100]
    return _ANONYMOUS_NAMES[conversation.channel]


def _profile_name(event: Mapping[str, Any], message: Mapping[str, Any]) -> str | None:
    sender = event.get("sender")
    if isinstance(sender, Mapping):
        for key in ("name", "username"):
            value = sender.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:_MAX_PROFILE_NAME_LENGTH]
    for key in ("username", "from"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:_MAX_PROFILE_NAME_LENGTH]
        if isinstance(value, Mapping):
            nested = value.get("username") or value.get("name")
            if isinstance(nested, str) and nested.strip():
                return nested.strip()[:_MAX_PROFILE_NAME_LENGTH]
    return None


def _message_type(message: Mapping[str, Any]) -> str:
    attachments = message.get("attachments")
    if isinstance(attachments, list) and attachments:
        first = attachments[0]
        if isinstance(first, Mapping):
            raw_type = first.get("type")
            if isinstance(raw_type, str) and raw_type.strip():
                return raw_type.strip()[:_MAX_MESSAGE_TYPE_LENGTH]
        return "attachment"
    if isinstance(message.get("text"), str) and message["text"].strip():
        return "text"
    if message.get("sticker_id") is not None:
        return "sticker"
    return "unknown"


def _extract_body(message: Mapping[str, Any]) -> str | None:
    """Extract display text (no media download)."""
    text = message.get("text")
    if isinstance(text, str) and text.strip():
        return text
    attachments = message.get("attachments")
    if not isinstance(attachments, list):
        return None
    for attachment in attachments:
        if not isinstance(attachment, Mapping):
            continue
        payload = attachment.get("payload")
        if isinstance(payload, Mapping):
            caption = payload.get("title") or payload.get("caption")
            if isinstance(caption, str) and caption.strip():
                return caption
        label = attachment.get("type")
        if isinstance(label, str) and label.strip():
            return f"[{label.strip()}]"
    return None


def _parse_timestamp(raw_value: Any) -> datetime | None:
    if isinstance(raw_value, datetime):
        if raw_value.tzinfo is None:
            return raw_value.replace(tzinfo=timezone.utc)
        return raw_value.astimezone(timezone.utc)
    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        if not stripped:
            return None
        if stripped.isdigit():
            raw_value = stripped
        else:
            normalized = stripped.replace("Z", "+00:00")
            if len(normalized) >= 5 and normalized[-5] in "+-" and normalized[-3] != ":":
                normalized = f"{normalized[:-2]}:{normalized[-2:]}"
            try:
                parsed = datetime.fromisoformat(normalized)
            except ValueError:
                return None
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
    try:
        value = int(str(raw_value).strip())
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    if value > _MS_TIMESTAMP_THRESHOLD:
        value = value // 1000
    return datetime.fromtimestamp(value, tz=timezone.utc)


def _nested_id(raw_value: Any) -> Any:
    if isinstance(raw_value, Mapping):
        return raw_value.get("id")
    return raw_value


def _normalized_id(raw_value: Any, *, max_length: int) -> str | None:
    if not isinstance(raw_value, str) and not isinstance(raw_value, int):
        return None
    normalized = str(raw_value).strip()
    if not normalized or len(normalized) > max_length:
        return None
    return normalized


def _as_list(value: Any) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]
