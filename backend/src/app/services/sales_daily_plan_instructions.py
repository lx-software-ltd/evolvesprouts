"""Operator instructions that later insight generations must honour."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.db.models.sales_daily_plan_instruction import SalesDailyPlanInstruction
from app.services.sales_daily_plan_identity import normalize_title
from app.services.sales_daily_plan_time import as_utc, next_business_day_start

INSTRUCTION_SCOPES = ("today", "standing")


def list_active_instructions(
    session: Session,
    *,
    now: datetime | None = None,
) -> list[SalesDailyPlanInstruction]:
    if not hasattr(session, "scalars"):
        return []
    current = now or datetime.now(UTC)
    statement = (
        select(SalesDailyPlanInstruction)
        .where(SalesDailyPlanInstruction.archived_at.is_(None))
        .where(
            or_(
                SalesDailyPlanInstruction.active_until.is_(None),
                SalesDailyPlanInstruction.active_until > current,
            )
        )
        .order_by(SalesDailyPlanInstruction.created_at.asc())
    )
    return list(session.scalars(statement).all())


def instructions_for_context(
    session: Session,
    *,
    now: datetime | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return ``(standing, today)`` instruction payloads for the prompt."""
    standing: list[dict[str, Any]] = []
    today: list[dict[str, Any]] = []
    for row in list_active_instructions(session, now=now):
        payload = serialize_instruction(row)
        if row.scope == "standing":
            standing.append(payload)
        else:
            today.append(payload)
    return standing, today


def create_instruction(
    session: Session,
    *,
    text: str,
    scope: str,
    created_by: str,
    now: datetime | None = None,
) -> SalesDailyPlanInstruction:
    """Create an instruction, reusing an active row with the same wording."""
    current = now or datetime.now(UTC)
    cleaned = text.strip()
    needle = normalize_title(cleaned)
    for existing in list_active_instructions(session, now=current):
        if (
            existing.scope == scope
            and normalize_title(existing.instruction_text) == needle
        ):
            return existing
    active_until = next_business_day_start(current) if scope == "today" else None
    row = SalesDailyPlanInstruction(
        instruction_text=cleaned,
        scope=scope,
        active_until=active_until,
        created_by=created_by,
        created_at=current,
    )
    session.add(row)
    session.flush()
    return row


def archive_instruction(
    session: Session,
    *,
    instruction_id: UUID,
    archived_by: str,
    now: datetime | None = None,
) -> SalesDailyPlanInstruction | None:
    if not hasattr(session, "get"):
        return None
    row = session.get(SalesDailyPlanInstruction, instruction_id)
    if row is None or row.archived_at is not None:
        return None
    row.archived_at = now or datetime.now(UTC)
    row.archived_by = archived_by
    session.flush()
    return row


def serialize_instruction(row: SalesDailyPlanInstruction) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "text": row.instruction_text,
        "scope": row.scope,
        "active_until": (
            as_utc(row.active_until).isoformat() if row.active_until else None
        ),
        "created_by": row.created_by,
        "created_at": as_utc(row.created_at).isoformat() if row.created_at else None,
    }


def delete_instruction(session: Session, *, instruction_id: UUID) -> None:
    session.execute(
        delete(SalesDailyPlanInstruction).where(
            SalesDailyPlanInstruction.id == instruction_id
        )
    )


def delete_instructions_for_reset(session: Session) -> None:
    session.execute(delete(SalesDailyPlanInstruction))
