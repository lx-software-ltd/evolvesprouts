"""Inbox import job tracking for Meta Graph history and WhatsApp exports."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base
from app.db.models.enums import MetaChannel


class InboxImportKind(str, enum.Enum):
    """Supported inbox backfill sources."""

    META_GRAPH = "meta_graph"
    WHATSAPP_EXPORT = "whatsapp_export"


class InboxImportJobStatus(str, enum.Enum):
    """Worker lifecycle for an inbox import job."""

    PENDING = "pending"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    SUCCEEDED_WITH_ERRORS = "succeeded_with_errors"
    FAILED = "failed"


def _kind_values(enum_cls: object) -> list[str]:
    del enum_cls
    return [member.value for member in InboxImportKind]


def _status_values(enum_cls: object) -> list[str]:
    del enum_cls
    return [member.value for member in InboxImportJobStatus]


def _channel_values(enum_cls: object) -> list[str]:
    del enum_cls
    return [member.value for member in MetaChannel]


class InboxImportJob(Base):
    """Queued inbox history import (Graph conversations or WhatsApp export)."""

    __tablename__ = "inbox_import_jobs"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    created_by: Mapped[str] = mapped_column(Text(), nullable=False)
    kind: Mapped[InboxImportKind] = mapped_column(
        SAEnum(
            InboxImportKind,
            native_enum=False,
            length=32,
            values_callable=_kind_values,
        ),
        nullable=False,
    )
    channel: Mapped[MetaChannel | None] = mapped_column(
        SAEnum(
            MetaChannel,
            name="meta_channel",
            values_callable=_channel_values,
            create_type=False,
        ),
        nullable=True,
    )
    attachment_asset_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="SET NULL"),
        nullable=True,
    )
    options: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[InboxImportJobStatus] = mapped_column(
        SAEnum(
            InboxImportJobStatus,
            native_enum=False,
            length=32,
            values_callable=_status_values,
        ),
        nullable=False,
    )
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)
    counters: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("timezone('utc', now())"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("timezone('utc', now())"),
    )
