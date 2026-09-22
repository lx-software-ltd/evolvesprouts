"""Org-wide done, dismiss, and snooze state for insight items."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Select, delete, select
from sqlalchemy.orm import Session

from app.db.models.sales_daily_plan_item_state import SalesDailyPlanItemState
from app.services.sales_daily_plan_identity import (
    outreach_identity,
    priority_identity,
    uuid_text,
)
from app.services.sales_daily_plan_time import as_utc, next_business_day_start

COMPLETION_MEMORY_DAYS = 7
DISMISS_SUPPRESS_DAYS = 30
SUPPRESSED_CONTEXT_LIMIT = 40


def load_suppressed_for_context(
    session: Session,
    *,
    now: datetime | None = None,
    limit: int = SUPPRESSED_CONTEXT_LIMIT,
) -> list[dict[str, Any]]:
    """Items the next generation must hide, newest update first."""
    if not hasattr(session, "scalars"):
        return []
    current = now or datetime.now(UTC)
    statement: Select[tuple[SalesDailyPlanItemState]] = (
        select(SalesDailyPlanItemState)
        .order_by(SalesDailyPlanItemState.updated_at.desc())
        .limit(max(limit * 4, limit))
    )
    rows = [
        row
        for row in session.scalars(statement).all()
        if suppression_reason(row, current) is not None
    ]
    return [serialize_suppressed(row, current) for row in rows[:limit]]


def load_recent_completions_for_context(
    session: Session,
    *,
    now: datetime | None = None,
    days: int = COMPLETION_MEMORY_DAYS,
) -> list[dict[str, Any]]:
    """Recent ticks so the model can see what was finished."""
    if not hasattr(session, "scalars"):
        return []
    current = now or datetime.now(UTC)
    since = current - timedelta(days=days)
    statement: Select[tuple[SalesDailyPlanItemState]] = (
        select(SalesDailyPlanItemState)
        .where(SalesDailyPlanItemState.done_at.is_not(None))
        .where(SalesDailyPlanItemState.done_at >= since)
        .order_by(SalesDailyPlanItemState.done_at.desc())
    )
    return [serialize_completion(row) for row in session.scalars(statement).all()]


def load_done_identities(session: Session) -> set[str]:
    if not hasattr(session, "scalars"):
        return set()
    statement = select(SalesDailyPlanItemState.item_identity).where(
        SalesDailyPlanItemState.done_at.is_not(None)
    )
    return {str(value) for value in session.scalars(statement).all() if value}


def apply_item_states(
    session: Session,
    *,
    priorities: list[dict[str, Any]],
    outreach: list[dict[str, Any]],
    now: datetime | None = None,
) -> None:
    """Attach cross-plan done, feedback, and snooze onto serialized items."""
    current = now or datetime.now(UTC)
    for item in priorities:
        item["item_key"] = priority_identity(
            kind=_text(item.get("kind")),
            lead_id=item.get("lead_id"),
            invoice_id=item.get("invoice_id"),
            conversation_id=item.get("conversation_id"),
            title=str(item.get("title") or ""),
            instruction_id=item.get("instruction_id"),
        )
        item.setdefault("done", False)
        item.setdefault("feedback", None)
        item.setdefault("snoozed_until", None)
    for item in outreach:
        item["item_key"] = outreach_identity(
            conversation_id=item.get("conversation_id"),
            lead_id=item.get("lead_id"),
            channel=_text(item.get("channel")),
            message_excerpt=str(item.get("message_excerpt") or ""),
        )
        item.setdefault("feedback", None)
        item.setdefault("snoozed_until", None)
    if not hasattr(session, "scalars"):
        return
    keys = [
        str(item.get("item_key") or "")
        for item in (*priorities, *outreach)
        if item.get("item_key")
    ]
    if not keys:
        return
    rows = {
        row.item_identity: row
        for row in session.scalars(
            select(SalesDailyPlanItemState).where(
                SalesDailyPlanItemState.item_identity.in_(keys)
            )
        ).all()
    }
    for item in priorities:
        row = rows.get(str(item.get("item_key") or ""))
        item["done"] = _is_done(row, current)
        item["feedback"] = row.feedback if row is not None else None
        item["snoozed_until"] = _snooze_iso(row)
    for item in outreach:
        row = rows.get(str(item.get("item_key") or ""))
        item["feedback"] = row.feedback if row is not None else None
        item["snoozed_until"] = _snooze_iso(row)


def set_item_done(
    session: Session,
    *,
    identity: str,
    item_kind: str,
    title: str,
    lead_id: UUID | None,
    invoice_id: UUID | None,
    conversation_id: UUID | None,
    priority_kind: str | None,
    done: bool,
    actor: str,
    source_plan_id: UUID | None,
    now: datetime | None = None,
) -> SalesDailyPlanItemState | None:
    """Tick or untick an item until the next 06:00 HKT. Returns the row when done."""
    current = now or datetime.now(UTC)
    row = _ensure_row(
        session,
        identity=identity,
        item_kind=item_kind,
        title=title,
        actor=actor,
        now=current,
    )
    _assign_links(
        row,
        lead_id=lead_id,
        invoice_id=invoice_id,
        conversation_id=conversation_id,
        priority_kind=priority_kind,
        source_plan_id=source_plan_id,
        actor=actor,
        now=current,
    )
    if done:
        row.done_at = current
        row.done_by = actor
        row.done_until = next_business_day_start(current)
    else:
        row.done_at = None
        row.done_by = None
        row.done_until = None
    session.flush()
    return row if done else None


def set_item_feedback(
    session: Session,
    *,
    identity: str,
    item_kind: str,
    title: str,
    feedback: str | None,
    actor: str,
    lead_id: UUID | None = None,
    invoice_id: UUID | None = None,
    conversation_id: UUID | None = None,
    source_plan_id: UUID | None = None,
    now: datetime | None = None,
) -> SalesDailyPlanItemState:
    current = now or datetime.now(UTC)
    row = _ensure_row(
        session,
        identity=identity,
        item_kind=item_kind,
        title=title,
        actor=actor,
        now=current,
    )
    _assign_links(
        row,
        lead_id=lead_id,
        invoice_id=invoice_id,
        conversation_id=conversation_id,
        priority_kind=None,
        source_plan_id=source_plan_id,
        actor=actor,
        now=current,
    )
    row.feedback = feedback
    if feedback in {"down", "not_relevant"}:
        row.dismissed_until = current + timedelta(days=DISMISS_SUPPRESS_DAYS)
    else:
        row.dismissed_until = None
    session.flush()
    return row


def set_item_snooze(
    session: Session,
    *,
    identity: str,
    item_kind: str,
    title: str,
    snoozed_until: datetime | None,
    actor: str,
    lead_id: UUID | None = None,
    invoice_id: UUID | None = None,
    conversation_id: UUID | None = None,
    source_plan_id: UUID | None = None,
    now: datetime | None = None,
) -> SalesDailyPlanItemState:
    current = now or datetime.now(UTC)
    row = _ensure_row(
        session,
        identity=identity,
        item_kind=item_kind,
        title=title,
        actor=actor,
        now=current,
    )
    _assign_links(
        row,
        lead_id=lead_id,
        invoice_id=invoice_id,
        conversation_id=conversation_id,
        priority_kind=None,
        source_plan_id=source_plan_id,
        actor=actor,
        now=current,
    )
    row.snoozed_until = snoozed_until
    session.flush()
    return row


def serialize_completion(row: SalesDailyPlanItemState) -> dict[str, Any]:
    return {
        "title": row.title,
        "item_key": row.item_identity,
        "lead_id": str(row.lead_id) if row.lead_id else None,
        "invoice_id": str(row.invoice_id) if row.invoice_id else None,
        "done_at": row.done_at.isoformat() if row.done_at else None,
        "done_until": row.done_until.isoformat() if row.done_until else None,
        "done_by": row.done_by,
    }


def serialize_suppressed(row: SalesDailyPlanItemState, now: datetime) -> dict[str, Any]:
    return {
        "item_key": row.item_identity,
        "item_kind": row.item_kind,
        "title": row.title,
        "reason": suppression_reason(row, now),
        "done_at": row.done_at.isoformat() if row.done_at else None,
        "lead_id": str(row.lead_id) if row.lead_id else None,
        "invoice_id": str(row.invoice_id) if row.invoice_id else None,
        "conversation_id": str(row.conversation_id) if row.conversation_id else None,
    }


def suppression_reason(row: SalesDailyPlanItemState, now: datetime) -> str | None:
    current = as_utc(now)
    if row.done_until is not None and as_utc(row.done_until) > current:
        return "done_today"
    if row.snoozed_until is not None and as_utc(row.snoozed_until) > current:
        return "snoozed"
    if (
        row.feedback in {"down", "not_relevant"}
        and row.dismissed_until is not None
        and as_utc(row.dismissed_until) > current
    ):
        return "dismissed"
    return None


def release_cleared_suppressions(
    session: Session,
    *,
    priorities: list[dict[str, Any]],
    outreach: list[dict[str, Any]],
    suppressed: list[dict[str, Any]],
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Drop hidden rows that were un-ticked and show those priorities again."""
    if not suppressed or not hasattr(session, "scalars"):
        return suppressed
    current = now or datetime.now(UTC)
    keys = [
        str(item.get("item_key") or "") for item in suppressed if item.get("item_key")
    ]
    rows = {
        row.item_identity: row
        for row in session.scalars(
            select(SalesDailyPlanItemState).where(
                SalesDailyPlanItemState.item_identity.in_(keys)
            )
        ).all()
    }
    present = {_item_identity(item) for item in priorities}
    present_outreach = {_outreach_identity(item) for item in outreach}
    still: list[dict[str, Any]] = []
    for item in suppressed:
        identity = str(item.get("item_key") or "")
        row = rows.get(identity)
        if row is not None and suppression_reason(row, current) is not None:
            still.append(item)
            continue
        if str(item.get("item_kind") or "") == "outreach":
            if identity not in present_outreach:
                outreach.append(_restored_outreach(item))
            continue
        if identity not in present:
            priorities.append(_restored_priority(item))
    return still


