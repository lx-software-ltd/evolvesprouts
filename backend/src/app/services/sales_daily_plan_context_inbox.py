"""Inbound WhatsApp/Meta threads for the org-wide sales daily plan."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.contact import Contact
from app.db.models.enums import MetaMessageDirection, WhatsAppMessageDirection
from app.db.models.meta import MetaConversation, MetaMessage
from app.db.models.whatsapp import WhatsAppConversation, WhatsAppMessage

MAX_NEEDS_REPLY = 15
MAX_MESSAGE_CHARS = 1000


def load_needs_reply_threads(
    session: Session,
    *,
    conversation_watermark: datetime | None,
) -> tuple[list[dict[str, Any]], datetime | None]:
    """Latest inbound thread per conversation, newest first."""
    combined = [
        *_latest_inbound_whatsapp(session),
        *_latest_inbound_meta(session),
    ]
    combined.sort(
        key=lambda item: item["_sent_at"] or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    trimmed = combined[:MAX_NEEDS_REPLY]
    results: list[dict[str, Any]] = []
    for item in trimmed:
        sent_at = item.pop("_sent_at")
        item["sent_at"] = _iso(sent_at) if isinstance(sent_at, datetime) else None
        results.append(item)
    return results, conversation_watermark


def display_name(
    first_name: str | None,
    last_name: str | None,
    profile_name: str | None,
) -> str | None:
    parts = [part for part in (first_name, last_name) if part]
    if parts:
        return " ".join(parts)
    return profile_name or None


def _latest_inbound_whatsapp(session: Session) -> list[dict[str, Any]]:
    ranked = (
        select(
            WhatsAppMessage.conversation_id,
            WhatsAppMessage.body,
            WhatsAppMessage.direction,
            WhatsAppMessage.sent_at,
            func.row_number()
            .over(
                partition_by=WhatsAppMessage.conversation_id,
                order_by=WhatsAppMessage.sent_at.desc(),
            )
            .label("rn"),
        )
    ).subquery()
    rows = session.execute(
        select(
            ranked.c.body,
            ranked.c.sent_at,
            WhatsAppConversation.contact_id,
            WhatsAppConversation.lead_id,
            WhatsAppConversation.profile_name,
            Contact.first_name,
            Contact.last_name,
        )
        .join(
            WhatsAppConversation,
            WhatsAppConversation.id == ranked.c.conversation_id,
        )
        .outerjoin(Contact, Contact.id == WhatsAppConversation.contact_id)
        .where(ranked.c.rn == 1)
        .where(ranked.c.direction == WhatsAppMessageDirection.INBOUND)
        .order_by(ranked.c.sent_at.desc())
        .limit(MAX_NEEDS_REPLY)
    ).all()
    results: list[dict[str, Any]] = []
    for body, sent_at, contact_id, lead_id, profile_name, first_name, last_name in rows:
        results.append(
            {
                "channel": "whatsapp",
                "lead_id": str(lead_id) if lead_id else None,
                "contact_name": display_name(first_name, last_name, profile_name),
                "body": _truncate(body, MAX_MESSAGE_CHARS),
                "_sent_at": _as_utc(sent_at) if sent_at is not None else None,
                "contact_id": str(contact_id) if contact_id else None,
            }
        )
    return results


def _latest_inbound_meta(session: Session) -> list[dict[str, Any]]:
    ranked = (
        select(
            MetaMessage.conversation_id,
            MetaMessage.body,
            MetaMessage.direction,
            MetaMessage.sent_at,
            func.row_number()
            .over(
                partition_by=MetaMessage.conversation_id,
                order_by=MetaMessage.sent_at.desc(),
            )
            .label("rn"),
        )
    ).subquery()
    rows = session.execute(
        select(
            ranked.c.body,
            ranked.c.sent_at,
            MetaConversation.channel,
            MetaConversation.contact_id,
            MetaConversation.lead_id,
            MetaConversation.profile_name,
            Contact.first_name,
            Contact.last_name,
        )
        .join(MetaConversation, MetaConversation.id == ranked.c.conversation_id)
        .outerjoin(Contact, Contact.id == MetaConversation.contact_id)
        .where(ranked.c.rn == 1)
        .where(ranked.c.direction == MetaMessageDirection.INBOUND)
        .order_by(ranked.c.sent_at.desc())
        .limit(MAX_NEEDS_REPLY)
    ).all()
    results: list[dict[str, Any]] = []
    for (
        body,
        sent_at,
        channel,
        contact_id,
        lead_id,
        profile_name,
        first_name,
        last_name,
    ) in rows:
        channel_value = _enum_value(channel)
        mapped = (
            "instagram"
            if channel_value == "instagram"
            else "messenger"
            if channel_value == "facebook"
            else channel_value or "unknown"
        )
        results.append(
            {
                "channel": mapped,
                "lead_id": str(lead_id) if lead_id else None,
                "contact_name": display_name(first_name, last_name, profile_name),
                "body": _truncate(body, MAX_MESSAGE_CHARS),
                "_sent_at": _as_utc(sent_at) if sent_at is not None else None,
                "contact_id": str(contact_id) if contact_id else None,
            }
        )
    return results


def _enum_value(value: Any) -> str | None:
    if value is None:
        return None
    raw = getattr(value, "value", value)
    text = str(raw or "").strip()
    return text or None


def _truncate(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _as_utc(value).isoformat()


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
