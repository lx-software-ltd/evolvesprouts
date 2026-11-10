"""Payment and invoice created with an enrollment.

The public reservation handler and the admin enrollment handler both call
this module. Invoice issuing stays behind ``ENROLLMENT_AUTO_INVOICE``.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
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
from app.exceptions import ConflictError, ValidationError
from app.services.customer_billing import (
    finalize_receipt_pdf_upload,
    send_invoice_email,
)
from app.services.enrollment_invoice_build import (
    BillingFollowup,
    allocate_succeeded_payment,
    enrollment_auto_invoice_enabled,
    invoice_for_payment,
    money_amount,
)
from app.services.enrollment_invoice_links import (
    billing_summaries_for_enrollments,
    open_invoice_enrollment_ids,
)
from app.utils.logging import get_logger

__all__ = ["BillingFollowup"]

logger = get_logger(__name__)


def _record_admin_payment(
    session: Session,
    enrollment: Enrollment,
    *,
    method: str,
    received: bool,
    actor: str,
) -> CustomerPayment:
    amount = money_amount(enrollment.amount_paid)
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
        billing.get("bill_later") is True
        or enrollment.status == EnrollmentStatus.CANCELLED
    ):
        return BillingFollowup()
    payment = _record_admin_payment(
        session,
        enrollment,
        method=str(billing.get("payment_method") or "fps"),
        received=billing.get("payment_received") is True,
        actor=actor,
    )
    followup = invoice_for_payment(
        session,
        enrollment,
        payment,
        actor=actor,
        request_id=request_id,
        send_email=billing.get("send_invoice_email") is True,
        display_name=None,
        require_catalogue_match=False,
        receipt_when_uninvoiced=True,
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
            payment_status=followup.payment_status,
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
        return invoice_for_payment(
            session,
            enrollment,
            existing,
            actor=actor,
            request_id=request_id,
            send_email=False,
            display_name=None,
            require_catalogue_match=False,
            receipt_when_uninvoiced=True,
        )
    return BillingFollowup()


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
    followup = invoice_for_payment(
        session,
        enrollment,
        payment,
        actor=actor,
        request_id=None,
        send_email=True,
        display_name=(attendee_name or "").strip() or None,
        require_catalogue_match=True,
        receipt_when_uninvoiced=False,
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
            payment_status=followup.payment_status,
            receipt_id=followup.receipt_id,
            warning="Invoice issued with no attendee email, so it was not sent.",
            duplicate=duplicate,
        )
    return BillingFollowup(
        payment_id=followup.payment_id,
        invoice_id=followup.invoice_id,
        invoice_number=followup.invoice_number,
        invoice_status=followup.invoice_status,
        payment_status=followup.payment_status,
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
    """Allocate a newly succeeded payment to that enrollment's open issued invoices.

    Stays off with ``ENROLLMENT_AUTO_INVOICE`` so confirming a payment keeps
    the previous manual-allocation behaviour.
    """
    if not enrollment_auto_invoice_enabled():
        return
    if payment.enrollment_id is None or money_amount(payment.amount) <= 0:
        return
    if payment.status != BillingPaymentStatus.SUCCEEDED:
        return
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


def enrollment_charge_is_changing(
    enrollment: Enrollment, payload: Mapping[str, object]
) -> bool:
    """True when the update would change the amount or currency already stored."""
    if "amount_paid" in payload and money_amount(
        payload["amount_paid"]
    ) != money_amount(enrollment.amount_paid):
        return True
    if "currency" not in payload:
        return False
    incoming = str(payload["currency"] or "").strip().upper()
    current = str(enrollment.currency or "").strip().upper()
    return incoming != current


def billing_for_enrollment_response(
    session: Session,
    enrollment_id: UUID | None,
    followup: BillingFollowup | None,
    warning: str | None,
    *,
    include_summary: bool,
) -> dict[str, str | None] | None:
    """Invoice and payment fields for an enrollment response."""
    text = (
        warning
        if warning is not None
        else (followup.warning if followup is not None else None)
    )
    summary: dict[str, str | None] | None = None
    if include_summary and isinstance(enrollment_id, UUID):
        summary = billing_summaries_for_enrollments(session, [enrollment_id]).get(
            enrollment_id
        )
    if summary is None:
        if followup is None and text is None:
            return None
        summary = {
            "invoice_number": None,
            "invoice_status": None,
            "payment_status": None,
            "billing_warning": None,
        }
    if text:
        summary["billing_warning"] = text
    if (
        followup is not None
        and followup.payment_status
        and summary.get("payment_status") is None
    ):
        summary["payment_status"] = followup.payment_status
    return summary
