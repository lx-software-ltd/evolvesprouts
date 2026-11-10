"""Void or flag invoices when an enrollment is cancelled."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.audit import AuditService
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.enrollment import Enrollment
from app.db.models.enums import (
    BillingInvoiceStatus,
    BillingPaymentDirection,
    BillingPaymentStatus,
)
from app.db.models.payment_allocation import PaymentAllocation
from app.services.customer_billing import recompute_invoice_settlement
from app.services.enrollment_invoice_build import money_amount


def _append_note(enrollment: Enrollment, line: str) -> None:
    notes = (enrollment.notes or "").strip()
    if line in notes:
        return
    enrollment.notes = f"{notes}\n{line}".strip() if notes else line


def _count(value: object) -> int:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return 0


def _indexed(row: object, index: int) -> object:
    """Read a query row by position. SQLAlchemy ``Row`` is not a ``tuple``."""
    getter = getattr(row, "__getitem__", None)
    if not callable(getter):
        raise TypeError
    return getter(index)


def _has_positive_succeeded_payment(session: Session, enrollment_id: UUID) -> bool:
    found = session.scalar(
        select(func.count())
        .select_from(CustomerPayment)
        .where(CustomerPayment.enrollment_id == enrollment_id)
        .where(CustomerPayment.direction == BillingPaymentDirection.INBOUND)
        .where(CustomerPayment.status == BillingPaymentStatus.SUCCEEDED)
        .where(CustomerPayment.amount > 0)
    )
    return _count(found) > 0


def release_billing_for_cancelled_enrollment(
    session: Session,
    enrollment: Enrollment,
    *,
    actor: str,
    request_id: str | None = None,
) -> str | None:
    """Void an unpaid invoice. A paid or card-settled invoice stays for refund."""
    rows = session.execute(
        select(CustomerInvoiceLine, CustomerInvoice)
        .join(
            CustomerInvoice,
            CustomerInvoice.id == CustomerInvoiceLine.invoice_id,
        )
        .where(CustomerInvoiceLine.enrollment_id == enrollment.id)
        .where(
            CustomerInvoice.status.in_(
                (BillingInvoiceStatus.DRAFT, BillingInvoiceStatus.ISSUED)
            )
        )
    ).all()
    warning: str | None = None
    for row in rows:
        try:
            line = _indexed(row, 0)
            invoice = _indexed(row, 1)
        except TypeError:
            continue
        if not isinstance(invoice, CustomerInvoice):
            continue
        if not isinstance(line, CustomerInvoiceLine):
            continue
        if invoice.status == BillingInvoiceStatus.DRAFT:
            _remove_draft_line(
                session, invoice, line, actor=actor, request_id=request_id
            )
            continue
        other = _count(
            session.scalar(
                select(func.count())
                .select_from(CustomerInvoiceLine)
                .where(CustomerInvoiceLine.invoice_id == invoice.id)
                .where(CustomerInvoiceLine.enrollment_id != enrollment.id)
            )
        )
        number = invoice.invoice_number or str(invoice.id)
        needs_refund = (
            other > 0
            or money_amount(invoice.amount_allocated) > 0
            or _has_positive_succeeded_payment(session, enrollment.id)
        )
        if needs_refund:
            warning = (
                f"Refund required: invoice {number} was paid or shared "
                "before this enrollment was cancelled."
            )
            _append_note(enrollment, warning)
            continue
        invoice.status = BillingInvoiceStatus.VOID
        invoice.voided_at = datetime.now(UTC)
        invoice.void_reason = "Enrollment cancelled"
        recompute_invoice_settlement(session, invoice)
        AuditService(session, user_id=actor, request_id=request_id).log_custom(
            table_name="customer_invoices",
            record_id=invoice.id,
            action="VOID_FROM_ISSUED",
            new_values={"reason": invoice.void_reason, "source": "enrollment_cancel"},
        )
    if warning is None and _has_positive_succeeded_payment(session, enrollment.id):
        warning = (
            "Refund required: a payment was received "
            "before this enrollment was cancelled."
        )
        _append_note(enrollment, warning)
    _delete_pending_enrollment_payments(
        session, enrollment.id, actor=actor, request_id=request_id
    )
    return warning


def _remove_draft_line(
    session: Session,
    invoice: CustomerInvoice,
    line: CustomerInvoiceLine,
    *,
    actor: str,
    request_id: str | None,
) -> None:
    session.delete(line)
    session.flush()
    remaining = session.scalars(
        select(CustomerInvoiceLine).where(CustomerInvoiceLine.invoice_id == invoice.id)
    ).all()
    if not remaining:
        AuditService(session, user_id=actor, request_id=request_id).log_custom(
            table_name="customer_invoices",
            record_id=invoice.id,
            action="DELETE_DRAFT",
            old_values={"reason": "enrollment_cancelled"},
        )
        session.delete(invoice)
        return
    subtotal = sum((money_amount(item.line_total) for item in remaining), Decimal(0))
    tax = sum((money_amount(item.tax_amount) for item in remaining), Decimal(0))
    invoice.subtotal = subtotal
    invoice.tax_total = tax
    invoice.total = subtotal + tax
    balance = invoice.total - money_amount(invoice.amount_allocated)
    invoice.balance_due = balance if balance > 0 else Decimal(0)


def _delete_pending_enrollment_payments(
    session: Session,
    enrollment_id: UUID,
    *,
    actor: str,
    request_id: str | None,
) -> None:
    payments = session.scalars(
        select(CustomerPayment)
        .where(CustomerPayment.enrollment_id == enrollment_id)
        .where(CustomerPayment.direction == BillingPaymentDirection.INBOUND)
        .where(CustomerPayment.status == BillingPaymentStatus.PENDING)
    ).all()
    for payment in payments:
        allocated = _count(
            session.scalar(
                select(func.count())
                .select_from(PaymentAllocation)
                .where(PaymentAllocation.payment_id == payment.id)
            )
        )
        if allocated > 0:
            continue
        AuditService(session, user_id=actor, request_id=request_id).log_custom(
            table_name="customer_payments",
            record_id=payment.id,
            action="ORPHAN_INBOUND_PAYMENT_DELETED",
            old_values=payment.to_audit_dict(),
        )
        session.delete(payment)
