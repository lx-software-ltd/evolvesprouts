"""Draft, issue, allocate, and receipt steps for one enrollment invoice."""

from __future__ import annotations

import os
from contextlib import nullcontext
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin_billing_common import effective_enrollment_bill_to_fks
from app.api.admin_billing_invoice_draft_helpers import (
    _build_enrollment_merge_line_description,
    _resolve_bill_to_party_for_draft,
)
from app.api.admin_billing_invoices import issue_draft_invoice
from app.config import get_default_currency_code
from app.db.audit import AuditService
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.customer_receipt import CustomerReceipt
from app.db.models.discount_code import DiscountCode
from app.db.models.enrollment import Enrollment
from app.db.models.enums import (
    BillingInvoiceStatus,
    BillingPaymentStatus,
    ConsultationPricingModel,
    DiscountType,
    EnrollmentStatus,
    ServiceType,
)
from app.db.models.payment_allocation import PaymentAllocation
from app.db.models.service import Service
from app.db.models.service_instance import ServiceInstance
from app.exceptions import ConflictError, ValidationError
from app.services.billing_enrollment_confirmation import (
    maybe_confirm_enrollments_on_positive_invoice_payment_allocation,
)
from app.services.customer_billing import (
    create_receipt_for_succeeded_inbound_payment,
    payment_unapplied_amount,
    recompute_invoice_settlement,
)
from app.services.customer_invoice_pdf import today_in_invoice_display_tz_or_utc
from app.services.enrollment_invoice_links import open_invoice_enrollment_ids
from app.utils.logging import get_logger

logger = get_logger(__name__)

_AUTO_INVOICE_ENV = "ENROLLMENT_AUTO_INVOICE"
_UNBILLED = "Invoice was not created. Create it from Finance."


@dataclass(frozen=True)
class BillingFollowup:
    """Work that must run after the enrollment transaction commits."""

    payment_id: UUID | None = None
    invoice_id: UUID | None = None
    invoice_number: str | None = None
    invoice_status: str | None = None
    receipt_id: UUID | None = None
    email_to: str | None = None
    warning: str | None = None
    duplicate: bool = False


