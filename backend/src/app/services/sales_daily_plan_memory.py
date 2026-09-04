"""Persisted sales daily plan memory (prior insights and refinements)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, delete, select
from sqlalchemy.orm import Session

from app.db.models.sales_daily_plan import SalesDailyPlan
from app.db.models.sales_daily_plan_job import SalesDailyPlanJob
from app.services.sales_daily_plan_completions import delete_completions_for_reset

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
    }


def load_prior_plans_for_context(
    session: Session,
    *,
    limit: int = MEMORY_PLAN_LIMIT,
) -> list[dict[str, Any]]:
    """Serialize recent plans oldest-first for the OpenRouter prompt."""
    rows = list(reversed(list_recent_plans(session, limit=limit)))
    memory: list[dict[str, Any]] = []
    for plan in rows:
        payload = plan.payload if isinstance(plan.payload, dict) else {}
        memory.append(
            {
                "generated_at": _as_utc(plan.generated_at).isoformat(),
                "operator_input": plan.operator_input,
                "plan": payload,
            }
        )
    return memory


def reset_sales_daily_plan_memory(session: Session) -> None:
    """Delete every stored daily plan, job, and refinement."""
    delete_completions_for_reset(session)
    session.execute(delete(SalesDailyPlanJob))
    session.execute(delete(SalesDailyPlan))


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
