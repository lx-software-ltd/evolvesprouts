"""Done-state for insight priorities, used by the next generation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Select, delete, select
from sqlalchemy.orm import Session

from app.db.models.sales_daily_plan_priority_completion import (
    SalesDailyPlanPriorityCompletion,
)

COMPLETION_MEMORY_DAYS = 7


def priority_key(
    title: str,
    lead_id: UUID | str | None,
    invoice_id: UUID | str | None,
) -> str:
    """Stable identity for one priority row."""
    return f"{title.strip()}\n{lead_id or ''}\n{invoice_id or ''}"


def list_completions_for_plan(
    session: Session, plan_id: UUID
) -> list[SalesDailyPlanPriorityCompletion]:
    statement: Select[tuple[SalesDailyPlanPriorityCompletion]] = select(
        SalesDailyPlanPriorityCompletion
    ).where(SalesDailyPlanPriorityCompletion.plan_id == plan_id)
    return list(session.scalars(statement).all())


def load_recent_completions_for_context(
    session: Session,
    *,
    now: datetime | None = None,
    days: int = COMPLETION_MEMORY_DAYS,
) -> list[dict[str, Any]]:
    """Serialize recent ticks so the next insight can skip finished work."""
    current = now or datetime.now(UTC)
    since = current - timedelta(days=days)
    statement: Select[tuple[SalesDailyPlanPriorityCompletion]] = (
        select(SalesDailyPlanPriorityCompletion)
        .where(SalesDailyPlanPriorityCompletion.done_at >= since)
        .order_by(SalesDailyPlanPriorityCompletion.done_at.desc())
    )
    rows = list(session.scalars(statement).all())
    return [serialize_completion(row) for row in rows]


def serialize_completion(row: SalesDailyPlanPriorityCompletion) -> dict[str, Any]:
    return {
        "title": row.title,
        "lead_id": str(row.lead_id) if row.lead_id else None,
        "invoice_id": str(row.invoice_id) if row.invoice_id else None,
        "done_at": row.done_at.isoformat() if row.done_at else None,
        "done_by": row.done_by,
    }


def upsert_completion(
    session: Session,
    *,
    plan_id: UUID,
    title: str,
    lead_id: UUID | None,
    invoice_id: UUID | None,
    done_by: str,
    done: bool,
) -> SalesDailyPlanPriorityCompletion | None:
    """Create or remove a completion. Returns the row when ``done`` is true."""
    key = priority_key(title, lead_id, invoice_id)
    existing = session.scalars(
        select(SalesDailyPlanPriorityCompletion).where(
            SalesDailyPlanPriorityCompletion.plan_id == plan_id,
            SalesDailyPlanPriorityCompletion.priority_key == key,
        )
    ).first()
    if not done:
        if existing is not None:
            session.delete(existing)
        return None
    if existing is None:
        existing = SalesDailyPlanPriorityCompletion(
            plan_id=plan_id,
            priority_key=key,
            title=title.strip(),
            lead_id=lead_id,
            invoice_id=invoice_id,
            done_by=done_by,
            done_at=datetime.now(UTC),
        )
        session.add(existing)
        session.flush()
        return existing
    existing.done_by = done_by
    existing.done_at = datetime.now(UTC)
    session.flush()
    return existing


def delete_completions_for_reset(session: Session) -> None:
    """Remove every completion (called with plan/job wipe)."""
    session.execute(delete(SalesDailyPlanPriorityCompletion))
