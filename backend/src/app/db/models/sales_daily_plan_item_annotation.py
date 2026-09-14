"""Per-item feedback, snooze, and edited drafts on a sales daily plan."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.sales_daily_plan import SalesDailyPlan


class SalesDailyPlanItemAnnotation(Base):
    """Operator annotation on one priority or outreach row."""

    __tablename__ = "sales_daily_plan_item_annotations"
    __table_args__ = (
        UniqueConstraint(
            "plan_id",
            "item_kind",
            "item_key",
            name="sdp_item_annotations_plan_item_uidx",
        ),
        CheckConstraint(
            "item_kind IN ('priority', 'outreach')",
            name="sdp_item_annotations_kind_chk",
        ),
        CheckConstraint(
            "feedback IS NULL OR feedback IN ('up', 'down', 'not_relevant')",
            name="sdp_item_annotations_feedback_chk",
        ),
        Index("sdp_item_annotations_snooze_idx", "snoozed_until"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    plan_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sales_daily_plans.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_kind: Mapped[str] = mapped_column(Text(), nullable=False)
    item_key: Mapped[str] = mapped_column(Text(), nullable=False)
    feedback: Mapped[str | None] = mapped_column(Text(), nullable=True)
    snoozed_until: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    draft_reply: Mapped[str | None] = mapped_column(Text(), nullable=True)
    updated_by: Mapped[str] = mapped_column(Text(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    plan: Mapped["SalesDailyPlan"] = relationship(
        "SalesDailyPlan",
        back_populates="item_annotations",
    )
