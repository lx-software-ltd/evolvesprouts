"""Confirm enrollments and promote CRM parties when AR billing milestones complete."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Contact, Enrollment, Family, Organization
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.enums import (
    BillingBillToKind,
    BillingInvoiceStatus,
    EnrollmentStatus,
    RelationshipType,
)
from app.db.models.family import FamilyMember
from app.db.models.organization import OrganizationMember
from app.utils.logging import get_logger

logger = get_logger(__name__)


def distinct_enrollment_ids_on_invoice(
    session: Session, invoice_id: UUID
) -> list[UUID]:
    """Return distinct non-null enrollment ids on invoice lines."""
    stmt = (
        select(CustomerInvoiceLine.enrollment_id)
        .where(
            CustomerInvoiceLine.invoice_id == invoice_id,
            CustomerInvoiceLine.enrollment_id.is_not(None),
        )
        .distinct()
    )
    rows = list(session.scalars(stmt).all())
    return [eid for eid in rows if eid is not None]


def _distinct_enrollment_ids_on_invoice(
    session: Session, invoice_id: UUID
) -> list[UUID]:
    return distinct_enrollment_ids_on_invoice(session, invoice_id)


def promote_prospect_party_for_enrollment(
    session: Session, enrollment: Enrollment
) -> None:
    """Set party relationship to client when it is still prospect (contact, family, or org)."""
    if enrollment.organization_id is not None:
        _promote_organization_party(session, enrollment.organization_id)
        return

    if enrollment.family_id is not None:
        _promote_family_party(session, enrollment.family_id)
        return

    if enrollment.contact_id is not None:
        _promote_contact_if_prospect(session, enrollment.contact_id)


def promote_prospect_party_for_invoice_bill_to(
    session: Session, invoice: CustomerInvoice
) -> None:
    """Promote the invoice bill-to party when it is still prospect."""
    if invoice.bill_to_kind == BillingBillToKind.ORGANIZATION:
        if invoice.bill_to_organization_id is not None:
            _promote_organization_party(session, invoice.bill_to_organization_id)
        return
    if invoice.bill_to_kind == BillingBillToKind.FAMILY:
        if invoice.bill_to_family_id is not None:
            _promote_family_party(session, invoice.bill_to_family_id)
        return
    if invoice.bill_to_contact_id is not None:
        _promote_contact_if_prospect(session, invoice.bill_to_contact_id)


def _promote_contact_if_prospect(session: Session, contact_id: UUID) -> None:
    contact = session.get(Contact, contact_id)
    if contact is not None and contact.relationship_type == RelationshipType.PROSPECT:
        contact.relationship_type = RelationshipType.CLIENT


def _promote_family_party(session: Session, family_id: UUID) -> None:
    fam = session.get(Family, family_id)
    if fam is not None and fam.relationship_type == RelationshipType.PROSPECT:
        fam.relationship_type = RelationshipType.CLIENT
    for cid in session.scalars(
        select(FamilyMember.contact_id).where(FamilyMember.family_id == family_id)
    ):
        _promote_contact_if_prospect(session, cid)


def _promote_organization_party(session: Session, organization_id: UUID) -> None:
    org = session.get(Organization, organization_id)
    if org is not None and org.relationship_type == RelationshipType.PROSPECT:
        org.relationship_type = RelationshipType.CLIENT
    for cid in session.scalars(
        select(OrganizationMember.contact_id).where(
            OrganizationMember.organization_id == organization_id
        )
    ):
        _promote_contact_if_prospect(session, cid)


def _confirm_registered_enrollments_for_invoice(
    session: Session, invoice_id: UUID
) -> None:
    """Mark registered enrollments confirmed. Does not change CRM relationship."""
    for eid in _distinct_enrollment_ids_on_invoice(session, invoice_id):
        enrollment = session.get(Enrollment, eid)
        if enrollment is None or enrollment.status != EnrollmentStatus.REGISTERED:
            continue
        enrollment.status = EnrollmentStatus.CONFIRMED
        enrollment.cancelled_at = None
        logger.info(
            "Enrollment status set to confirmed from billing milestone",
            extra={
                "enrollment_id": str(eid),
                "invoice_id": str(invoice_id),
            },
        )


def _promote_parties_for_fully_paid_invoice(
    session: Session, invoice: CustomerInvoice
) -> None:
    """Promote bill-to and linked enrollment parties after the invoice is fully paid."""
    promote_prospect_party_for_invoice_bill_to(session, invoice)
    for eid in _distinct_enrollment_ids_on_invoice(session, invoice.id):
        enrollment = session.get(Enrollment, eid)
        if enrollment is None:
            continue
        if enrollment.status not in (
            EnrollmentStatus.REGISTERED,
            EnrollmentStatus.CONFIRMED,
        ):
            continue
        promote_prospect_party_for_enrollment(session, enrollment)
        logger.info(
            "Prospect party promoted after invoice fully paid",
            extra={
                "enrollment_id": str(eid),
                "invoice_id": str(invoice.id),
            },
        )


def maybe_confirm_enrollments_on_zero_total_invoice_issue(
    session: Session, invoice: CustomerInvoice
) -> None:
    """After a zero-total invoice is issued, confirm linked registered enrollments.

    Free / fully-discounted invoices do not promote CRM parties to client.
    """
    if invoice.total != Decimal("0"):
        return
    _confirm_registered_enrollments_for_invoice(session, invoice.id)


def maybe_confirm_enrollments_on_positive_invoice_payment_allocation(
    session: Session, invoice: CustomerInvoice
) -> None:
    """After payment allocation on a positive-total issued invoice.

    Registered enrollments are confirmed on any allocation. CRM parties become
    ``client`` only when the invoice is fully paid (``paid_at`` set by
    ``recompute_invoice_settlement`` before this runs). Part-payments leave
    parties as prospect. Promotion is not reversed on refund or void.
    """
    if invoice.status != BillingInvoiceStatus.ISSUED:
        return
    if invoice.total <= Decimal("0"):
        return
    _confirm_registered_enrollments_for_invoice(session, invoice.id)
    if invoice.paid_at is None:
        return
    _promote_parties_for_fully_paid_invoice(session, invoice)
