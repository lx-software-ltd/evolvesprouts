"""Async job tracking for org-wide sales daily plans."""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base


class SalesDailyPlanJobStatus(str, enum.Enum):
    """Worker lifecycle for a sales daily plan job."""

    PENDING = "pending"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


def _job_status_values(enum_cls: object) -> list[str]:
    del enum_cls
    return [member.value for member in SalesDailyPlanJobStatus]


class SalesDailyPlanJob(Base):
    """Queued OpenRouter generation for an org-wide sales daily plan."""

    __tablename__ = "sales_daily_plan_jobs"
    __table_args__ = (
        Index("sales_daily_plan_jobs_created_idx", "created_at"),
        Index("sales_daily_plan_jobs_status_idx", "status"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    created_by: Mapped[str] = mapped_column(Text(), nullable=False)
    status: Mapped[SalesDailyPlanJobStatus] = mapped_column(
        SAEnum(
            SalesDailyPlanJobStatus,
            native_enum=False,
            length=32,
            values_callable=_job_status_values,
        ),
        nullable=False,
    )
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)
    plan_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sales_daily_plans.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("timezone('utc', now())"),
    )
    started_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("timezone('utc', now())"),
    )
