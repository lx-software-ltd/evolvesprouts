"""Staleness counts, comparison, and assignee hydration for the insight board."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.contact import Contact
from app.db.models.meta import MetaMessage
from app.db.models.sales_daily_plan import SalesDailyPlan
from app.db.models.sales_lead import SalesLead, SalesLeadEvent
from app.db.models.whatsapp import WhatsAppMessage
from app.services.sales_daily_plan_completions import priority_key
from app.services.sales_daily_plan_memory import list_recent_plans


def stale_activity_counts(
    session: Session,
    *,
    plan: SalesDailyPlan,
) -> dict[str, int]:
    """How much CRM activity landed after the stored watermarks."""
    zeros = {
        "new_conversation": 0,
        "pipeline_changed": 0,
        "contacts_changed": 0,
    }
    if not hasattr(session, "scalar"):
        return zeros
    conversation_watermark = _as_utc_or_none(plan.conversation_watermark_at)
    pipeline_watermark = _as_utc_or_none(plan.pipeline_watermark_at)
    conversation_count = 0
    if conversation_watermark is not None:
        wa_count = session.scalar(
            select(func.count())
            .select_from(WhatsAppMessage)
            .where(WhatsAppMessage.sent_at > conversation_watermark)
        )
        meta_count = session.scalar(
            select(func.count())
            .select_from(MetaMessage)
            .where(MetaMessage.sent_at > conversation_watermark)
        )
        conversation_count = int(wa_count or 0) + int(meta_count or 0)
    pipeline_count = 0
    if pipeline_watermark is not None:
        lead_count = session.scalar(
            select(func.count())
            .select_from(SalesLead)
            .where(SalesLead.created_at > pipeline_watermark)
        )
        event_count = session.scalar(
            select(func.count())
            .select_from(SalesLeadEvent)
            .where(SalesLeadEvent.created_at > pipeline_watermark)
        )
        pipeline_count = int(lead_count or 0) + int(event_count or 0)
    contact_count = 0
    if pipeline_watermark is not None:
        created = session.scalar(
            select(func.count())
            .select_from(Contact)
            .where(Contact.created_at > pipeline_watermark)
        )
        updated = session.scalar(
            select(func.count())
            .select_from(Contact)
            .where(Contact.updated_at > pipeline_watermark)
            .where(Contact.created_at <= pipeline_watermark)
        )
        contact_count = int(created or 0) + int(updated or 0)
    return {
        "new_conversation": conversation_count,
        "pipeline_changed": pipeline_count,
        "contacts_changed": contact_count,
    }


def apply_comparison(
    session: Session,
    *,
    plan: SalesDailyPlan,
    priorities: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Mark current priorities new/carried and return dropped previous items."""
    for item in priorities:
        item["compare_status"] = "new"
    if not hasattr(session, "scalars"):
        return []
    recent = list_recent_plans(session, limit=2)
    previous = next((row for row in recent if row.id != plan.id), None)
    if previous is None:
        return []
    previous_payload = previous.payload if isinstance(previous.payload, dict) else {}
    previous_items = previous_payload.get("priorities") or []
    previous_by_key: dict[str, dict[str, Any]] = {}
    for entry in previous_items:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or "").strip()
        if not title:
            continue
        key = priority_key(title, entry.get("lead_id"), entry.get("invoice_id"))
        previous_by_key[key] = {
            "title": title,
            "lead_id": entry.get("lead_id"),
            "invoice_id": entry.get("invoice_id"),
        }
    current_keys: set[str] = set()
    for item in priorities:
        key = str(item.get("item_key") or "") or priority_key(
            str(item.get("title") or ""),
            item.get("lead_id"),
            item.get("invoice_id"),
        )
        current_keys.add(key)
        item["compare_status"] = "carried" if key in previous_by_key else "new"
    return [value for key, value in previous_by_key.items() if key not in current_keys]


def hydrate_assigned_to(
    session: Session,
    *,
    priorities: list[dict[str, Any]],
    outreach: list[dict[str, Any]],
) -> None:
    """Fill assigned_to from live leads when the model omitted it."""
    if not hasattr(session, "execute"):
        return
    raw_ids: list[UUID] = []
    for item in (*priorities, *outreach):
        text = str(item.get("lead_id") or "").strip()
        if not text:
            continue
        try:
            raw_ids.append(UUID(text))
        except ValueError:
            continue
    if not raw_ids:
        return
    rows = session.execute(
        select(SalesLead.id, SalesLead.assigned_to).where(SalesLead.id.in_(raw_ids))
    ).all()
    assigned = {str(lead_id): assignee for lead_id, assignee in rows}
    for item in (*priorities, *outreach):
        if item.get("assigned_to"):
            continue
        lead_id = str(item.get("lead_id") or "")
        if lead_id in assigned:
            item["assigned_to"] = assigned[lead_id]


def _as_utc_or_none(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
