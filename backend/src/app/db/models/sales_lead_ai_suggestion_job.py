"""Async job tracking for lead AI close suggestions."""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base


class SalesLeadAiSuggestionJobStatus(str, enum.Enum):
    """Worker lifecycle for a lead AI suggestion job."""

    PENDING = "pending"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


def _job_status_values(enum_cls: object) -> list[str]:
    del enum_cls
    return [member.value for member in SalesLeadAiSuggestionJobStatus]


class SalesLeadAiSuggestionJob(Base):
    """Queued OpenRouter generation for a sales lead close suggestion."""

    __tablename__ = "sales_lead_ai_suggestion_jobs"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    lead_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sales_leads.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_by: Mapped[str] = mapped_column(Text(), nullable=False)
    status: Mapped[SalesLeadAiSuggestionJobStatus] = mapped_column(
        SAEnum(
            SalesLeadAiSuggestionJobStatus,
            native_enum=False,
            length=32,
            values_callable=_job_status_values,
        ),
        nullable=False,
    )
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)
    suggestion_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sales_lead_ai_suggestions.id", ondelete="SET NULL"),
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
