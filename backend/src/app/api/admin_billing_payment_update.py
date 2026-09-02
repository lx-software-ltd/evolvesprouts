"""Admin billing: update manual inbound customer payment rows."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Mapping
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin_billing_common import effective_enrollment_bill_to_kind
from app.api.admin_billing_payment_create import (
    _enrollment_billing_currency,
    contact_id_for_enrollment_payment,
    normalize_manual_payment_method,
)
from app.api.admin_billing_payments_serializers import serialize_payment_for_response
from app.api.admin_request import parse_body
from app.db.audit import AuditService, session_with_audit
from app.db.engine import get_engine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.customer_receipt import CustomerReceipt
from app.db.models.enrollment import Enrollment
from app.db.models.enums import (
    BillingBillToKind,
    BillingPaymentDirection,
    BillingPaymentStatus,
    EnrollmentStatus,
)
from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.services.customer_billing import (
    create_receipt_for_succeeded_inbound_payment,
    finalize_receipt_pdf_upload,
    payment_unapplied_amount,
)
from app.utils import json_response
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _decimal_field(body: Mapping[str, Any], key: str) -> Decimal:
    try:
        return Decimal(str(body.get(key)))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValidationError(f"{key} must be a decimal number", field=key) from exc


def _apply_succeeded_manual_patch(
    session: Session,
    p: CustomerPayment,
    body: Mapping[str, Any],
    *,
    allocated_sum: Decimal,
) -> None:
    """Succeeded manual inbound: only method and external reference may change."""
    new_amt = _decimal_field(body, "amount")
    cur = str(body.get("currency") or "").upper()[:3]
    status_raw = str(body.get("status") or "").strip().lower()

    if new_amt != p.amount:
        raise ValidationError(
            "Cannot change amount on a succeeded payment", field="amount"
        )
    if len(cur) == 3 and cur != p.currency:
        raise ValidationError(
            "Cannot change currency on a succeeded payment", field="currency"
        )
    if status_raw and status_raw != p.status.value:
        raise ValidationError(
            "Cannot change status on a succeeded payment; use void or allocation flows",
            field="status",
        )
    if new_amt < allocated_sum:
        raise ValidationError(
            "Amount is below allocated total (data inconsistency)",
            field="amount",
        )

    method_raw = str(body.get("method") or "").strip() or p.method
    new_method = normalize_manual_payment_method(method_raw)
    if p.amount > 0 and new_method == "free":
        raise ValidationError(
            "free method is only allowed for zero-amount payments",
            field="method",
        )
    p.method = new_method
    ext_ref = str(body.get("externalReference") or "").strip() or None
    p.external_reference = ext_ref
    try:
        session.flush()
    except IntegrityError as exc:
        err_txt = str(exc.orig) if exc.orig is not None else str(exc)
        if "uq_cp_enrollment_external_ref" in err_txt:
            raise ConflictError(
                "duplicate_enrollment_payment_reference",
                field="externalReference",
                enrollmentId=str(p.enrollment_id) if p.enrollment_id else None,
            ) from exc
        raise


def _apply_pending_manual_patch(
    session: Session,
    p: CustomerPayment,
    en: Enrollment | None,
    body: Mapping[str, Any],
    *,
    user_sub: str,
    allocated_sum: Decimal,
) -> None:
    amount = _decimal_field(body, "amount")
    if amount < 0:
        raise ValidationError("amount must be zero or positive", field="amount")
    if amount < allocated_sum:
        raise ValidationError(
            "amount cannot be less than the total allocated to invoices",
            field="amount",
        )

    currency = str(body.get("currency") or "").upper()[:3]
    if len(currency) != 3:
        raise ValidationError("currency is required", field="currency")
    if en is not None:
        expected_currency = _enrollment_billing_currency(en)
        if currency != expected_currency:
            raise ValidationError(
                f"currency must match the enrollment billing currency ({expected_currency})",
                field="currency",
            )
    if currency != p.currency and allocated_sum > 0:
        raise ValidationError(
            "Cannot change currency while the payment has invoice allocations",
            field="currency",
        )

    method_raw = str(body.get("method") or "").strip()
    if method_raw == "":
        raise ValidationError("method is required", field="method")
    method = normalize_manual_payment_method(method_raw)

    status_raw = str(body.get("status") or "pending").strip().lower()
    if status_raw not in ("pending", "succeeded"):
        raise ValidationError("status must be pending or succeeded", field="status")

    ext_ref = str(body.get("externalReference") or "").strip() or None

    is_free_zero = amount == Decimal("0") or method == "free"
    if is_free_zero:
        method = "free"
        effective_status = "succeeded"
    else:
        effective_status = status_raw

    if effective_status == "succeeded":
        pay_status = BillingPaymentStatus.SUCCEEDED
        succeeded_at = datetime.now(UTC)
        confirmed_by = user_sub
    else:
        pay_status = BillingPaymentStatus.PENDING
        succeeded_at = None
        confirmed_by = None

    if en is not None:
        bill_kind = effective_enrollment_bill_to_kind(en)
        derived_contact_id = contact_id_for_enrollment_payment(en, bill_kind=bill_kind)
        if derived_contact_id is None and bill_kind == BillingBillToKind.CONTACT:
            raise ValidationError(
                "Enrollment must have a contact or bill-to contact for payment recording",
                field="enrollmentId",
            )
        p.contact_id = derived_contact_id

    p.amount = amount
    p.currency = currency
    p.method = method
    p.status = pay_status
    p.external_reference = ext_ref
    p.succeeded_at = succeeded_at
    p.confirmed_by = confirmed_by

    try:
        session.flush()
    except IntegrityError as exc:
        err_txt = str(exc.orig) if exc.orig is not None else str(exc)
        if "uq_cp_enrollment_external_ref" in err_txt:
            raise ConflictError(
                "duplicate_enrollment_payment_reference",
                field="externalReference",
                enrollmentId=str(p.enrollment_id) if p.enrollment_id else None,
            ) from exc
        raise


def update_manual_inbound_customer_payment(
    event: Mapping[str, Any],
    payment_id: UUID,
    *,
    user_sub: str,
    request_id: str | None,
    batch_orphan_payment_deletable: Callable[
        [Session, list[CustomerPayment]], dict[UUID, bool]
    ],
) -> dict[str, Any]:
    """Update a manual inbound payment (no Stripe PaymentIntent on row)."""
    body = parse_body(event)
    receipt_id_for_upload: UUID | None = None
    with session_with_audit(user_sub, request_id) as session:
        p = session.get(CustomerPayment, payment_id)
        if p is None:
            raise NotFoundError("CustomerPayment", str(payment_id))
        if p.direction != BillingPaymentDirection.INBOUND:
            raise ValidationError(
                "Only inbound payments can be updated", field="paymentId"
            )
        if p.stripe_payment_intent_id:
            raise ValidationError(
                "Stripe-linked inbound payments cannot be updated here",
                field="paymentId",
            )

        en: Enrollment | None = None
        if p.enrollment_id is not None:
            en = session.get(Enrollment, p.enrollment_id)
            if en is None:
                raise ValidationError(
                    "Enrollment for this payment no longer exists",
                    field="enrollmentId",
                )
            if en.status == EnrollmentStatus.CANCELLED:
                raise ValidationError(
                    "Cannot update a payment for a cancelled enrollment",
                    field="enrollmentId",
                )

        old_values = p.to_audit_dict()
        unapplied = payment_unapplied_amount(session, payment_id)
        allocated_sum = Decimal(str(p.amount)) - Decimal(str(unapplied))

        if p.status == BillingPaymentStatus.SUCCEEDED:
            _apply_succeeded_manual_patch(session, p, body, allocated_sum=allocated_sum)
        elif p.status == BillingPaymentStatus.PENDING:
            _apply_pending_manual_patch(
                session,
                p,
                en,
                body,
                user_sub=user_sub,
                allocated_sum=allocated_sum,
            )
            if p.status == BillingPaymentStatus.SUCCEEDED:
                existing_receipt = session.execute(
                    select(CustomerReceipt).where(
                        CustomerReceipt.customer_payment_id == p.id
                    )
                ).scalar_one_or_none()
                if existing_receipt is None:
                    rcpt = create_receipt_for_succeeded_inbound_payment(
                        session, payment=p
                    )
                    receipt_id_for_upload = rcpt.id
        else:
            raise ValidationError(
                "Only pending or succeeded manual inbound payments can be updated",
                field="status",
            )

        audit = AuditService(session, user_id=user_sub, request_id=request_id)
        audit.log_custom(
            table_name="customer_payments",
            record_id=p.id,
            action="MANUAL_INBOUND_PAYMENT_UPDATED",
            old_values=old_values,
            new_values=p.to_audit_dict(),
        )
        deletable = batch_orphan_payment_deletable(session, [p]).get(p.id, False)
        payload = serialize_payment_for_response(
            session, p, orphan_payment_deletable=deletable
        )

    if receipt_id_for_upload is not None:
        try:
            with Session(get_engine()) as upload_session:
                finalize_receipt_pdf_upload(
                    upload_session, receipt_id=receipt_id_for_upload
                )
                upload_session.commit()
        except Exception:
            logger.exception(
                "Receipt PDF S3 finalize failed after manual inbound payment update",
                extra={"receipt_id": str(receipt_id_for_upload)},
            )

    return json_response(200, {"payment": payload}, event=event)
