"""Admin billing: customer payments.

Invoice settlement fields on ``customer_invoices`` are recomputed from
``payment_allocations`` in allocation and invoice handlers; this module does not
mutate allocation rows (orphan payment delete is blocked when allocations exist).
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.api.admin_billing_common import (
    DEFAULT_BILLING_LIST_LIMIT,
    _session_with_audit,
)
from app.api.admin_request import parse_body, query_param
from app.db.audit import AuditService
from app.db.engine import get_engine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.customer_receipt import CustomerReceipt
from app.db.models.enrollment import Enrollment
from app.db.models.enums import (
    BillingPaymentDirection,
    BillingPaymentStatus,
    EnrollmentStatus,
)
from app.db.models.payment_allocation import PaymentAllocation
from app.exceptions import NotFoundError, ValidationError
from app.services.customer_billing import (
    create_receipt_for_succeeded_inbound_payment,
    finalize_receipt_pdf_upload,
    payment_unapplied_amount,
)
from app.utils import json_response
from app.utils.logging import get_logger
from app.api.admin_billing_payments_serializers import (
    payment_allocation_invoice_refs,
    serialize_payment_for_response,
)

logger = get_logger(__name__)


def _pending_or_free_payment(p: CustomerPayment) -> bool:
    if p.status == BillingPaymentStatus.PENDING:
        return True
    if p.method.strip().lower() == "free":
        return True
    if p.amount == Decimal("0"):
        return True
    return False


def _enrollment_unlinked_or_cancelled(
    enrollment_id: UUID | None,
    enrollment_status_by_id: dict[UUID, EnrollmentStatus],
) -> bool:
    if enrollment_id is None:
        return True
    status = enrollment_status_by_id.get(enrollment_id)
    if status is None:
        return True
    return status == EnrollmentStatus.CANCELLED


def _batch_orphan_payment_deletable(
    session: Session, rows: list[CustomerPayment]
) -> dict[UUID, bool]:
    """Server-side eligibility for DELETE (matches single-payment validation)."""
    if not rows:
        return {}
    pay_ids = [p.id for p in rows]
    allocation_pay_ids = {
        row[0]
        for row in session.execute(
            select(PaymentAllocation.payment_id).where(
                PaymentAllocation.payment_id.in_(pay_ids)
            )
        ).all()
    }
    receipt_pay_ids = {
        row[0]
        for row in session.execute(
            select(CustomerReceipt.customer_payment_id).where(
                CustomerReceipt.customer_payment_id.in_(pay_ids)
            )
        ).all()
    }
    refund_parent_ids: set[UUID] = set()
    for (orig_id,) in session.execute(
        select(CustomerPayment.original_payment_id).where(
            CustomerPayment.original_payment_id.in_(pay_ids),
            CustomerPayment.direction == BillingPaymentDirection.REFUND,
        )
    ).all():
        if orig_id is not None:
            refund_parent_ids.add(orig_id)
    enrollment_ids = [p.enrollment_id for p in rows if p.enrollment_id is not None]
    enrollment_status_by_id: dict[UUID, EnrollmentStatus] = {}
    if enrollment_ids:
        for eid, st in session.execute(
            select(Enrollment.id, Enrollment.status).where(
                Enrollment.id.in_(enrollment_ids)
            )
        ):
            enrollment_status_by_id[eid] = st

    out: dict[UUID, bool] = {}
    for p in rows:
        ok = (
            p.direction == BillingPaymentDirection.INBOUND
            and _pending_or_free_payment(p)
            and _enrollment_unlinked_or_cancelled(
                p.enrollment_id, enrollment_status_by_id
            )
            and p.id not in allocation_pay_ids
            and p.id not in receipt_pay_ids
            and p.id not in refund_parent_ids
        )
        out[p.id] = ok
    return out


def _validate_orphan_delete(session: Session, p: CustomerPayment) -> None:
    if p.direction != BillingPaymentDirection.INBOUND:
        raise ValidationError("Only inbound payments can be deleted", field="paymentId")
    if not _pending_or_free_payment(p):
        raise ValidationError(
            "Only pending inbound or free ($0) payments can be deleted",
            field="paymentId",
        )
    if p.enrollment_id is not None:
        en = session.get(Enrollment, p.enrollment_id)
        if en is not None and en.status != EnrollmentStatus.CANCELLED:
            raise ValidationError(
                "Payment is still linked to an enrollment that is not cancelled",
                field="enrollmentId",
            )
    has_alloc = session.execute(
        select(
            exists().where(PaymentAllocation.payment_id == p.id),
        )
    ).scalar_one()
    if has_alloc:
        raise ValidationError(
            "Payment has invoice allocations and cannot be deleted",
            field="paymentId",
        )
    has_rcpt = session.execute(
        select(exists().where(CustomerReceipt.customer_payment_id == p.id))
    ).scalar_one()
    if has_rcpt:
        raise ValidationError(
            "Payment has a receipt row and cannot be deleted", field="paymentId"
        )
    has_refund = session.execute(
        select(
            exists().where(
                CustomerPayment.original_payment_id == p.id,
                CustomerPayment.direction == BillingPaymentDirection.REFUND,
            )
        )
    ).scalar_one()
    if has_refund:
        raise ValidationError(
            "Payment has linked refund rows and cannot be deleted",
            field="paymentId",
        )


def _delete_payment(
    event: Mapping[str, Any],
    payment_id: UUID,
    *,
    user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    with _session_with_audit(user_sub, request_id) as session:
        p = session.get(CustomerPayment, payment_id)
        if p is None:
            raise NotFoundError("CustomerPayment", str(payment_id))
        _validate_orphan_delete(session, p)
        old_values = p.to_audit_dict()
        audit = AuditService(session, user_id=user_sub, request_id=request_id)
        audit.log_custom(
            table_name="customer_payments",
            record_id=payment_id,
            action="ORPHAN_INBOUND_PAYMENT_DELETED",
            old_values=old_values,
        )
        session.delete(p)
        session.flush()
    return json_response(204, {}, event=event)


def _list_payments(
    event: Mapping[str, Any], *, user_sub: str, request_id: str | None
) -> dict[str, Any]:
    invoice_raw = query_param(event, "invoice_id") or query_param(event, "invoiceId")
    inv_filter: UUID | None = None
    if invoice_raw and str(invoice_raw).strip():
        try:
            inv_filter = UUID(str(invoice_raw).strip())
        except (ValueError, TypeError) as exc:
            raise ValidationError(
                "invoice_id must be a UUID", field="invoice_id"
            ) from exc

    with _session_with_audit(user_sub, request_id) as session:
        stmt = select(CustomerPayment).order_by(CustomerPayment.created_at.desc())
        if inv_filter is not None:
            subq = (
                select(PaymentAllocation.payment_id)
                .where(PaymentAllocation.invoice_id == inv_filter)
                .distinct()
                .subquery()
            )
            stmt = (
                select(CustomerPayment)
                .join(subq, CustomerPayment.id == subq.c.payment_id)
                .order_by(CustomerPayment.created_at.desc())
            )
        stmt = stmt.limit(DEFAULT_BILLING_LIST_LIMIT)
        rows = list(session.execute(stmt).scalars().all())
        deletable_by_id = _batch_orphan_payment_deletable(session, rows)
        return json_response(
            200,
            {
                "items": [
                    serialize_payment_for_response(
                        session,
                        p,
                        orphan_payment_deletable=deletable_by_id.get(p.id, False),
                    )
                    for p in rows
                ]
            },
            event=event,
        )


def _get_payment(
    event: Mapping[str, Any],
    payment_id: UUID,
    *,
    user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    with _session_with_audit(user_sub, request_id) as session:
        p = session.get(CustomerPayment, payment_id)
        if p is None:
            raise NotFoundError("CustomerPayment", str(payment_id))
        allocation_invoices = payment_allocation_invoice_refs(session, payment_id)
        deletable = _batch_orphan_payment_deletable(session, [p]).get(p.id, False)
        return json_response(
            200,
            {
                **serialize_payment_for_response(
                    session, p, orphan_payment_deletable=deletable
                ),
                "allocationInvoices": allocation_invoices,
            },
            event=event,
        )


def _unapplied(
    event: Mapping[str, Any],
    payment_id: UUID,
    *,
    user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    with _session_with_audit(user_sub, request_id) as session:
        p = session.get(CustomerPayment, payment_id)
        if p is None:
            raise NotFoundError("CustomerPayment", str(payment_id))
        u = payment_unapplied_amount(session, payment_id)
        return json_response(
            200,
            {"paymentId": str(payment_id), "unappliedAmount": str(u)},
            event=event,
        )


def _create_payment(
    event: Mapping[str, Any], *, user_sub: str, request_id: str | None
) -> dict[str, Any]:
    from app.api.admin_billing_payment_create import (
        create_manual_inbound_payment,
        create_refund_payment,
    )

    body = parse_body(event)
    direction = str(body.get("direction") or "").strip().lower()
    if direction == "refund":
        return create_refund_payment(
            event,
            body,
            user_sub=user_sub,
            request_id=request_id,
        )
    if direction == "inbound":
        return create_manual_inbound_payment(
            event,
            body,
            user_sub=user_sub,
            request_id=request_id,
            batch_orphan_payment_deletable=_batch_orphan_payment_deletable,
        )
    raise ValidationError(
        "direction must be refund (refund row) or inbound (manual customer payment)",
        field="direction",
    )


def _confirm_payment(
    event: Mapping[str, Any],
    payment_id: UUID,
    *,
    user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    body = parse_body(event) if event.get("body") else {}
    receipt_id_for_upload: UUID | None = None
    with _session_with_audit(user_sub, request_id) as session:
        p = session.get(CustomerPayment, payment_id)
        if p is None:
            raise NotFoundError("CustomerPayment", str(payment_id))
        if p.status != BillingPaymentStatus.PENDING:
            raise ValidationError("Payment is not pending", field="paymentId")
        p.status = BillingPaymentStatus.SUCCEEDED
        p.succeeded_at = datetime.now(UTC)
        p.confirmed_by = user_sub
        p.external_reference = (
            str(
                body.get("externalReference") or body.get("external_reference") or ""
            ).strip()
            or None
        )
        session.flush()
        existing_receipt = session.execute(
            select(CustomerReceipt).where(CustomerReceipt.customer_payment_id == p.id)
        ).scalar_one_or_none()
        if existing_receipt is None:
            rcpt = create_receipt_for_succeeded_inbound_payment(session, payment=p)
            receipt_id_for_upload = rcpt.id
        deletable = _batch_orphan_payment_deletable(session, [p]).get(p.id, False)
        out = serialize_payment_for_response(
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
                "Receipt PDF S3 finalize failed after payment confirm",
                extra={"receipt_id": str(receipt_id_for_upload)},
            )
    return json_response(200, {"payment": out}, event=event)


def _update_manual_inbound_payment(
    event: Mapping[str, Any],
    payment_id: UUID,
    *,
    user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    from app.api.admin_billing_payment_update import (
        update_manual_inbound_customer_payment,
    )

    return update_manual_inbound_customer_payment(
        event,
        payment_id,
        user_sub=user_sub,
        request_id=request_id,
        batch_orphan_payment_deletable=_batch_orphan_payment_deletable,
    )
