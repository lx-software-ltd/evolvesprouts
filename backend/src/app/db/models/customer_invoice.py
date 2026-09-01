"""Customer AR invoice and line items."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TIMESTAMP, Numeric

from app.db.base import Base
from app.db.models.enums import BillingBillToKind, BillingInvoiceStatus


def _kind_values(_enum_cls: type[BillingBillToKind] | None = None) -> list[str]:
    return [e.value for e in BillingBillToKind]


def _inv_status_values(
    _enum_cls: type[BillingInvoiceStatus] | None = None,
) -> list[str]:
    return [e.value for e in BillingInvoiceStatus]


class CustomerInvoice(Base):
    """AR invoice (draft, issued, or void)."""

    __tablename__ = "customer_invoices"
    __table_args__ = (
        Index(
            "customer_invoices_asset_id_uidx",
            "asset_id",
            unique=True,
            postgresql_where=text("asset_id IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    status: Mapped[BillingInvoiceStatus] = mapped_column(
        sa.Enum(
            BillingInvoiceStatus,
            name="billing_invoice_status",
            values_callable=_inv_status_values,
            create_type=False,
        ),
        nullable=False,
        server_default=text("'draft'"),
    )
    invoice_number: Mapped[str | None] = mapped_column(Text(), nullable=True)
    invoice_sequence: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    amount_allocated: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, server_default=text("0")
    )
    balance_due: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, server_default=text("0")
    )
    bill_to_kind: Mapped[BillingBillToKind] = mapped_column(
        sa.Enum(
            BillingBillToKind,
            name="billing_bill_to_kind",
            values_callable=_kind_values,
            create_type=False,
        ),
        nullable=False,
        server_default=text("'contact'"),
    )
    bill_to_contact_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    bill_to_family_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("families.id", ondelete="SET NULL"),
        nullable=True,
    )
    bill_to_organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )
    bill_to_display_name: Mapped[str | None] = mapped_column(Text(), nullable=True)
    bill_to_email: Mapped[str | None] = mapped_column(Text(), nullable=True)
    bill_to_location_text: Mapped[str | None] = mapped_column(
        Text(),
        nullable=True,
        comment="Snapshot: venue name + address lines for bill-to party PDF block",
    )
    bill_to_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(astext_type=sa.Text()),
        nullable=True,
    )
    issued_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    invoice_date: Mapped[date | None] = mapped_column(sa.Date(), nullable=True)
    due_date: Mapped[date | None] = mapped_column(sa.Date(), nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    void_reason: Mapped[str | None] = mapped_column(Text(), nullable=True)
    issued_pdf_s3_key: Mapped[str | None] = mapped_column(Text(), nullable=True)
    issued_pdf_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    asset_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="RESTRICT"),
        nullable=True,
    )
    pdf_template_version: Mapped[str | None] = mapped_column(Text(), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    email_sent_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    ses_message_id: Mapped[str | None] = mapped_column(Text(), nullable=True)
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

    lines: Mapped[list[CustomerInvoiceLine]] = relationship(
        "CustomerInvoiceLine",
        back_populates="invoice",
        cascade="all, delete-orphan",
    )


class CustomerInvoiceLine(Base):
    """Invoice line; ``enrollment_id`` is set for enrollment-based lines only."""

    __tablename__ = "customer_invoice_lines"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    invoice_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("customer_invoices.id", ondelete="CASCADE"),
        nullable=False,
    )
    enrollment_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("enrollments.id", ondelete="RESTRICT"),
        nullable=True,
    )
    line_order: Mapped[int] = mapped_column(sa.SmallInteger, nullable=False)
    description: Mapped[str] = mapped_column(Text(), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_amount: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    discount_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(14, 4), nullable=True
    )
    tax_rate: Mapped[Decimal | None] = mapped_column(Numeric(10, 6), nullable=True)
    tax_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
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

    invoice: Mapped[CustomerInvoice] = relationship(
        "CustomerInvoice",
        back_populates="lines",
    )
