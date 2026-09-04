"""Persisted done-state for org-wide insight priorities."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, Index, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.sales_daily_plan import SalesDailyPlan


class SalesDailyPlanPriorityCompletion(Base):
    """One ticked priority on a stored sales daily plan."""

    __tablename__ = "sales_daily_plan_priority_completions"
    __table_args__ = (
        UniqueConstraint(
            "plan_id",
            "priority_key",
            name="sdp_priority_completions_plan_key_uidx",
        ),
        Index("sdp_priority_completions_done_at_idx", "done_at"),
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
    priority_key: Mapped[str] = mapped_column(Text(), nullable=False)
    title: Mapped[str] = mapped_column(Text(), nullable=False)
    lead_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    invoice_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    done_by: Mapped[str] = mapped_column(Text(), nullable=False)
    done_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    plan: Mapped["SalesDailyPlan"] = relationship(
        "SalesDailyPlan",
        back_populates="priority_completions",
    )
