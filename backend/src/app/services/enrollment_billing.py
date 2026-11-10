"""Payment and invoice created with an enrollment.

The public reservation handler and the admin enrollment handler both call
this module. Invoice issuing stays behind ``ENROLLMENT_AUTO_INVOICE``.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.admin_billing_payment_create import (
    contact_id_for_enrollment_payment,
    normalize_manual_payment_method,
)
from app.config import get_default_currency_code
from app.db.audit import AuditService
from app.db.engine import get_engine
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.enrollment import Enrollment
from app.db.models.enums import (
    BillingInvoiceStatus,
    BillingPaymentDirection,
    BillingPaymentStatus,
    EnrollmentStatus,
)
from app.db.models.payment_allocation import PaymentAllocation
from app.exceptions import ConflictError, ValidationError
from app.services.customer_billing import (
    finalize_receipt_pdf_upload,
    recompute_invoice_settlement,
    send_invoice_email,
)
from app.services.enrollment_invoice_build import (
    BillingFollowup,
    _as_list,
    _followup_from,
    _invoice_for_payment,
    _money,
    allocate_succeeded_payment,
)

__all__ = ["BillingFollowup"]
from app.services.enrollment_invoice_links import open_invoice_enrollment_ids
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _record_admin_payment(
    session: Session,
    enrollment: Enrollment,
    *,
    method: str,
    received: bool,
    actor: str,
) -> CustomerPayment:
    amount = _money(enrollment.amount_paid)
    currency = (enrollment.currency or get_default_currency_code()).upper()[:3]
    enrollment.currency = currency
    if amount <= 0:
        method = "free"
        status = BillingPaymentStatus.SUCCEEDED
        amount = Decimal("0.00")
    else:
        method = normalize_manual_payment_method(method or "fps")
        if method == "free":
            raise ValidationError(
                "free method is only allowed for zero-amount payments",
                field="payment_method",
            )
        status = (
            BillingPaymentStatus.SUCCEEDED if received else BillingPaymentStatus.PENDING
        )
    payment = CustomerPayment(
        direction=BillingPaymentDirection.INBOUND,
        status=status,
        method=method,
        amount=amount,
        currency=currency,
        enrollment_id=enrollment.id,
        contact_id=contact_id_for_enrollment_payment(enrollment),
        succeeded_at=datetime.now(UTC)
        if status == BillingPaymentStatus.SUCCEEDED
        else None,
        confirmed_by=actor if status == BillingPaymentStatus.SUCCEEDED else None,
    )
    session.add(payment)
    session.flush()
    AuditService(session, user_id=actor, request_id=None).log_custom(
        table_name="customer_payments",
        record_id=payment.id,
        action="MANUAL_INBOUND_PAYMENT_CREATED",
        new_values={
            "enrollment_id": str(enrollment.id),
            "amount": str(amount),
            "currency": currency,
            "status": status.value,
            "method": method,
            "source": "enrollment_create",
        },
    )
    return payment


def apply_admin_enrollment_billing(
    session: Session,
    enrollment: Enrollment,
    billing: Mapping[str, object],
    *,
    actor: str,
    request_id: str | None,
) -> BillingFollowup:
    """Record the admin payment, then invoice unless the enrollment is bill-later or free."""
    if (
        enrollment.status == EnrollmentStatus.WAITLISTED
        or billing.get("bill_later") is True
    ):
        return BillingFollowup()
    payment = _record_admin_payment(
        session,
        enrollment,
        method=str(billing.get("payment_method") or "fps"),
        received=billing.get("payment_received") is True,
        actor=actor,
    )
    if _money(payment.amount) <= 0:
        return _followup_from(payment, None)
    followup = _invoice_for_payment(
        session,
        enrollment,
        payment,
        actor=actor,
        request_id=request_id,
        send_email=billing.get("send_invoice_email") is True,
        display_name=None,
        require_catalogue_match=False,
    )
    if (
        billing.get("send_invoice_email") is True
        and followup.invoice_status == BillingInvoiceStatus.ISSUED.value
        and not followup.email_to
        and followup.warning is None
    ):
        return BillingFollowup(
            payment_id=followup.payment_id,
            invoice_id=followup.invoice_id,
            invoice_number=followup.invoice_number,
            invoice_status=followup.invoice_status,
            receipt_id=followup.receipt_id,
            warning="Invoice issued with no bill-to email, so it was not sent.",
        )
    return followup


def bill_promoted_enrollment(
    session: Session,
    enrollment: Enrollment,
    *,
    actor: str,
    request_id: str | None,
) -> BillingFollowup:
    """Bill a waitlisted enrollment when it is seated and nothing was recorded yet."""
    if enrollment.status not in (
        EnrollmentStatus.REGISTERED,
        EnrollmentStatus.CONFIRMED,
    ):
        return BillingFollowup()
    existing = session.execute(
        select(CustomerPayment)
        .where(CustomerPayment.enrollment_id == enrollment.id)
        .where(CustomerPayment.direction == BillingPaymentDirection.INBOUND)
        .where(
            CustomerPayment.status.in_(
                (BillingPaymentStatus.PENDING, BillingPaymentStatus.SUCCEEDED)
            )
        )
        .limit(1)
    ).scalar_one_or_none()
    if isinstance(existing, CustomerPayment):
        return _invoice_for_payment(
            session,
            enrollment,
            existing,
            actor=actor,
            request_id=request_id,
            send_email=False,
            display_name=None,
            require_catalogue_match=False,
        )
    if enrollment.amount_paid is None:
        return BillingFollowup()
    return apply_admin_enrollment_billing(
        session,
        enrollment,
        {
            "bill_later": False,
            "payment_method": "fps",
            "payment_received": False,
            "send_invoice_email": False,
        },
        actor=actor,
        request_id=request_id,
    )


def attach_public_invoice(
    session: Session,
    enrollment: Enrollment,
    payment: CustomerPayment,
    *,
    actor: str,
    attendee_name: str | None,
    attendee_email: str | None,
    duplicate: bool = False,
) -> BillingFollowup:
    """Invoice a website booking. Email the attendee when the invoice is issued."""
    followup = _invoice_for_payment(
        session,
        enrollment,
        payment,
        actor=actor,
        request_id=None,
        send_email=True,
        display_name=(attendee_name or "").strip() or None,
        require_catalogue_match=True,
    )
    email = (attendee_email or "").strip() or followup.email_to
    if followup.invoice_status != BillingInvoiceStatus.ISSUED.value:
        email = None
    elif not email:
        return BillingFollowup(
            payment_id=followup.payment_id,
            invoice_id=followup.invoice_id,
            invoice_number=followup.invoice_number,
            invoice_status=followup.invoice_status,
            receipt_id=followup.receipt_id,
            warning="Invoice issued with no attendee email, so it was not sent.",
            duplicate=duplicate,
        )
    return BillingFollowup(
        payment_id=followup.payment_id,
        invoice_id=followup.invoice_id,
        invoice_number=followup.invoice_number,
        invoice_status=followup.invoice_status,
        receipt_id=followup.receipt_id,
        email_to=email,
        warning=followup.warning,
        duplicate=duplicate,
    )


def finalize_enrollment_billing(followup: BillingFollowup) -> None:
    """Upload the receipt and send the invoice email after commit."""
    if followup.receipt_id is None and followup.email_to is None:
        return
    try:
        with Session(get_engine()) as session:
            if followup.receipt_id is not None:
                finalize_receipt_pdf_upload(session, receipt_id=followup.receipt_id)
            if followup.email_to and followup.invoice_id is not None:
                send_invoice_email(
                    session,
                    invoice_id=followup.invoice_id,
                    to_addresses=[followup.email_to],
                )
            session.commit()
    except Exception:
        logger.exception(
            "enrollment_billing_finalize_failed",
            extra={
                "invoice_id": str(followup.invoice_id) if followup.invoice_id else None,
                "receipt_id": str(followup.receipt_id) if followup.receipt_id else None,
            },
        )


def settle_confirmed_payment(session: Session, payment: CustomerPayment) -> None:
    """Allocate a newly succeeded payment to that enrollment's open issued invoices."""
    if payment.enrollment_id is None or _money(payment.amount) <= 0:
        return
    if payment.status != BillingPaymentStatus.SUCCEEDED:
        return
    invoices = _as_list(
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
    for invoice in invoices:
        if isinstance(invoice, CustomerInvoice):
            allocate_succeeded_payment(session, payment, invoice)


def assert_enrollment_amount_unlocked(session: Session, enrollment: Enrollment) -> None:
    """Block amount edits once a non-void invoice exists. Void and reissue instead."""
    if enrollment.id in open_invoice_enrollment_ids(session, [enrollment.id]):
        raise ConflictError(
            "enrollment_invoiced",
            enrollmentId=str(enrollment.id),
        )


def _append_note(enrollment: Enrollment, line: str) -> None:
    notes = (enrollment.notes or "").strip()
    if line in notes:
        return
    enrollment.notes = f"{notes}\n{line}".strip() if notes else line


def release_billing_for_cancelled_enrollment(
    session: Session, enrollment: Enrollment, *, actor: str
) -> str | None:
    """Void an unpaid invoice. A paid invoice stays and is flagged for refund."""
    rows = _as_list(
        session.execute(
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
    )
    warning: str | None = None
    for row in rows:
        if not isinstance(row, tuple) or len(row) != 2:
            continue
        line, invoice = row
        if not isinstance(invoice, CustomerInvoice):
            continue
        if invoice.status == BillingInvoiceStatus.DRAFT:
            _remove_draft_line(session, invoice, line, actor=actor)
            continue
        other = session.scalar(
            select(func.count())
            .select_from(CustomerInvoiceLine)
            .where(CustomerInvoiceLine.invoice_id == invoice.id)
            .where(CustomerInvoiceLine.enrollment_id != enrollment.id)
        )
        if not isinstance(other, int):
            other = 0
        number = invoice.invoice_number or str(invoice.id)
        if other > 0 or _money(invoice.amount_allocated) > 0:
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
        AuditService(session, user_id=actor, request_id=None).log_custom(
            table_name="customer_invoices",
            record_id=invoice.id,
            action="VOID_FROM_ISSUED",
            new_values={"reason": invoice.void_reason, "source": "enrollment_cancel"},
        )
        _delete_pending_enrollment_payments(session, enrollment.id, actor=actor)
    return warning


def _remove_draft_line(
    session: Session,
    invoice: CustomerInvoice,
    line: CustomerInvoiceLine,
    *,
    actor: str,
) -> None:
    session.delete(line)
    session.flush()
    remaining = _as_list(
        session.scalars(
            select(CustomerInvoiceLine).where(
                CustomerInvoiceLine.invoice_id == invoice.id
            )
        ).all()
    )
    if not remaining:
        AuditService(session, user_id=actor, request_id=None).log_custom(
            table_name="customer_invoices",
            record_id=invoice.id,
            action="DELETE_DRAFT",
            old_values={"reason": "enrollment_cancelled"},
        )
        session.delete(invoice)
        return
    total = sum((_money(item.line_total) for item in remaining), Decimal(0))
    invoice.subtotal = total
    invoice.total = total + _money(invoice.tax_total)
    invoice.balance_due = invoice.total


def _delete_pending_enrollment_payments(
    session: Session, enrollment_id: UUID, *, actor: str
) -> None:
    payments = _as_list(
        session.scalars(
            select(CustomerPayment)
            .where(CustomerPayment.enrollment_id == enrollment_id)
            .where(CustomerPayment.direction == BillingPaymentDirection.INBOUND)
            .where(CustomerPayment.status == BillingPaymentStatus.PENDING)
        ).all()
    )
    for payment in payments:
        if not isinstance(payment, CustomerPayment):
            continue
        allocated = session.scalar(
            select(func.count())
            .select_from(PaymentAllocation)
            .where(PaymentAllocation.payment_id == payment.id)
        )
        if isinstance(allocated, int) and allocated > 0:
            continue
        AuditService(session, user_id=actor, request_id=None).log_custom(
            table_name="customer_payments",
            record_id=payment.id,
            action="ORPHAN_INBOUND_PAYMENT_DELETED",
            old_values=payment.to_audit_dict(),
        )
        session.delete(payment)
