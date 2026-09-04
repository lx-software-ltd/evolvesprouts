"""Move matching leads to converted when an invoice is fully paid."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.audit import INVOICE_PAID_AUDIT_USER_ID, SYSTEM_AUDIT_USER_ID
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.enrollment import Enrollment
from app.db.models.enums import FunnelStage, LeadEventType
from app.db.models.family import FamilyMember
from app.db.models.organization import OrganizationMember
from app.db.models.sales_lead import SalesLead
from app.db.repositories.sales_lead import SalesLeadRepository
from app.utils.logging import get_logger

logger = get_logger(__name__)

INVOICE_PAID_ACTOR = INVOICE_PAID_AUDIT_USER_ID


def convert_leads_for_paid_invoice(
    session: Session,
    invoice: CustomerInvoice,
    *,
    actor_sub: str = INVOICE_PAID_ACTOR,
) -> list[UUID]:
    """Convert open or lost leads for the invoice's bill-to and enrollment contacts.

    Already-converted leads are left alone. Returns converted lead ids.
    """
    contact_ids = _contact_ids_for_invoice(session, invoice)
    if not contact_ids:
        logger.info(
            "Paid invoice has no matching contacts to convert",
            extra={"invoice_id": str(invoice.id)},
        )
        return []
    repository = SalesLeadRepository(session)
    converted: list[UUID] = []
    for contact_id in contact_ids:
        lead = repository.find_reusable_by_contact(contact_id)
        if lead is None:
            continue
        if getattr(lead, "funnel_stage", None) == FunnelStage.CONVERTED:
            continue
        _mark_converted(repository, lead, actor_sub=actor_sub)
        converted.append(lead.id)
    if converted:
        logger.info(
            "Converted leads after invoice paid",
            extra={
                "invoice_id": str(invoice.id),
                "lead_count": len(converted),
            },
        )
    return converted


def _mark_converted(
    repository: SalesLeadRepository,
    lead: SalesLead,
    *,
    actor_sub: str,
) -> None:
    previous = lead.funnel_stage
    now = datetime.now(UTC)
    lead.funnel_stage = FunnelStage.CONVERTED
    lead.converted_at = now
    lead.lost_at = None
    lead.lost_reason = None
    lead.updated_at = now
    repository.update(lead)
    repository.add_event(
        lead_id=lead.id,
        event_type=LeadEventType.STAGE_CHANGED,
        from_stage=previous,
        to_stage=FunnelStage.CONVERTED,
        metadata={"reason": "invoice_paid"},
        created_by=actor_sub or SYSTEM_AUDIT_USER_ID,
    )


def _contact_ids_for_invoice(session: Session, invoice: CustomerInvoice) -> list[UUID]:
    ids: list[UUID] = []
    seen: set[UUID] = set()

    def _add(value: UUID | None) -> None:
        if value is None or value in seen:
            return
        seen.add(value)
        ids.append(value)

    _add(getattr(invoice, "bill_to_contact_id", None))
    family_id = getattr(invoice, "bill_to_family_id", None)
    if family_id is not None:
        for contact_id in session.scalars(
            select(FamilyMember.contact_id).where(
                FamilyMember.family_id == family_id,
                FamilyMember.is_primary_contact.is_(True),
            )
        ):
            _add(contact_id)
    organization_id = getattr(invoice, "bill_to_organization_id", None)
    if organization_id is not None:
        for contact_id in session.scalars(
            select(OrganizationMember.contact_id).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_primary_contact.is_(True),
            )
        ):
            _add(contact_id)
    enrollment_ids = [
        line.enrollment_id
        for line in _invoice_lines(session, invoice)
        if getattr(line, "enrollment_id", None) is not None
    ]
    if enrollment_ids:
        for enrollment_contact_id in session.scalars(
            select(Enrollment.contact_id).where(Enrollment.id.in_(enrollment_ids))
        ):
            _add(enrollment_contact_id)
    return ids


def _invoice_lines(
    session: Session, invoice: CustomerInvoice
) -> list[CustomerInvoiceLine]:
    loaded = getattr(invoice, "lines", None)
    if loaded:
        return list(loaded)
    return list(
        session.scalars(
            select(CustomerInvoiceLine).where(
                CustomerInvoiceLine.invoice_id == invoice.id
            )
        ).all()
    )
