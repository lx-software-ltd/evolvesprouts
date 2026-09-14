"""Extra CRM signals for the sales daily plan prompt (trends and memory)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.db.models.enums import FunnelStage, LeadEventType
from app.db.models.note import Note
from app.db.models.sales_lead import SalesLead, SalesLeadEvent
from app.services.sales_daily_plan_annotations import load_item_feedback_memory
from app.services.sales_daily_plan_completions import (
    list_completions_for_plan,
    priority_key,
)
from app.services.sales_daily_plan_memory import list_recent_plans

_CLOSED_STAGES = (FunnelStage.CONVERTED, FunnelStage.LOST)
# Product jurisdiction wall time (same IANA zone as the 06:00 HKT schedule).
_BUSINESS_TZ = ZoneInfo("Asia/Hong_Kong")
MAX_STILL_OPEN = 15
MAX_OUTCOMES = 12
MAX_CHASE_NOTE_CHARS = 240


def enrich_sales_daily_plan_context(
    session: Session,
    context: dict[str, Any],
    *,
    now: datetime,
) -> dict[str, Any]:
    """Mutate and return context with trends, follow-through, and aging."""
    enrich_open_leads(session, context.get("open_leads") or [], now=now)
    attach_invoice_chase_notes(session, context.get("unpaid_invoices") or [])
    context["trends"] = build_week_over_week_trends(
        session, now=now, funnel=context.get("funnel")
    )
    context["yesterday_follow_through"] = build_yesterday_follow_through(session)
    context["recent_outcome_memory"] = build_outcome_memory(session)
    context["item_feedback_memory"] = load_item_feedback_memory(session, now=now)
    return context


def enrich_open_leads(
    session: Session,
    leads: list[dict[str, Any]],
    *,
    now: datetime,
) -> None:
    """Add days-in-stage and days-since-last-contact onto serialized leads."""
    lead_ids: list[UUID] = []
    for item in leads:
        text = str(item.get("id") or "").strip()
        if not text:
            continue
        try:
            lead_ids.append(UUID(text))
        except ValueError:
            continue
    stage_started = _latest_stage_changed_at(session, lead_ids)
    for item in leads:
        created_at = _parse_iso(item.get("created_at"))
        last_note_at = _parse_iso(item.get("last_note_at"))
        lead_id = str(item.get("id") or "")
        started = stage_started.get(lead_id) or created_at
        item["days_in_stage"] = _days_between(now, started)
        item["days_since_last_contact"] = _days_between(now, last_note_at)


def attach_invoice_chase_notes(
    session: Session,
    invoices: list[dict[str, Any]],
) -> None:
    """Attach the newest contact note for each unpaid invoice bill-to."""
    if not hasattr(session, "execute"):
        return
    contact_ids: list[UUID] = []
    for invoice in invoices:
        text = str(invoice.get("bill_to_contact_id") or "").strip()
        if not text:
            continue
        try:
            contact_ids.append(UUID(text))
        except ValueError:
            continue
    if not contact_ids:
        return
    ranked = (
        select(
            Note.contact_id,
            Note.content,
            Note.created_at,
            func.row_number()
            .over(partition_by=Note.contact_id, order_by=Note.created_at.desc())
            .label("rn"),
        ).where(Note.contact_id.in_(contact_ids))
    ).subquery()
    rows = session.execute(
        select(ranked.c.contact_id, ranked.c.content).where(ranked.c.rn == 1)
    ).all()
    notes = {
        str(contact_id): _truncate(content, MAX_CHASE_NOTE_CHARS)
        for contact_id, content in rows
    }
    for invoice in invoices:
        contact_id = str(invoice.get("bill_to_contact_id") or "")
        invoice["last_contact_note"] = notes.get(contact_id)


def build_week_over_week_trends(
    session: Session,
    *,
    now: datetime,
    funnel: Any,
) -> dict[str, Any]:
    local_now = _in_business_tz(now)
    week_start = datetime.combine(
        local_now.date() - timedelta(days=local_now.weekday()),
        datetime.min.time(),
        tzinfo=_BUSINESS_TZ,
    )
    last_week_start = week_start - timedelta(days=7)
    leads_this_week = _count_leads_created(session, week_start, now)
    leads_last_week = _count_leads_created(session, last_week_start, week_start)
    converted_this_week = _count_leads_converted(session, week_start, now)
    converted_last_week = _count_leads_converted(session, last_week_start, week_start)
    funnel_block = funnel if isinstance(funnel, dict) else {}
    return {
        "leads_this_week": leads_this_week,
        "leads_last_week": leads_last_week,
        "leads_wow_delta": leads_this_week - leads_last_week,
        "converted_this_week": converted_this_week,
        "converted_last_week": converted_last_week,
        "converted_wow_delta": converted_this_week - converted_last_week,
        "open_count": funnel_block.get("open_count"),
    }


def build_yesterday_follow_through(session: Session) -> dict[str, Any]:
    """How many priorities from the latest stored plan were ticked."""
    if not hasattr(session, "scalars"):
        return {"previous_priority_count": 0, "completed_count": 0, "still_open": []}
    plans = list_recent_plans(session, limit=1)
    if not plans:
        return {"previous_priority_count": 0, "completed_count": 0, "still_open": []}
    plan = plans[0]
    payload = plan.payload if isinstance(plan.payload, dict) else {}
    completions = {
        row.priority_key for row in list_completions_for_plan(session, plan.id)
    }
    still_open: list[dict[str, Any]] = []
    completed = 0
    total = 0
    for entry in payload.get("priorities") or []:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or "").strip()
        if not title:
            continue
        total += 1
        key = priority_key(title, entry.get("lead_id"), entry.get("invoice_id"))
        if key in completions:
            completed += 1
            continue
        if len(still_open) < MAX_STILL_OPEN:
            still_open.append(
                {
                    "title": title,
                    "lead_id": entry.get("lead_id"),
                    "invoice_id": entry.get("invoice_id"),
                }
            )
    return {
        "previous_priority_count": total,
        "completed_count": completed,
        "still_open": still_open,
    }


def build_outcome_memory(session: Session) -> list[dict[str, Any]]:
    """Leads previously targeted by a plan that have since been won or lost."""
    if not hasattr(session, "scalars"):
        return []
    targeted: dict[str, str] = {}
    for plan in list_recent_plans(session, limit=5):
        payload = plan.payload if isinstance(plan.payload, dict) else {}
        for entry in payload.get("priorities") or []:
            if not isinstance(entry, dict):
                continue
            lead_id = str(entry.get("lead_id") or "").strip()
            title = str(entry.get("title") or "").strip()
            if lead_id and lead_id not in targeted:
                targeted[lead_id] = title
    if not targeted:
        return []
    ids: list[UUID] = []
    for raw in targeted:
        try:
            ids.append(UUID(raw))
        except ValueError:
            continue
    if not ids:
        return []
    statement: Select[tuple[SalesLead]] = (
        select(SalesLead)
        .where(SalesLead.id.in_(ids))
        .where(SalesLead.funnel_stage.in_(_CLOSED_STAGES))
        .order_by(SalesLead.updated_at.desc())
        .limit(MAX_OUTCOMES)
    )
    results: list[dict[str, Any]] = []
    for lead in session.scalars(statement).all():
        results.append(
            {
                "lead_id": str(lead.id),
                "funnel_stage": (
                    lead.funnel_stage.value
                    if getattr(lead.funnel_stage, "value", None)
                    else str(lead.funnel_stage)
                ),
                "title": targeted.get(str(lead.id)) or "",
            }
        )
    return results


def _latest_stage_changed_at(
    session: Session, lead_ids: list[UUID]
) -> dict[str, datetime]:
    if not lead_ids or not hasattr(session, "execute"):
        return {}
    ranked = (
        select(
            SalesLeadEvent.lead_id,
            SalesLeadEvent.created_at,
            func.row_number()
            .over(
                partition_by=SalesLeadEvent.lead_id,
                order_by=SalesLeadEvent.created_at.desc(),
            )
            .label("rn"),
        )
        .where(SalesLeadEvent.lead_id.in_(lead_ids))
        .where(SalesLeadEvent.event_type == LeadEventType.STAGE_CHANGED)
    ).subquery()
    rows = session.execute(
        select(ranked.c.lead_id, ranked.c.created_at).where(ranked.c.rn == 1)
    ).all()
    return {str(lead_id): created_at for lead_id, created_at in rows if created_at}


def _count_leads_created(session: Session, start: datetime, end: datetime) -> int:
    if not hasattr(session, "scalar"):
        return 0
    value = session.scalar(
        select(func.count(SalesLead.id)).where(
            SalesLead.created_at >= start, SalesLead.created_at < end
        )
    )
    return int(value or 0)


def _count_leads_converted(session: Session, start: datetime, end: datetime) -> int:
    if not hasattr(session, "scalar"):
        return 0
    value = session.scalar(
        select(func.count(SalesLead.id)).where(
            SalesLead.converted_at >= start, SalesLead.converted_at < end
        )
    )
    return int(value or 0)


def _in_business_tz(value: datetime) -> datetime:
    current = value if value.tzinfo else value.replace(tzinfo=UTC)
    return current.astimezone(_BUSINESS_TZ)


def _days_between(now: datetime, earlier: datetime | None) -> int | None:
    if earlier is None:
        return None
    return max(0, (_in_business_tz(now).date() - _in_business_tz(earlier).date()).days)


def _parse_iso(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _truncate(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"