def _item_identity(item: dict[str, Any]) -> str:
    return str(item.get("item_key") or "") or priority_identity(
        kind=_text(item.get("kind")),
        lead_id=item.get("lead_id"),
        invoice_id=item.get("invoice_id"),
        conversation_id=item.get("conversation_id"),
        title=str(item.get("title") or ""),
        instruction_id=item.get("instruction_id"),
    )


def _outreach_identity(item: dict[str, Any]) -> str:
    return str(item.get("item_key") or "") or outreach_identity(
        conversation_id=item.get("conversation_id"),
        lead_id=item.get("lead_id"),
        channel=_text(item.get("channel")),
        message_excerpt=str(item.get("message_excerpt") or item.get("title") or ""),
    )


def _restored_priority(item: dict[str, Any]) -> dict[str, Any]:
    identity = str(item.get("item_key") or "")
    instruction_id = (
        identity.split(":", 1)[1] if identity.startswith("instruction:") else None
    )
    return {
        "title": str(item.get("title") or ""),
        "why": "",
        "action": "",
        "lead_id": item.get("lead_id"),
        "invoice_id": item.get("invoice_id"),
        "conversation_id": None,
        "channel": None,
        "kind": None,
        "urgency": 2,
        "sources": ["instruction"] if instruction_id else [],
        "assigned_to": None,
        "instruction_id": instruction_id,
        "from_instruction": bool(instruction_id),
        "resurfaced": False,
        "done": False,
        "item_key": identity or None,
    }


