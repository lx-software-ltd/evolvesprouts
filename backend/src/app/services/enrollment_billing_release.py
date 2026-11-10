"""Void or flag invoices when an enrollment is cancelled."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.audit import AuditService
from app.db.models.audit_log import AuditLog
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.enrollment import Enrollment
from app.db.models.enums import (
    BillingInvoiceStatus,
    BillingPaymentDirection,
    BillingPaymentStatus,
)
from app.db.models.payment_allocation import PaymentAllocation
from app.exceptions import ValidationError
from app.services.customer_billing import recompute_invoice_settlement
from app.services.enrollment_invoice_build import (
    allocate_succeeded_payment,
    money_amount,
    stored_currency,
)
from app.services.enrollment_invoice_links import open_invoice_enrollment_ids


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


def other_charge_count_select(invoice_id: UUID, enrollment_id: UUID):
    """Lines on this invoice that are not this enrollment.

    A line with no enrollment is a manual charge. ``!=`` skips those rows
    because SQL treats NULL as unknown, so the predicate includes them.
    """
    return (
        select(func.count())
        .select_from(CustomerInvoiceLine)
        .where(CustomerInvoiceLine.invoice_id == invoice_id)
        .where(
            or_(
                CustomerInvoiceLine.enrollment_id.is_(None),
                CustomerInvoiceLine.enrollment_id != enrollment_id,
            )
        )
    )


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
            session.scalar(other_charge_count_select(invoice.id, enrollment.id))
        )
        number = invoice.invoice_number or str(invoice.id)
        paid = money_amount(invoice.amount_allocated) > 0 or (
            _has_positive_succeeded_payment(session, enrollment.id)
        )
        if other > 0 and not paid:
            warning = (
                f"Invoice {number} also bills other charges. "
                "Remove this enrollment's line in Finance."
            )
            _append_note(enrollment, warning)
            continue
        if paid:
            shared = " and also bills other charges" if other > 0 else ""
            warning = (
                f"Refund required: invoice {number} was paid{shared} "
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


def _payment_matches_enrollment(
    payment: CustomerPayment, enrollment: Enrollment
) -> bool:
    return money_amount(payment.amount) == money_amount(
        enrollment.amount_paid
    ) and stored_currency(payment.currency) == stored_currency(enrollment.currency)


def _allocation_count(session: Session, payment_id: UUID) -> int:
    return _count(
        session.scalar(
            select(func.count())
            .select_from(PaymentAllocation)
            .where(PaymentAllocation.payment_id == payment_id)
        )
    )


def align_uninvoiced_enrollment_payment(
    session: Session, enrollment: Enrollment
) -> None:
    """Keep the single pending payment in step with the enrollment charge.

    A received payment is left unchanged. The edit is rejected so a receipt
    and a later invoice cannot disagree.
    """
    payments = session.scalars(
        select(CustomerPayment)
        .where(CustomerPayment.enrollment_id == enrollment.id)
        .where(CustomerPayment.direction == BillingPaymentDirection.INBOUND)
        .where(
            CustomerPayment.status.in_(
                (BillingPaymentStatus.PENDING, BillingPaymentStatus.SUCCEEDED)
            )
        )
    ).all()
    rows = [row for row in payments if isinstance(row, CustomerPayment)]
    if not rows:
        return
    succeeded = [
        row
        for row in rows
        if row.status == BillingPaymentStatus.SUCCEEDED and money_amount(row.amount) > 0
    ]
    pending = [row for row in rows if row.status == BillingPaymentStatus.PENDING]
    for payment in succeeded:
        if not _payment_matches_enrollment(payment, enrollment):
            raise ValidationError(
                "This enrollment has a received payment for a different amount. "
                "Update that payment in Finance before changing the charge.",
                field="amount_paid",
            )
    if succeeded or len(pending) != 1:
        if len(pending) > 1:
            raise ValidationError(
                "This enrollment has more than one pending payment. "
                "Update them in Finance before changing the charge.",
                field="amount_paid",
            )
        return
    payment = pending[0]
    if _allocation_count(session, payment.id) > 0:
        raise ValidationError(
            "This enrollment's payment is already allocated. Change it from Finance.",
            field="amount_paid",
        )
    payment.amount = money_amount(enrollment.amount_paid)
    payment.currency = stored_currency(enrollment.currency)


def billing_gap_after_restore(session: Session, enrollment: Enrollment) -> str | None:
    """Warn when undoing a cancellation left nothing to collect."""
    if enrollment.id in open_invoice_enrollment_ids(session, [enrollment.id]):
        return None
    if _has_positive_succeeded_payment(session, enrollment.id):
        return None
    pending = _count(
        session.scalar(
            select(func.count())
            .select_from(CustomerPayment)
            .where(CustomerPayment.enrollment_id == enrollment.id)
            .where(CustomerPayment.direction == BillingPaymentDirection.INBOUND)
            .where(CustomerPayment.status == BillingPaymentStatus.PENDING)
        )
    )
    if pending > 0:
        return None
    return "This enrollment has no payment or invoice. Record a payment in Finance."


def invoice_email_requested(session: Session, payment_id: UUID) -> bool:
    """True when the enrollment that created this payment asked for an email."""
    values = (
        session.execute(
            select(AuditLog.new_values)
            .where(AuditLog.table_name == "customer_payments")
            .where(AuditLog.record_id == str(payment_id))
            .where(AuditLog.action == "MANUAL_INBOUND_PAYMENT_CREATED")
            .order_by(AuditLog.timestamp.desc())
        )
        .scalars()
        .all()
    )
    if not isinstance(values, list | tuple):
        return False
    for item in values:
        if isinstance(item, dict) and item.get("source") == "enrollment_create":
            return item.get("send_invoice_email") is True
    return False


def allocate_confirmed_payment(session: Session, payment: CustomerPayment) -> None:
    """Allocate a succeeded payment, then drop a pending stub the balance no longer needs."""
    invoices = (
        session.execute(
            select(CustomerInvoice)
            .join(
                CustomerInvoiceLine,
                CustomerInvoiceLine.invoice_id == CustomerInvoice.id,
            )
            .where(CustomerInvoiceLine.enrollment_id == payment.enrollment_id)
            .where(CustomerInvoice.status == BillingInvoiceStatus.ISSUED)
            .order_by(CustomerInvoice.issued_at.asc())
        )
        .scalars()
        .all()
    )
    issued = [row for row in invoices if isinstance(row, CustomerInvoice)]
    for invoice in issued:
        allocate_succeeded_payment(session, payment, invoice)
    _trim_pending_stubs(session, payment, issued)


def _trim_pending_stubs(
    session: Session,
    payment: CustomerPayment,
    invoices: list[CustomerInvoice],
) -> None:
    if payment.enrollment_id is None or not invoices:
        return
    outstanding = sum(
        (money_amount(invoice.balance_due) for invoice in invoices), Decimal(0)
    )
    currencies = {stored_currency(invoice.currency) for invoice in invoices}
    pending = session.scalars(
        select(CustomerPayment)
        .where(CustomerPayment.enrollment_id == payment.enrollment_id)
        .where(CustomerPayment.direction == BillingPaymentDirection.INBOUND)
        .where(CustomerPayment.status == BillingPaymentStatus.PENDING)
    ).all()
    stubs = [
        row
        for row in pending
        if isinstance(row, CustomerPayment)
        and stored_currency(row.currency) in currencies
        and _allocation_count(session, row.id) == 0
    ]
    actor = payment.confirmed_by or "billing"
    if outstanding <= 0:
        for stub in stubs:
            AuditService(session, user_id=actor, request_id=None).log_custom(
                table_name="customer_payments",
                record_id=stub.id,
                action="ORPHAN_INBOUND_PAYMENT_DELETED",
                old_values=stub.to_audit_dict(),
            )
            session.delete(stub)
        return
    if len(stubs) == 1 and money_amount(stubs[0].amount) > outstanding:
        stubs[0].amount = outstanding
