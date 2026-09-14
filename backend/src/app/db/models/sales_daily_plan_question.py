"""Follow-up Q&A against a stored sales daily plan."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.sales_daily_plan import SalesDailyPlan


class SalesDailyPlanQuestion(Base):
    """One follow-up question and answer on a stored daily plan."""

    __tablename__ = "sales_daily_plan_questions"
    __table_args__ = (Index("sdp_questions_plan_asked_idx", "plan_id", "asked_at"),)

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
    question: Mapped[str] = mapped_column(Text(), nullable=False)
    answer: Mapped[str] = mapped_column(Text(), nullable=False)
    asked_by: Mapped[str] = mapped_column(Text(), nullable=False)
    asked_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    model: Mapped[str | None] = mapped_column(String(256), nullable=True)

    plan: Mapped["SalesDailyPlan"] = relationship(
        "SalesDailyPlan",
        back_populates="questions",
    )
