"""Reassign related CRM rows when folding one record onto another."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.api.admin_contacts_helpers import REFERRAL_CONTACT_METADATA_KEY
from app.db.models import (
    CompletionCertificate,
    Contact,
    CustomerInvoice,
    CustomerPayment,
    Enrollment,
    MetaConversation,
    Note,
    SalesLead,
    SalesLeadAiSuggestion,
    SalesLeadAiSuggestionJob,
    SalesLeadEvent,
    WhatsAppConversation,
)
from app.db.models.enums import FunnelStage, LeadEventType
from app.services.lead_funnel_automation import _LEAD_TYPE_RANK

OPEN_FUNNEL_STAGES = frozenset(
    {
        FunnelStage.NEW,
        FunnelStage.CONTACTED,
        FunnelStage.ENGAGED,
        FunnelStage.QUALIFIED,
        FunnelStage.UNQUALIFIED,
    }
)

# Match 0086_one_open_lead_contact: positive pipeline progress outranks
# unqualified. Closed stages outrank every open stage.
_FUNNEL_STAGE_RANK = {
    FunnelStage.UNQUALIFIED: 0,
    FunnelStage.NEW: 1,
    FunnelStage.CONTACTED: 2,
    FunnelStage.ENGAGED: 3,
    FunnelStage.QUALIFIED: 4,
    FunnelStage.CONVERTED: 5,
    FunnelStage.LOST: 5,
}


def reassign_related_records(
    session: Session,
    *,
    from_id: UUID,
    to_id: UUID,
    actor_sub: str,
    event_source: str,
    skip_lead_ids: frozenset[UUID] | None = None,
) -> None:
    """Point related rows at ``to_id``; collapse lead uniqueness conflicts.

    ``skip_lead_ids`` are selected lead-merge rows. Leave them on the loser
    until ``collapse_lead_rows`` folds them onto the chosen keeper lead.
    """
    session.execute(
        update(CompletionCertificate)
        .where(CompletionCertificate.contact_id == from_id)
        .values(contact_id=to_id)
    )
    session.execute(
        update(CustomerInvoice)
        .where(CustomerInvoice.bill_to_contact_id == from_id)
        .values(bill_to_contact_id=to_id)
    )
    session.execute(
        update(CustomerPayment)
        .where(CustomerPayment.contact_id == from_id)
        .values(contact_id=to_id)
    )
    session.execute(
        update(Note).where(Note.contact_id == from_id).values(contact_id=to_id)
    )
    session.execute(
        update(WhatsAppConversation)
        .where(WhatsAppConversation.contact_id == from_id)
        .values(contact_id=to_id)
    )
    session.execute(
        update(MetaConversation)
        .where(MetaConversation.contact_id == from_id)
        .values(contact_id=to_id)
    )
    session.execute(
        update(Enrollment)
        .where(Enrollment.bill_to_contact_id == from_id)
        .values(bill_to_contact_id=to_id)
    )
    reassign_enrollment_rows(session, from_id, to_id)

    skip = skip_lead_ids or frozenset()
    loser_leads = list(
        session.scalars(select(SalesLead).where(SalesLead.contact_id == from_id)).all()
    )
    for lead in loser_leads:
        if lead.id in skip:
            continue
        conflict = session.scalar(
            select(SalesLead.id).where(
                SalesLead.contact_id == to_id,
                SalesLead.lead_type == lead.lead_type,
                SalesLead.asset_id == lead.asset_id,
                SalesLead.asset_id.is_not(None),
                SalesLead.id != lead.id,
            )
        )
        if conflict is not None:
            target = session.get(SalesLead, conflict)
            if target is None:
                continue
            collapse_lead_rows(
                session,
                target,
                [lead],
                actor_sub=actor_sub,
                event_source=event_source,
            )
            continue
        if _is_open_automated(lead):
            keeper_open = _open_automated_lead(session, to_id, exclude_id=lead.id)
            if keeper_open is not None:
                # Fold before changing contact_id. A later autoflush would
                # otherwise save two open automated leads and hit
                # sales_leads_one_open_contact_idx.
                collapse_lead_rows(
                    session,
                    keeper_open,
                    [lead],
                    actor_sub=actor_sub,
                    event_source=event_source,
                )
                continue
        lead.contact_id = to_id


def reassign_enrollment_rows(
    session: Session,
    from_id: UUID,
    to_id: UUID,
) -> None:
    keeper_instance_ids = set(
        session.scalars(
            select(Enrollment.instance_id).where(Enrollment.contact_id == to_id)
        ).all()
    )
    loser_enrollments = session.scalars(
        select(Enrollment).where(Enrollment.contact_id == from_id)
    ).all()
    for enrollment in loser_enrollments:
        if enrollment.instance_id in keeper_instance_ids:
            session.delete(enrollment)
        else:
            enrollment.contact_id = to_id
            keeper_instance_ids.add(enrollment.instance_id)


def remap_referrer_ids(
    session: Session,
    source_id: UUID,
    target_id: UUID,
) -> None:
    source_key = str(source_id)
    contacts = session.scalars(
        select(Contact).where(
            Contact.source_metadata[REFERRAL_CONTACT_METADATA_KEY].as_string()
            == source_key
        )
    ).all()
    for contact in contacts:
        updated = dict(contact.source_metadata or {})
        updated[REFERRAL_CONTACT_METADATA_KEY] = str(target_id)
        contact.source_metadata = updated


def collapse_lead_rows(
    session: Session,
    keeper: SalesLead,
    merged_leads: list[SalesLead],
    *,
    actor_sub: str,
    event_source: str,
) -> None:
    """Move child rows onto ``keeper`` and delete the extra lead rows."""
    extras = [lead for lead in merged_leads if lead.id != keeper.id]
    merged_ids: list[UUID] = []
    for lead in extras:
        merged_ids.append(lead.id)
        if _LEAD_TYPE_RANK.get(lead.lead_type, 0) > _LEAD_TYPE_RANK.get(
            keeper.lead_type, 0
        ):
            keeper.lead_type = lead.lead_type
        if _FUNNEL_STAGE_RANK.get(lead.funnel_stage, 0) > _FUNNEL_STAGE_RANK.get(
            keeper.funnel_stage, 0
        ):
            keeper.funnel_stage = lead.funnel_stage
        if keeper.assigned_to is None and lead.assigned_to is not None:
            keeper.assigned_to = lead.assigned_to
        if lead.is_manual:
            keeper.is_manual = True
        if keeper.asset_id is None and lead.asset_id is not None:
            keeper.asset_id = lead.asset_id
        if keeper.converted_at is None and lead.converted_at is not None:
            keeper.converted_at = lead.converted_at
        if keeper.lost_at is None and lead.lost_at is not None:
            keeper.lost_at = lead.lost_at
        if keeper.lost_reason is None and lead.lost_reason is not None:
            keeper.lost_reason = lead.lost_reason
        if lead.updated_at is not None and (
            keeper.updated_at is None or lead.updated_at > keeper.updated_at
        ):
            keeper.updated_at = lead.updated_at

    if not merged_ids:
        return

    for model, column in (
        (Note, Note.lead_id),
        (SalesLeadEvent, SalesLeadEvent.lead_id),
        (SalesLeadAiSuggestion, SalesLeadAiSuggestion.lead_id),
        (SalesLeadAiSuggestionJob, SalesLeadAiSuggestionJob.lead_id),
        (WhatsAppConversation, WhatsAppConversation.lead_id),
        (MetaConversation, MetaConversation.lead_id),
    ):
        session.execute(
            update(model).where(column.in_(merged_ids)).values(lead_id=keeper.id)
        )

    session.execute(delete(SalesLead).where(SalesLead.id.in_(merged_ids)))
    for merged in extras:
        if merged in session:
            session.expunge(merged)
    session.add(
        SalesLeadEvent(
            lead_id=keeper.id,
            event_type=LeadEventType.ACTION_RECORDED,
            metadata={
                "source": event_source,
                "merged_lead_ids": [str(value) for value in merged_ids],
                "actor_sub": actor_sub,
            },
            created_by=actor_sub,
        )
    )


def _is_open_automated(lead: SalesLead) -> bool:
    return not lead.is_manual and lead.funnel_stage in OPEN_FUNNEL_STAGES


def _open_automated_lead(
    session: Session, contact_id: UUID, *, exclude_id: UUID
) -> SalesLead | None:
    """Return the contact's open automated lead, ignoring pending moves.

    Called inside ``no_autoflush`` so a lead whose ``contact_id`` was only
    changed in memory is not written before this lookup.
    """
    return session.scalar(
        select(SalesLead)
        .where(
            SalesLead.contact_id == contact_id,
            SalesLead.id != exclude_id,
            SalesLead.is_manual.is_(False),
            SalesLead.funnel_stage.in_(tuple(OPEN_FUNNEL_STAGES)),
        )
        .limit(1)
    )