def _restored_outreach(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": "unknown",
        "lead_id": item.get("lead_id"),
        "conversation_id": None,
        "message_excerpt": str(item.get("title") or ""),
        "draft_reply": "",
        "rationale": "",
        "assigned_to": None,
        "item_key": item.get("item_key"),
    }


def delete_item_states_for_reset(session: Session) -> None:
    session.execute(delete(SalesDailyPlanItemState))


def _ensure_row(
    session: Session,
    *,
    identity: str,
    item_kind: str,
    title: str,
    actor: str,
    now: datetime,
) -> SalesDailyPlanItemState:
    existing = session.scalars(
        select(SalesDailyPlanItemState).where(
            SalesDailyPlanItemState.item_identity == identity
        )
    ).first()
    label = title.strip() or identity
    if existing is None:
        existing = SalesDailyPlanItemState(
            item_identity=identity,
            item_kind=item_kind,
            title=label,
            updated_by=actor,
            updated_at=now,
        )
        session.add(existing)
        return existing
    if title.strip():
        existing.title = title.strip()
    existing.item_kind = item_kind
    existing.updated_by = actor
    existing.updated_at = now
    return existing


def _assign_links(
    row: SalesDailyPlanItemState,
    *,
    lead_id: UUID | None,
    invoice_id: UUID | None,
    conversation_id: UUID | None,
    priority_kind: str | None,
    source_plan_id: UUID | None,
    actor: str,
    now: datetime,
) -> None:
    if lead_id is not None:
        row.lead_id = lead_id
    if invoice_id is not None:
        row.invoice_id = invoice_id
    if conversation_id is not None:
        row.conversation_id = conversation_id
    if priority_kind:
        row.priority_kind = priority_kind
    if source_plan_id is not None:
        row.source_plan_id = source_plan_id
    row.updated_by = actor
    row.updated_at = now


def _is_done(row: SalesDailyPlanItemState | None, now: datetime) -> bool:
    if row is None or row.done_until is None:
        return False
    return as_utc(row.done_until) > as_utc(now)


def _snooze_iso(row: SalesDailyPlanItemState | None) -> str | None:
    if row is None or row.snoozed_until is None:
        return None
    return as_utc(row.snoozed_until).isoformat()


def _text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def optional_state_uuid(value: Any) -> str | None:
    return uuid_text(value)
