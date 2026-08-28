"""Expense invoice models."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from collections.abc import Iterable

from sqlalchemy import (
    CheckConstraint,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TIMESTAMP, Numeric

from app.db.base import Base
from app.db.models.enums import ExpenseParseStatus, ExpenseStatus

if TYPE_CHECKING:
    from app.db.models.asset import Asset
    from app.db.models.organization import Organization


def _enum_values(
    enum_cls: Iterable[ExpenseStatus | ExpenseParseStatus],
) -> list[str]:
    """Return enum labels stored in PostgreSQL."""
    return [member.value for member in enum_cls]


class Expense(Base):
    """Admin-managed expense invoice extracted from uploaded documents."""

    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint(
            "amends_expense_id IS NULL OR amends_expense_id <> id",
            name="expenses_amendment_not_self",
        ),
        CheckConstraint(
            "parse_confidence IS NULL OR (parse_confidence >= 0 AND parse_confidence <= 1)",
            name="expenses_parse_confidence_range",
        ),
        Index("expenses_status_idx", "status"),
        Index("expenses_parse_status_idx", "parse_status"),
        Index("expenses_invoice_date_idx", "invoice_date"),
        Index("expenses_amends_expense_idx", "amends_expense_id"),
        Index("expenses_vendor_idx", "vendor_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    amends_expense_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("expenses.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[ExpenseStatus] = mapped_column(
        Enum(
            ExpenseStatus,
            name="expense_status",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
        server_default=text("'draft'"),
    )
    parse_status: Mapped[ExpenseParseStatus] = mapped_column(
        Enum(
            ExpenseParseStatus,
            name="expense_parse_status",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
        server_default=text("'not_requested'"),
    )
    vendor_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )
    invoice_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    invoice_date: Mapped[date | None] = mapped_column(nullable=True)
    due_date: Mapped[date | None] = mapped_column(nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    tax: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    total: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    line_items: Mapped[list[dict[str, object]] | None] = mapped_column(
        JSONB(),
        nullable=True,
    )
    parse_confidence: Mapped[Decimal | None] = mapped_column(
        Numeric(4, 3), nullable=True
    )
    parser_raw: Mapped[dict[str, object] | None] = mapped_column(JSONB(), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(Text(), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    paid_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    voided_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    attachments: Mapped[list[ExpenseAttachment]] = relationship(
        "ExpenseAttachment",
        back_populates="expense",
        cascade="all, delete-orphan",
    )
    # Self-referential pair over amends_expense_id; back_populates links them so
    # SQLAlchemy does not emit an overlapping-relationship SAWarning at mapper
    # configuration (which fired on every Lambda cold start).
    amended_from: Mapped[Expense | None] = relationship(
        "Expense",
        remote_side=[id],
        foreign_keys=[amends_expense_id],
        back_populates="amendments",
        uselist=False,
    )
    amendments: Mapped[list[Expense]] = relationship(
        "Expense",
        foreign_keys=[amends_expense_id],
        back_populates="amended_from",
    )
    vendor: Mapped[Organization | None] = relationship("Organization")


class ExpenseAttachment(Base):
    """Attachment rows linking expenses to uploaded assets."""

    __tablename__ = "expense_attachments"
    __table_args__ = (
        Index("expense_attachments_expense_idx", "expense_id"),
        Index("expense_attachments_asset_idx", "asset_id"),
        Index(
            "expense_attachments_unique_idx",
            "expense_id",
            "asset_id",
            unique=True,
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    expense_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("expenses.id", ondelete="CASCADE"),
        nullable=False,
    )
    asset_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="RESTRICT"),
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(
        Integer(),
        nullable=False,
        server_default=text("0"),
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    expense: Mapped[Expense] = relationship("Expense", back_populates="attachments")
    asset: Mapped[Asset] = relationship("Asset")
