"""Persisted org-wide AI sales daily plans."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.sales_daily_plan_priority_completion import (
        SalesDailyPlanPriorityCompletion,
    )


class SalesDailyPlan(Base):
    """One generated org-wide sales plan of the day."""

    __tablename__ = "sales_daily_plans"
    __table_args__ = (Index("sales_daily_plans_generated_idx", "generated_at"),)

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB(), nullable=False)
    conversation_watermark_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    pipeline_watermark_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    generated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    generated_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    generated_by_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    model: Mapped[str | None] = mapped_column(String(256), nullable=True)
    operator_input: Mapped[str | None] = mapped_column(Text(), nullable=True)

    priority_completions: Mapped[list["SalesDailyPlanPriorityCompletion"]] = (
        relationship(
            "SalesDailyPlanPriorityCompletion",
            back_populates="plan",
            cascade="all, delete-orphan",
        )
    )
