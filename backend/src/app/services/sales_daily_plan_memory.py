"""Persisted sales daily plan memory (prior insights and refinements)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, delete, select
from sqlalchemy.orm import Session

from app.db.models.sales_daily_plan import SalesDailyPlan
from app.db.models.sales_daily_plan_job import SalesDailyPlanJob
from app.services.sales_daily_plan_identity import priority_identity
from app.services.sales_daily_plan_instructions import delete_instructions_for_reset
from app.services.sales_daily_plan_item_state import delete_item_states_for_reset
from app.services.sales_daily_plan_payload import compact_priority_memory

MEMORY_PLAN_LIMIT = 5
MAX_OPERATOR_INPUT_LENGTH = 4000


def list_recent_plans(
    session: Session,
    *,
    limit: int = MEMORY_PLAN_LIMIT,
) -> list[SalesDailyPlan]:
    """Return the newest stored plans, newest first."""
    statement: Select[tuple[SalesDailyPlan]] = (
        select(SalesDailyPlan).order_by(SalesDailyPlan.generated_at.desc()).limit(limit)
    )
    return list(session.scalars(statement).all())


def serialize_memory_entry(plan: SalesDailyPlan) -> dict[str, Any]:
    """Compact history row for the admin GET payload."""
    payload = plan.payload if isinstance(plan.payload, dict) else {}
    return {
        "id": str(plan.id),
        "generated_at": _as_utc(plan.generated_at).isoformat(),
        "focus": str(payload.get("focus") or ""),
        "product_focus": str(payload.get("product_focus") or ""),
        "operator_input": plan.operator_input,
        "priorities": compact_priority_memory(payload),
    }


def load_prior_plans_for_context(
    session: Session,
    *,
    limit: int = MEMORY_PLAN_LIMIT,
) -> list[dict[str, Any]]:
    """Serialize recent plans oldest-first as compact prompt memory."""
    rows = list(reversed(list_recent_plans(session, limit=limit)))
    return [compact_plan_for_prompt(plan) for plan in rows]


def compact_plan_for_prompt(plan: SalesDailyPlan) -> dict[str, Any]:
    """History the model may use. Omits drafts and per-item done flags."""
    payload = plan.payload if isinstance(plan.payload, dict) else {}
    priorities: list[dict[str, Any]] = []
    for entry in payload.get("priorities") or []:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or "").strip()
        if not title:
            continue
        priorities.append(
            {
                "title": title,
                "kind": entry.get("kind"),
                "lead_id": entry.get("lead_id"),
                "invoice_id": entry.get("invoice_id"),
                "item_key": entry.get("item_key")
                or priority_identity(
                    kind=_text(entry.get("kind")),
                    lead_id=entry.get("lead_id"),
                    invoice_id=entry.get("invoice_id"),
                    conversation_id=entry.get("conversation_id"),
                    title=title,
                    instruction_id=entry.get("instruction_id"),
                ),
            }
        )
    return {
        "generated_at": _as_utc(plan.generated_at).isoformat(),
        "operator_input": plan.operator_input,
        "focus": str(payload.get("focus") or ""),
        "product_focus": str(payload.get("product_focus") or ""),
        "priorities": priorities,
    }


def reset_sales_daily_plan_memory(session: Session) -> None:
    """Delete plans, jobs, item state, and instructions."""
    delete_item_states_for_reset(session)
    delete_instructions_for_reset(session)
    session.execute(delete(SalesDailyPlanJob))
    session.execute(delete(SalesDailyPlan))


def _text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
