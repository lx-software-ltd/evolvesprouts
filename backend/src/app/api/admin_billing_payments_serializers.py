"""Response serializers for admin customer payments."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.admin_billing_common import (
    batch_enrollment_party_display_names,
)
from app.db.models.contact import Contact, contact_full_name
from app.db.models.customer_invoice import CustomerInvoice
from app.db.models.customer_payment import CustomerPayment
from app.db.models.enrollment import Enrollment
from app.db.models.payment_allocation import PaymentAllocation
from app.db.models.service_instance import ServiceInstance
from app.services.customer_billing import (
    payment_unapplied_amount,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)


def payment_allocation_invoice_refs(
    session: Session, payment_id: UUID
) -> list[dict[str, str | None]]:
    """Distinct invoices this payment is allocated to (for admin UI pickers)."""
    inv_ids = list(
        session.execute(
            select(PaymentAllocation.invoice_id)
            .where(PaymentAllocation.payment_id == payment_id)
            .distinct()
        )
        .scalars()
        .all()
    )
    if not inv_ids:
        return []
    rows = session.execute(
        select(
            CustomerInvoice.id,
            CustomerInvoice.invoice_number,
            CustomerInvoice.created_at,
        ).where(CustomerInvoice.id.in_(inv_ids))
    ).all()
    by_id = {r[0]: (r[1], r[2]) for r in rows}
    ordered = sorted(
        inv_ids,
        key=lambda i: (
            by_id.get(i, (None, None))[1] or datetime.min.replace(tzinfo=UTC)
        ),
        reverse=True,
    )
    out: list[dict[str, str | None]] = []
    for iid in ordered:
        num, _ts = by_id.get(iid, (None, None))
        out.append(
            {
                "invoiceId": str(iid),
                "invoiceNumber": str(num).strip() if num else None,
            }
        )
    return out


def _serialize_payment(
    p: CustomerPayment, *, orphan_payment_deletable: bool
) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "direction": p.direction.value,
        "status": p.status.value,
        "method": p.method,
        "amount": str(p.amount),
        "currency": p.currency,
        "originalPaymentId": str(p.original_payment_id)
        if p.original_payment_id
        else None,
        "stripePaymentIntentId": p.stripe_payment_intent_id,
        "stripeRefundId": p.stripe_refund_id,
        "enrollmentId": str(p.enrollment_id) if p.enrollment_id else None,
        "contactId": str(p.contact_id) if p.contact_id else None,
        "externalReference": p.external_reference,
        "succeededAt": p.succeeded_at.isoformat() if p.succeeded_at else None,
        "createdAt": p.created_at.isoformat(),
        "orphanPaymentDeletable": orphan_payment_deletable,
    }


def serialize_payment_for_response(
    session: Session,
    p: CustomerPayment,
    *,
    orphan_payment_deletable: bool,
) -> dict[str, Any]:
    """Serialize a payment for API responses including list/detail parity fields."""
    out = _serialize_payment(p, orphan_payment_deletable=orphan_payment_deletable)
    out["party"] = _batch_party_label_by_payment(session, [p]).get(p.id, "—")
    out["unappliedAmount"] = str(payment_unapplied_amount(session, p.id))
    return out


def _batch_party_label_by_payment(
    session: Session, payments: list[CustomerPayment]
) -> dict[UUID, str]:
    """Bill-to style party label for each payment (enrollment party, else contact name)."""
    out: dict[UUID, str] = {p.id: "—" for p in payments}
    unique_eids = {p.enrollment_id for p in payments if p.enrollment_id is not None}
    party_by_eid: dict[UUID, str] = {}
    if unique_eids:
        stmt = (
            select(Enrollment)
            .where(Enrollment.id.in_(unique_eids))
            .options(
                joinedload(Enrollment.instance).joinedload(ServiceInstance.service),
                joinedload(Enrollment.contact),
                joinedload(Enrollment.family),
                joinedload(Enrollment.organization),
                joinedload(Enrollment.bill_to_contact),
                joinedload(Enrollment.bill_to_family),
                joinedload(Enrollment.bill_to_organization),
                joinedload(Enrollment.ticket_tier),
            )
        )
        ens = list(session.execute(stmt).unique().scalars().all())
        labels = batch_enrollment_party_display_names(session, ens)
        party_by_eid = {en.id: lab for en, lab in zip(ens, labels, strict=True)}

    contact_by_id: dict[UUID, str] = {}
    cids = {p.contact_id for p in payments if p.contact_id is not None}
    if cids:
        for c in session.execute(select(Contact).where(Contact.id.in_(cids))).scalars():
            nm = contact_full_name(c)
            contact_by_id[c.id] = (nm or "").strip() or "—"

    for p in payments:
        eid = p.enrollment_id
        if eid is not None and eid in party_by_eid:
            out[p.id] = party_by_eid[eid]
        elif p.contact_id is not None and p.contact_id in contact_by_id:
            out[p.id] = contact_by_id[p.contact_id]
    return out
