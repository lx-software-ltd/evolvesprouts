"""Confirm enrollments and promote CRM parties when AR billing milestones complete."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Contact, Enrollment, Family, Organization
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.enums import BillingInvoiceStatus, EnrollmentStatus, RelationshipType
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
        org = session.get(Organization, enrollment.organization_id)
        if org is not None and org.relationship_type == RelationshipType.PROSPECT:
            org.relationship_type = RelationshipType.CLIENT
        for cid in session.scalars(
            select(OrganizationMember.contact_id).where(
                OrganizationMember.organization_id == enrollment.organization_id
            )
        ):
            contact = session.get(Contact, cid)
            if (
                contact is not None
                and contact.relationship_type == RelationshipType.PROSPECT
            ):
                contact.relationship_type = RelationshipType.CLIENT
        return

    if enrollment.family_id is not None:
        fam = session.get(Family, enrollment.family_id)
        if fam is not None and fam.relationship_type == RelationshipType.PROSPECT:
            fam.relationship_type = RelationshipType.CLIENT
        for cid in session.scalars(
            select(FamilyMember.contact_id).where(
                FamilyMember.family_id == enrollment.family_id
            )
        ):
            contact = session.get(Contact, cid)
            if (
                contact is not None
                and contact.relationship_type == RelationshipType.PROSPECT
            ):
                contact.relationship_type = RelationshipType.CLIENT
        return

    if enrollment.contact_id is not None:
        contact = session.get(Contact, enrollment.contact_id)
        if (
            contact is not None
            and contact.relationship_type == RelationshipType.PROSPECT
        ):
            contact.relationship_type = RelationshipType.CLIENT


def _confirm_registered_enrollments_for_invoice(
    session: Session, invoice_id: UUID
) -> None:
    for eid in _distinct_enrollment_ids_on_invoice(session, invoice_id):
        enrollment = session.get(Enrollment, eid)
        if enrollment is None or enrollment.status != EnrollmentStatus.REGISTERED:
            continue
        enrollment.status = EnrollmentStatus.CONFIRMED
        enrollment.cancelled_at = None
        promote_prospect_party_for_enrollment(session, enrollment)
        logger.info(
            "Enrollment status set to confirmed from billing milestone",
            extra={
                "enrollment_id": str(eid),
                "invoice_id": str(invoice_id),
            },
        )


def maybe_confirm_enrollments_on_zero_total_invoice_issue(
    session: Session, invoice: CustomerInvoice
) -> None:
    """After a zero-total invoice is issued, confirm linked registered enrollments."""
    if invoice.total != Decimal("0"):
        return
    _confirm_registered_enrollments_for_invoice(session, invoice.id)


def maybe_confirm_enrollments_on_positive_invoice_payment_allocation(
    session: Session, invoice: CustomerInvoice
) -> None:
    """After payment is allocated to a positive-total issued invoice, confirm linked enrollments."""
    if invoice.status != BillingInvoiceStatus.ISSUED:
        return
    if invoice.total <= Decimal("0"):
        return
    _confirm_registered_enrollments_for_invoice(session, invoice.id)
