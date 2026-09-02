"""Admin billing: payment allocations."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.api.admin_request import parse_body
from app.db.audit import session_with_audit
from app.db.models.customer_invoice import CustomerInvoice
from app.db.models.customer_payment import CustomerPayment
from app.db.models.payment_allocation import PaymentAllocation
from app.exceptions import NotFoundError, ValidationError
from app.services.billing_enrollment_confirmation import (
    maybe_confirm_enrollments_on_positive_invoice_payment_allocation,
)
from app.services.customer_billing import (
    payment_unapplied_amount,
    recompute_invoice_settlement,
)
from app.utils import json_response


def _create_allocation(
    event: Mapping[str, Any], *, user_sub: str, request_id: str | None
) -> dict[str, Any]:
    body = parse_body(event)
    try:
        payment_id = UUID(str(body.get("paymentId")))
    except (ValueError, TypeError) as exc:
        raise ValidationError("paymentId must be a UUID", field="paymentId") from exc
    try:
        invoice_id = UUID(str(body.get("invoiceId")))
    except (ValueError, TypeError) as exc:
        raise ValidationError("invoiceId must be a UUID", field="invoiceId") from exc
    try:
        amt = Decimal(str(body.get("allocatedAmount")))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValidationError(
            "allocatedAmount must be a decimal number", field="allocatedAmount"
        ) from exc
    if amt <= 0:
        raise ValidationError(
            "allocatedAmount must be greater than zero",
            field="allocatedAmount",
        )
    currency = str(body.get("currency") or "").upper()[:3]
    line_id_raw = body.get("invoiceLineId")
    line_id: UUID | None = None
    if line_id_raw:
        try:
            line_id = UUID(str(line_id_raw))
        except (ValueError, TypeError) as exc:
            raise ValidationError(
                "invoiceLineId must be a UUID", field="invoiceLineId"
            ) from exc

    with session_with_audit(user_sub, request_id) as session:
        pay = session.execute(
            select(CustomerPayment)
            .where(CustomerPayment.id == payment_id)
            .with_for_update()
        ).scalar_one_or_none()
        inv = session.get(CustomerInvoice, invoice_id)
        if pay is None or inv is None:
            raise NotFoundError(
                "PaymentAllocationTarget",
                f"{payment_id}/{invoice_id}",
            )
        if pay.currency != currency or inv.currency != currency:
            raise ValidationError("Currency mismatch", field="currency")
        unapplied = payment_unapplied_amount(session, payment_id)
        if amt > unapplied:
            raise ValidationError(
                "Allocation exceeds unapplied amount", field="allocatedAmount"
            )
        alloc = PaymentAllocation(
            payment_id=payment_id,
            invoice_id=invoice_id,
            invoice_line_id=line_id,
            allocated_amount=amt,
            currency=currency,
        )
        session.add(alloc)
        session.flush()
        recompute_invoice_settlement(session, inv)
        maybe_confirm_enrollments_on_positive_invoice_payment_allocation(session, inv)
        return json_response(
            201,
            {"allocationId": str(alloc.id)},
            event=event,
        )
