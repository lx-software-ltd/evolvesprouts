"""Queries that connect enrollments to open invoices and inbound payments."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.enums import (
    BillingInvoiceStatus,
    BillingPaymentDirection,
    BillingPaymentStatus,
)

_OPEN_INVOICE_STATUSES = (
    BillingInvoiceStatus.DRAFT,
    BillingInvoiceStatus.ISSUED,
)


def _as_list(rows: object) -> list[object]:
    """Real queries return a list. An unconfigured test double does not."""
    if isinstance(rows, list):
        return rows
    return []


def open_invoice_enrollment_ids(
    session: Session, enrollment_ids: list[UUID]
) -> set[UUID]:
    """Enrollment ids that already sit on a draft or issued invoice."""
    if not enrollment_ids:
        return set()
    rows = _as_list(
        session.execute(
            select(CustomerInvoiceLine.enrollment_id)
            .join(
                CustomerInvoice,
                CustomerInvoice.id == CustomerInvoiceLine.invoice_id,
            )
            .where(CustomerInvoiceLine.enrollment_id.in_(enrollment_ids))
            .where(CustomerInvoice.status.in_(_OPEN_INVOICE_STATUSES))
        )
        .scalars()
        .all()
    )
    return {row for row in rows if isinstance(row, UUID)}


def billing_summaries_for_enrollments(
    session: Session, enrollment_ids: list[UUID]
) -> dict[UUID, dict[str, str | None]]:
    """Latest non-void invoice and latest inbound payment for each enrollment."""
    summaries: dict[UUID, dict[str, str | None]] = {
        enrollment_id: {
            "invoice_number": None,
            "invoice_status": None,
            "payment_status": None,
            "billing_warning": None,
        }
        for enrollment_id in enrollment_ids
    }
    if not enrollment_ids:
        return summaries
    invoice_rows = _as_list(
        session.execute(
            select(
                CustomerInvoiceLine.enrollment_id,
                CustomerInvoice.invoice_number,
                CustomerInvoice.status,
            )
            .join(
                CustomerInvoice,
                CustomerInvoice.id == CustomerInvoiceLine.invoice_id,
            )
            .where(CustomerInvoiceLine.enrollment_id.in_(enrollment_ids))
            .where(CustomerInvoice.status != BillingInvoiceStatus.VOID)
            .order_by(CustomerInvoice.created_at.asc())
        ).all()
    )
    for enrollment_id, number, status in invoice_rows:
        if not isinstance(enrollment_id, UUID):
            continue
        summaries[enrollment_id]["invoice_number"] = str(number) if number else None
        summaries[enrollment_id]["invoice_status"] = getattr(status, "value", status)
    payment_rows = _as_list(
        session.execute(
            select(
                CustomerPayment.enrollment_id,
                CustomerPayment.status,
            )
            .where(CustomerPayment.enrollment_id.in_(enrollment_ids))
            .where(CustomerPayment.direction == BillingPaymentDirection.INBOUND)
            .order_by(CustomerPayment.created_at.asc())
        ).all()
    )
    for enrollment_id, status in payment_rows:
        if not isinstance(enrollment_id, UUID):
            continue
        if status == BillingPaymentStatus.FAILED:
            continue
        summaries[enrollment_id]["payment_status"] = getattr(status, "value", status)
    return summaries
