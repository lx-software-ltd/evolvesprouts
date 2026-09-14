"""Per-item feedback, snooze, and saved outreach drafts."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from app.db.models.sales_daily_plan_item_annotation import (
    SalesDailyPlanItemAnnotation,
)
from app.services.sales_daily_plan_completions import priority_key
from app.services.sales_daily_plan_payload import outreach_item_key

ANNOTATION_MEMORY_LIMIT = 30
FEEDBACK_VALUES = ("up", "down", "not_relevant")
ITEM_KINDS = ("priority", "outreach")
SNOOZE_TOMORROW = timedelta(days=1)
SNOOZE_NEXT_WEEK = timedelta(days=7)
MAX_DRAFT_REPLY = 4000


def list_annotations_for_plan(
    session: Session, plan_id: UUID
) -> list[SalesDailyPlanItemAnnotation]:
    if not hasattr(session, "scalars"):
        return []
    statement: Select[tuple[SalesDailyPlanItemAnnotation]] = select(
        SalesDailyPlanItemAnnotation
    ).where(SalesDailyPlanItemAnnotation.plan_id == plan_id)
    return list(session.scalars(statement).all())


def load_item_feedback_memory(
    session: Session,
    *,
    now: datetime | None = None,
    limit: int = ANNOTATION_MEMORY_LIMIT,
) -> list[dict[str, Any]]:
    """Rejected or still-snoozed items for the next generation."""
    if not hasattr(session, "scalars"):
        return []
    current = now or datetime.now(UTC)
    statement: Select[tuple[SalesDailyPlanItemAnnotation]] = (
        select(SalesDailyPlanItemAnnotation)
        .where(
            or_(
                SalesDailyPlanItemAnnotation.feedback.in_(("down", "not_relevant")),
                SalesDailyPlanItemAnnotation.snoozed_until > current,
            )
        )
        .order_by(SalesDailyPlanItemAnnotation.updated_at.desc())
        .limit(limit)
    )
    return [serialize_annotation(row) for row in session.scalars(statement).all()]


def serialize_annotation(row: SalesDailyPlanItemAnnotation) -> dict[str, Any]:
    return {
        "item_kind": row.item_kind,
        "item_key": row.item_key,
        "feedback": row.feedback,
        "snoozed_until": (
            _as_utc(row.snoozed_until).isoformat() if row.snoozed_until else None
        ),
        "draft_reply": row.draft_reply,
        "updated_by": row.updated_by,
        "updated_at": _as_utc(row.updated_at).isoformat() if row.updated_at else None,
    }


def apply_annotations_to_items(
    session: Session,
    *,
    plan_id: UUID,
    priorities: list[dict[str, Any]],
    outreach: list[dict[str, Any]],
) -> None:
    """Attach annotation fields and stable keys onto serialized items."""
    for item in priorities:
        item["item_key"] = priority_key(
            str(item.get("title") or ""),
            item.get("lead_id"),
            item.get("invoice_id"),
        )
        item.setdefault("feedback", None)
        item.setdefault("snoozed_until", None)
    for item in outreach:
        item["item_key"] = outreach_item_key(
            str(item.get("channel") or "unknown"),
            item.get("lead_id"),
            item.get("conversation_id"),
            str(item.get("message_excerpt") or ""),
        )
        item.setdefault("feedback", None)
        item.setdefault("snoozed_until", None)
        item.setdefault("saved_draft_reply", None)
    rows = {
        (row.item_kind, row.item_key): row
        for row in list_annotations_for_plan(session, plan_id)
    }
    for item in priorities:
        row = rows.get(("priority", str(item.get("item_key") or "")))
        if row is None:
            continue
        item["feedback"] = row.feedback
        item["snoozed_until"] = (
            _as_utc(row.snoozed_until).isoformat() if row.snoozed_until else None
        )
    for item in outreach:
        row = rows.get(("outreach", str(item.get("item_key") or "")))
        if row is None:
            continue
        item["feedback"] = row.feedback
        item["snoozed_until"] = (
            _as_utc(row.snoozed_until).isoformat() if row.snoozed_until else None
        )
        item["saved_draft_reply"] = row.draft_reply
        if row.draft_reply:
            item["draft_reply"] = row.draft_reply


def upsert_annotation(
    session: Session,
    *,
    plan_id: UUID,
    item_kind: str,
    item_key: str,
    updated_by: str,
    feedback: str | None | object = ...,
    snoozed_until: datetime | None | object = ...,
    draft_reply: str | None | object = ...,
) -> SalesDailyPlanItemAnnotation:
    """Create or update one item annotation. Ellipsis means leave unchanged."""
    existing = session.scalars(
        select(SalesDailyPlanItemAnnotation).where(
            SalesDailyPlanItemAnnotation.plan_id == plan_id,
            SalesDailyPlanItemAnnotation.item_kind == item_kind,
            SalesDailyPlanItemAnnotation.item_key == item_key,
        )
    ).first()
    if existing is None:
        existing = SalesDailyPlanItemAnnotation(
            plan_id=plan_id,
            item_kind=item_kind,
            item_key=item_key,
            updated_by=updated_by,
            updated_at=datetime.now(UTC),
        )
        session.add(existing)
    if feedback is not ...:
        existing.feedback = feedback  # type: ignore[assignment]
    if snoozed_until is not ...:
        existing.snoozed_until = snoozed_until  # type: ignore[assignment]
    if draft_reply is not ...:
        existing.draft_reply = draft_reply  # type: ignore[assignment]
    existing.updated_by = updated_by
    existing.updated_at = datetime.now(UTC)
    session.flush()
    return existing


def resolve_snoozed_until(
    snooze: str | None,
    *,
    now: datetime | None = None,
) -> datetime | None | object:
    """Map API snooze tokens to a timestamp. ``None`` input means unchanged."""
    if snooze is None:
        return ...
    snooze_preset = snooze.strip().lower()
    if snooze_preset in {"", "clear", "none"}:
        return None
    current = now or datetime.now(UTC)
    if snooze_preset == "tomorrow":
        return current + SNOOZE_TOMORROW
    if snooze_preset in {"next_week", "next-week"}:
        return current + SNOOZE_NEXT_WEEK
    raise ValueError(f"Unsupported snooze value: {snooze}")


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
