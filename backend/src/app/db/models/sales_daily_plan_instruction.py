"""Standing and same-day instructions for insight generation."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, Index, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base


class SalesDailyPlanInstruction(Base):
    """Operator instruction included in later insight generations."""

    __tablename__ = "sales_daily_plan_instructions"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('today', 'standing')",
            name="sdp_instructions_scope_chk",
        ),
        Index("sdp_instructions_active_idx", "archived_at", "active_until"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    instruction_text: Mapped[str] = mapped_column("text", Text(), nullable=False)
    scope: Mapped[str] = mapped_column(Text(), nullable=False)
    active_until: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    created_by: Mapped[str] = mapped_column(Text(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    archived_by: Mapped[str | None] = mapped_column(Text(), nullable=True)
