"""Org-wide done, dismiss, and snooze state for insight items."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base


class SalesDailyPlanItemState(Base):
    """One insight item's state, shared across plan generations."""

    __tablename__ = "sales_daily_plan_item_states"
    __table_args__ = (
        UniqueConstraint("item_identity", name="sdp_item_states_identity_uidx"),
        CheckConstraint(
            "item_kind IN ('priority', 'outreach')",
            name="sdp_item_states_kind_chk",
        ),
        CheckConstraint(
            "feedback IS NULL OR feedback IN ('up', 'down', 'not_relevant')",
            name="sdp_item_states_feedback_chk",
        ),
        Index("sdp_item_states_done_until_idx", "done_until"),
        Index("sdp_item_states_snoozed_until_idx", "snoozed_until"),
        Index("sdp_item_states_updated_idx", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    item_identity: Mapped[str] = mapped_column(Text(), nullable=False)
    item_kind: Mapped[str] = mapped_column(Text(), nullable=False)
    title: Mapped[str] = mapped_column(Text(), nullable=False)
    lead_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    invoice_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    conversation_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    priority_kind: Mapped[str | None] = mapped_column(Text(), nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    done_by: Mapped[str | None] = mapped_column(Text(), nullable=True)
    done_until: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    feedback: Mapped[str | None] = mapped_column(Text(), nullable=True)
    dismissed_until: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    snoozed_until: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    source_plan_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sales_daily_plans.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by: Mapped[str] = mapped_column(Text(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
