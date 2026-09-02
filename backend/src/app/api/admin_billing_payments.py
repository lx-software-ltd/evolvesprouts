"""Admin billing: customer payments.

Invoice settlement fields on ``customer_invoices`` are recomputed from
``payment_allocations`` in allocation and invoice handlers; this module does not
mutate allocation rows (orphan payment delete is blocked when allocations exist).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_billing_payments_serializers import (
    payment_allocation_invoice_refs,
    serialize_payment_for_response,
)
from app.api.admin_request import (
    encode_created_cursor,
    parse_body,
    parse_created_cursor,
    parse_limit,
    query_param,
)
from app.db.audit import AuditService, session_with_audit
from app.db.engine import get_engine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.enrollment import Enrollment
from app.db.models.enums import (
    BillingPaymentDirection,
    BillingPaymentStatus,
    EnrollmentStatus,
)
from app.db.repositories.customer_payment import CustomerPaymentRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.customer_billing import (
    create_receipt_for_succeeded_inbound_payment,
    finalize_receipt_pdf_upload,
)
from app.utils import json_response
from app.utils.logging import get_logger

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
    repository = CustomerPaymentRepository(session)
    pay_ids = [p.id for p in rows]
    allocation_pay_ids = repository.payment_ids_with_allocations(pay_ids)
    receipt_pay_ids = repository.payment_ids_with_receipts(pay_ids)
    refund_parent_ids = repository.refunded_payment_ids(pay_ids)
    enrollment_status_by_id = repository.enrollment_status_by_id(
        [p.enrollment_id for p in rows if p.enrollment_id is not None]
    )

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
    repository = CustomerPaymentRepository(session)
    if repository.has_allocations(p.id):
        raise ValidationError(
            "Payment has invoice allocations and cannot be deleted",
            field="paymentId",
        )
    if repository.has_receipt(p.id):
        raise ValidationError(
            "Payment has a receipt row and cannot be deleted", field="paymentId"
        )
    if repository.has_refunds(p.id):
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
    with session_with_audit(user_sub, request_id) as session:
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
    limit = parse_limit(event)
    cursor_ts, cursor_id = parse_created_cursor(query_param(event, "cursor"))
    invoice_raw = query_param(event, "invoice_id")
    inv_filter: UUID | None = None
    if invoice_raw and str(invoice_raw).strip():
        try:
            inv_filter = UUID(str(invoice_raw).strip())
        except (ValueError, TypeError) as exc:
            raise ValidationError(
                "invoice_id must be a UUID", field="invoice_id"
            ) from exc

    with session_with_audit(user_sub, request_id) as session:
        rows = CustomerPaymentRepository(session).list_newest(
            limit=limit + 1,
            cursor_created_at=cursor_ts,
            cursor_id=cursor_id,
            invoice_id=inv_filter,
        )
        has_more = len(rows) > limit
        page = rows[:limit]
        deletable_by_id = _batch_orphan_payment_deletable(session, page)
        next_cursor = (
            encode_created_cursor(page[-1].created_at, page[-1].id)
            if has_more and page
            else None
        )
        return json_response(
            200,
            {
                "items": [
                    serialize_payment_for_response(
                        session,
                        p,
                        orphan_payment_deletable=deletable_by_id.get(p.id, False),
                    )
                    for p in page
                ],
                "next_cursor": next_cursor,
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
    with session_with_audit(user_sub, request_id) as session:
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
    with session_with_audit(user_sub, request_id) as session:
        p = session.get(CustomerPayment, payment_id)
        if p is None:
            raise NotFoundError("CustomerPayment", str(payment_id))
        if p.status != BillingPaymentStatus.PENDING:
            raise ValidationError("Payment is not pending", field="paymentId")
        p.status = BillingPaymentStatus.SUCCEEDED
        p.succeeded_at = datetime.now(UTC)
        p.confirmed_by = user_sub
        p.external_reference = str(body.get("externalReference") or "").strip() or None
        session.flush()
        if CustomerPaymentRepository(session).get_receipt(p.id) is None:
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