def enrollment_auto_invoice_enabled() -> bool:
    """True only when the Lambda env explicitly turns auto-invoicing on."""
    return os.getenv(_AUTO_INVOICE_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _money(value: object) -> Decimal:
    if value is None or value == "":
        return Decimal("0.00")
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _savepoint(session: Session):
    begin = getattr(session, "begin_nested", None)
    if not callable(begin):
        return nullcontext()
    return begin()


def _as_list(rows: object) -> list[object]:
    if isinstance(rows, list):
        return rows
    return []


def receipt_for_positive_succeeded_payment(
    session: Session, payment: CustomerPayment
) -> UUID | None:
    """Receipt for a succeeded charge above zero. Zero and pending stay without one."""
    if payment.status != BillingPaymentStatus.SUCCEEDED:
        return None
    if _money(payment.amount) <= 0:
        return None
    existing = session.execute(
        select(CustomerReceipt.id).where(
            CustomerReceipt.customer_payment_id == payment.id
        )
    ).scalar_one_or_none()
    if isinstance(existing, UUID):
        return existing
    receipt = create_receipt_for_succeeded_inbound_payment(session, payment=payment)
    return receipt.id


def allocate_succeeded_payment(
    session: Session, payment: CustomerPayment, invoice: CustomerInvoice
) -> None:
    """Apply a succeeded payment up to the invoice balance. Pending payments are skipped."""
    if payment.status != BillingPaymentStatus.SUCCEEDED:
        return
    if payment.currency != invoice.currency:
        return
    unapplied = payment_unapplied_amount(session, payment.id)
    balance = _money(invoice.total) - _money(invoice.amount_allocated)
    amount = min(unapplied, balance)
    if amount <= 0:
        return
    session.add(
        PaymentAllocation(
            payment_id=payment.id,
            invoice_id=invoice.id,
            allocated_amount=amount,
            currency=payment.currency,
        )
    )
    session.flush()
    recompute_invoice_settlement(session, invoice)
    maybe_confirm_enrollments_on_positive_invoice_payment_allocation(session, invoice)


def _discounted(base: Decimal, code: DiscountCode | None) -> Decimal:
    if code is None or code.discount_type == DiscountType.REFERRAL:
        return base.quantize(Decimal("0.01"))
    if code.discount_type == DiscountType.PERCENTAGE:
        raw = base * (Decimal(1) - (Decimal(str(code.discount_value)) / Decimal(100)))
        if raw < 0:
            raw = Decimal(0)
        return raw.quantize(Decimal(1), rounding=ROUND_HALF_UP)
    raw = base - Decimal(str(code.discount_value))
    if raw < 0:
        raw = Decimal(0)
    return raw.quantize(Decimal("0.01"))


def catalogue_charge(
    session: Session, enrollment: Enrollment
) -> tuple[Decimal, str] | None:
    """List price after the enrollment discount, or None when the catalogue has no price."""
    instance = getattr(enrollment, "instance", None)
    if instance is None:
        instance = session.get(ServiceInstance, enrollment.instance_id)
    if instance is None:
        return None
    service = getattr(instance, "service", None)
    if service is None:
        service = session.get(Service, instance.service_id)
    if service is None:
        return None
    base, currency = _catalogue_base(instance, service, enrollment)
    if base is None or not currency:
        return None
    code = getattr(enrollment, "discount_code", None)
    if code is None and enrollment.discount_code_id is not None:
        code = session.get(DiscountCode, enrollment.discount_code_id)
    return _discounted(base, code), str(currency).upper()[:3]


def _catalogue_base(
    instance: ServiceInstance, service: Service, enrollment: Enrollment
) -> tuple[Decimal | None, str | None]:
    if service.service_type == ServiceType.INTRO_CALL:
        return Decimal(0), "HKD"
    if service.service_type == ServiceType.EVENT:
        tiers = list(getattr(instance, "ticket_tiers", None) or [])
        chosen = None
        if enrollment.ticket_tier_id is not None:
            chosen = next(
                (tier for tier in tiers if tier.id == enrollment.ticket_tier_id),
                None,
            )
        if chosen is None and tiers:
            chosen = min(
                tiers, key=lambda tier: (tier.sort_order, tier.created_at, tier.id)
            )
        if chosen is not None:
            return chosen.price, chosen.currency
        details = getattr(service, "event_details", None)
        if details is not None and details.default_price is not None:
            return details.default_price, details.default_currency
        return None, None
    if service.service_type == ServiceType.TRAINING_COURSE:
        details = getattr(instance, "training_details", None)
        if details is not None:
            return details.price, details.currency
        course = getattr(service, "training_course_details", None)
        if course is not None and course.default_price is not None:
            return course.default_price, course.default_currency
        return None, None
    if service.service_type == ServiceType.CONSULTATION:
        details = getattr(service, "consultation_details", None)
        if details is None:
            return None, None
        if details.pricing_model == ConsultationPricingModel.FREE:
            return Decimal(0), details.default_currency
        if (
            details.pricing_model == ConsultationPricingModel.PACKAGE
            and details.default_package_price is not None
        ):
            return details.default_package_price, details.default_currency
        if (
            details.pricing_model == ConsultationPricingModel.HOURLY
            and details.default_hourly_rate is not None
        ):
            return details.default_hourly_rate, details.default_currency
    return None, None


def _draft_invoice(
    session: Session,
    enrollment: Enrollment,
    *,
    actor: str,
    request_id: str | None,
) -> CustomerInvoice:
    if enrollment.status == EnrollmentStatus.CANCELLED:
        raise ValidationError(
            "Cancelled enrollments cannot be invoiced", field="enrollmentId"
        )
    if enrollment.id in open_invoice_enrollment_ids(session, [enrollment.id]):
        raise ConflictError(
            "enrollment_already_invoiced", enrollmentId=str(enrollment.id)
        )
    amount = _money(enrollment.amount_paid)
    currency = (enrollment.currency or get_default_currency_code()).upper()[:3]
    kind, contact_id, family_id, organization_id = effective_enrollment_bill_to_fks(
        enrollment
    )
    invoice = CustomerInvoice(
        status=BillingInvoiceStatus.DRAFT,
        currency=currency,
        subtotal=amount,
        tax_total=Decimal(0),
        total=amount,
        bill_to_kind=kind,
        bill_to_contact_id=contact_id,
        bill_to_family_id=family_id,
        bill_to_organization_id=organization_id,
        invoice_date=today_in_invoice_display_tz_or_utc(),
    )
    _resolve_bill_to_party_for_draft(session, inv=invoice, first=enrollment)
    session.add(invoice)
    session.flush()
    session.add(
        CustomerInvoiceLine(
            invoice_id=invoice.id,
            enrollment_id=enrollment.id,
            line_order=0,
            description=_build_enrollment_merge_line_description(enrollment),
            quantity=Decimal(1),
            unit_amount=amount,
            line_total=amount,
            currency=currency,
        )
    )
    session.flush()
    AuditService(session, user_id=actor or None, request_id=request_id).log_custom(
        table_name="customer_invoices",
        record_id=invoice.id,
        action="DRAFT_CREATED",
        new_values={"enrollment_ids": [str(enrollment.id)], "source": "enrollment"},
    )
    return invoice


def _followup_from(
    payment: CustomerPayment | None,
    invoice: CustomerInvoice | None,
    *,
    receipt_id: UUID | None = None,
    email_to: str | None = None,
    warning: str | None = None,
    duplicate: bool = False,
) -> BillingFollowup:
    return BillingFollowup(
        payment_id=payment.id if payment is not None else None,
        invoice_id=invoice.id if invoice is not None else None,
        invoice_number=invoice.invoice_number if invoice is not None else None,
        invoice_status=invoice.status.value if invoice is not None else None,
        receipt_id=receipt_id,
        email_to=email_to,
        warning=warning,
        duplicate=duplicate,
    )


def _invoice_for_payment(
    session: Session,
    enrollment: Enrollment,
    payment: CustomerPayment,
    *,
    actor: str,
    request_id: str | None,
    send_email: bool,
    display_name: str | None,
    require_catalogue_match: bool,
) -> BillingFollowup:
    """Draft, and issue when the flag is on and the charge is safe to issue."""
    if enrollment.status == EnrollmentStatus.WAITLISTED or _money(payment.amount) <= 0:
        return _followup_from(payment, None)
    if not enrollment_auto_invoice_enabled():
        return _followup_from(
            payment,
            None,
            receipt_id=receipt_for_positive_succeeded_payment(session, payment),
        )
    if enrollment.id in open_invoice_enrollment_ids(session, [enrollment.id]):
        return _followup_from(
            payment,
            None,
            receipt_id=receipt_for_positive_succeeded_payment(session, payment),
        )
    try:
        with _savepoint(session):
            invoice = _draft_invoice(
                session, enrollment, actor=actor, request_id=request_id
            )
            issue = True
            if require_catalogue_match:
                quoted = catalogue_charge(session, enrollment)
                paid = (_money(payment.amount), payment.currency)
                issue = quoted == paid
            warning = None
            if issue:
                issue_draft_invoice(
                    session,
                    invoice,
                    user_sub=actor,
                    request_id=request_id,
                    create_pending_payment=False,
                    display_name_override=display_name,
                )
                allocate_succeeded_payment(session, payment, invoice)
            else:
                warning = (
                    "Invoice left as a draft because the booking total "
                    "does not match the catalogue price."
                )
            receipt_id = receipt_for_positive_succeeded_payment(session, payment)
            email = None
            if send_email and invoice.status == BillingInvoiceStatus.ISSUED:
                email = (invoice.bill_to_email or "").strip() or None
            return _followup_from(
                payment,
                invoice,
                receipt_id=receipt_id,
                email_to=email,
                warning=warning,
            )
    except Exception:
        logger.exception(
            "enrollment_invoice_failed",
            extra={"enrollment_id": str(enrollment.id)},
        )
        receipt_id = None
        try:
            receipt_id = receipt_for_positive_succeeded_payment(session, payment)
        except Exception:
            logger.exception(
                "enrollment_receipt_failed",
                extra={"enrollment_id": str(enrollment.id)},
            )
        return _followup_from(
            payment,
            None,
            receipt_id=receipt_id,
            warning=_UNBILLED,
        )


