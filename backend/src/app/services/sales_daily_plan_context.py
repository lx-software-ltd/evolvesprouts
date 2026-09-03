"""Assemble capped CRM context for the org-wide sales daily plan."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models.contact import Contact
from app.db.models.enums import (
    FunnelStage,
    InstanceStatus,
    MetaMessageDirection,
    ServiceStatus,
    WhatsAppMessageDirection,
)
from app.db.models.meta import MetaConversation, MetaMessage
from app.db.models.sales_lead import SalesLead, SalesLeadEvent
from app.db.models.service import Service
from app.db.models.service_instance import InstanceSessionSlot, ServiceInstance
from app.db.models.whatsapp import WhatsAppConversation, WhatsAppMessage
from app.utils.logging import mask_email, mask_pii

MAX_SERVICES = 20
MAX_INSTANCES = 15
MAX_OPEN_LEADS = 25
MAX_CLOSED_LEADS = 8
MAX_NEEDS_REPLY = 15
MAX_NOTE_CHARS = 240
MAX_DESCRIPTION_CHARS = 400
MAX_MESSAGE_CHARS = 1000
INSTANCE_HORIZON_DAYS = 14
_OPEN_STAGES = (
    FunnelStage.NEW,
    FunnelStage.CONTACTED,
    FunnelStage.ENGAGED,
    FunnelStage.QUALIFIED,
    FunnelStage.UNQUALIFIED,
)
_CLOSED_STAGES = (FunnelStage.CONVERTED, FunnelStage.LOST)
_INSTANCE_STATUSES = (
    InstanceStatus.SCHEDULED,
    InstanceStatus.OPEN,
    InstanceStatus.FULL,
)


@dataclass(frozen=True)
class SalesDailyPlanWatermarks:
    conversation_watermark_at: datetime | None
    pipeline_watermark_at: datetime | None


def build_sales_daily_plan_context(
    session: Session,
) -> tuple[dict[str, Any], SalesDailyPlanWatermarks]:
    """Load a bounded snapshot of pipeline, catalogue, and inbox context."""
    now = datetime.now(UTC)
    catalogue = _load_catalogue(session)
    instances = _load_upcoming_instances(session, now=now)
    funnel = _load_funnel_snapshot(session, now=now)
    open_leads = _load_open_leads(session)
    closed_leads = _load_recent_closed_leads(session)
    needs_reply, conversation_watermark = _load_needs_reply_threads(session)
    pipeline_watermark = _latest_pipeline_activity_at(session)
    context = {
        "generated_for": "org_wide_sales_plan_of_the_day",
        "as_of": now.isoformat(),
        "funnel": funnel,
        "catalogue": catalogue,
        "upcoming_instances": instances,
        "open_leads": open_leads,
        "recent_closed_leads": closed_leads,
        "needs_reply_threads": needs_reply,
        "guidance": (
            "Prioritize unanswered inbound threads and late-stage open leads. "
            "Suggest concrete activities for today. Recommend which published "
            "service to push and any offer-wording tweaks grounded in message "
            "feedback. Do not invent pricing, schedules, or guarantees. If "
            "context is thin, say what to gather next."
        ),
    }
    return context, SalesDailyPlanWatermarks(
        conversation_watermark_at=conversation_watermark,
        pipeline_watermark_at=pipeline_watermark,
    )


def latest_conversation_at(session: Session) -> datetime | None:
    """Newest WhatsApp or Meta message time across the org."""
    wa_max = session.scalar(select(func.max(WhatsAppMessage.sent_at)))
    meta_max = session.scalar(select(func.max(MetaMessage.sent_at)))
    return _max_dt(wa_max, meta_max)


def latest_pipeline_activity_at(session: Session) -> datetime | None:
    """Newest lead create or funnel-stage event time."""
    return _latest_pipeline_activity_at(session)


def _load_catalogue(session: Session) -> list[dict[str, Any]]:
    rows = list(
        session.scalars(
            select(Service)
            .where(Service.status == ServiceStatus.PUBLISHED)
            .order_by(Service.updated_at.desc())
            .limit(MAX_SERVICES)
        ).all()
    )
    return [
        {
            "id": str(service.id),
            "title": service.title,
            "service_type": _enum_value(service.service_type),
            "service_tier": service.service_tier,
            "delivery_mode": _enum_value(service.delivery_mode),
            "status": _enum_value(service.status),
            "description": _truncate(service.description, MAX_DESCRIPTION_CHARS),
        }
        for service in rows
    ]


def _load_upcoming_instances(
    session: Session, *, now: datetime
) -> list[dict[str, Any]]:
    horizon = now + timedelta(days=INSTANCE_HORIZON_DAYS)
    earliest_slot = (
        select(func.min(InstanceSessionSlot.starts_at))
        .where(InstanceSessionSlot.instance_id == ServiceInstance.id)
        .where(InstanceSessionSlot.starts_at >= now)
        .where(InstanceSessionSlot.starts_at <= horizon)
        .correlate(ServiceInstance)
        .scalar_subquery()
    )
    statement: Select[tuple[ServiceInstance]] = (
        select(ServiceInstance)
        .options(
            selectinload(ServiceInstance.service),
            selectinload(ServiceInstance.session_slots),
        )
        .where(ServiceInstance.status.in_(_INSTANCE_STATUSES))
        .where(earliest_slot.is_not(None))
        .order_by(earliest_slot.asc())
        .limit(MAX_INSTANCES)
    )
    rows = list(session.scalars(statement).all())
    results: list[dict[str, Any]] = []
    for instance in rows:
        service = instance.service
        starts_at = _earliest_slot_start(
            instance.session_slots, now=now, horizon=horizon
        )
        results.append(
            {
                "id": str(instance.id),
                "title": instance.title or (service.title if service else None),
                "service_title": service.title if service else None,
                "service_type": (
                    _enum_value(service.service_type) if service else None
                ),
                "starts_at": _iso(starts_at),
                "status": _enum_value(instance.status),
                "max_capacity": instance.max_capacity,
            }
        )
    return results


def _earliest_slot_start(
    slots: list[InstanceSessionSlot] | None,
    *,
    now: datetime,
    horizon: datetime,
) -> datetime | None:
    starts: list[datetime] = []
    for slot in slots or []:
        if slot.starts_at is None:
            continue
        starts_at = _as_utc(slot.starts_at)
        if now <= starts_at <= horizon:
            starts.append(starts_at)
    if not starts:
        return None
    return min(starts)


def _load_funnel_snapshot(session: Session, *, now: datetime) -> dict[str, Any]:
    stage_counts = {
        FunnelStage.NEW.value: 0,
        FunnelStage.CONTACTED.value: 0,
        FunnelStage.ENGAGED.value: 0,
        FunnelStage.QUALIFIED.value: 0,
        FunnelStage.UNQUALIFIED.value: 0,
        FunnelStage.CONVERTED.value: 0,
        FunnelStage.LOST.value: 0,
    }
    for stage, count in session.execute(
        select(SalesLead.funnel_stage, func.count(SalesLead.id)).group_by(
            SalesLead.funnel_stage
        )
    ).all():
        if stage is not None:
            stage_counts[stage.value] = int(count)
    week_start = datetime.combine(
        (now - timedelta(days=now.weekday())).date(),
        datetime.min.time(),
        tzinfo=UTC,
    )
    month_start = datetime.combine(
        date(now.year, now.month, 1),
        datetime.min.time(),
        tzinfo=UTC,
    )
    return {
        "stage_counts": stage_counts,
        "leads_this_week": _count_leads_since(session, week_start),
        "leads_this_month": _count_leads_since(session, month_start),
        "open_count": sum(stage_counts[stage.value] for stage in _OPEN_STAGES),
    }


def _count_leads_since(session: Session, since: datetime) -> int:
    value = session.scalar(
        select(func.count(SalesLead.id)).where(SalesLead.created_at >= since)
    )
    return int(value or 0)


def _load_open_leads(session: Session) -> list[dict[str, Any]]:
    statement: Select[tuple[SalesLead]] = (
        select(SalesLead)
        .options(selectinload(SalesLead.contact), selectinload(SalesLead.notes))
        .where(SalesLead.funnel_stage.in_(_OPEN_STAGES))
        .order_by(SalesLead.updated_at.desc())
        .limit(MAX_OPEN_LEADS)
    )
    return [_serialize_lead_summary(lead) for lead in session.scalars(statement).all()]


def _load_recent_closed_leads(session: Session) -> list[dict[str, Any]]:
    statement: Select[tuple[SalesLead]] = (
        select(SalesLead)
        .options(selectinload(SalesLead.contact), selectinload(SalesLead.notes))
        .where(SalesLead.funnel_stage.in_(_CLOSED_STAGES))
        .order_by(SalesLead.updated_at.desc())
        .limit(MAX_CLOSED_LEADS)
    )
    return [_serialize_lead_summary(lead) for lead in session.scalars(statement).all()]


def _serialize_lead_summary(lead: SalesLead) -> dict[str, Any]:
    notes = sorted(
        list(lead.notes or []),
        key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    last_note = notes[0].content if notes and notes[0].content else None
    contact = lead.contact
    contact_block: dict[str, Any] | None = None
    if contact is not None:
        contact_block = _serialize_contact(contact)
    return {
        "id": str(lead.id),
        "lead_type": _enum_value(lead.lead_type),
        "funnel_stage": _enum_value(lead.funnel_stage),
        "assigned_to": lead.assigned_to,
        "lost_reason": _enum_value(lead.lost_reason),
        "created_at": _iso(lead.created_at),
        "updated_at": _iso(lead.updated_at),
        "converted_at": _iso(lead.converted_at),
        "lost_at": _iso(lead.lost_at),
        "last_note": _truncate(last_note, MAX_NOTE_CHARS),
        "contact": contact_block,
    }


def _serialize_contact(contact: Contact) -> dict[str, Any]:
    return {
        "first_name": contact.first_name,
        "last_name": contact.last_name,
        "email": mask_email(contact.email) if contact.email else None,
        "phone": mask_pii(contact.phone_e164 or "") if contact.phone_e164 else None,
        "instagram_handle": contact.instagram_handle,
        "source": _enum_value(contact.source),
        "source_detail": contact.source_detail,
    }


def _load_needs_reply_threads(
    session: Session,
) -> tuple[list[dict[str, Any]], datetime | None]:
    conversation_watermark = latest_conversation_at(session)
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
                "contact_name": _display_name(first_name, last_name, profile_name),
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
                "contact_name": _display_name(first_name, last_name, profile_name),
                "body": _truncate(body, MAX_MESSAGE_CHARS),
                "_sent_at": _as_utc(sent_at) if sent_at is not None else None,
                "contact_id": str(contact_id) if contact_id else None,
            }
        )
    return results


def _latest_pipeline_activity_at(session: Session) -> datetime | None:
    lead_created = session.scalar(select(func.max(SalesLead.created_at)))
    event_created = session.scalar(select(func.max(SalesLeadEvent.created_at)))
    return _max_dt(lead_created, event_created)


def _display_name(
    first_name: str | None,
    last_name: str | None,
    profile_name: str | None,
) -> str | None:
    parts = [part for part in (first_name, last_name) if part]
    if parts:
        return " ".join(parts)
    return profile_name or None


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


def _max_dt(*values: datetime | None) -> datetime | None:
    candidates = [_as_utc(value) for value in values if value is not None]
    if not candidates:
        return None
    return max(candidates)
