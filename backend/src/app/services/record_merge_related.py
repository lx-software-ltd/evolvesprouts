"""Reassign related CRM rows when folding one record onto another."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable
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


def reassign_related_records(
    session: Session,
    *,
    from_id: UUID,
    to_id: UUID,
    actor_sub: str,
    event_source: str,
) -> None:
    """Point related rows at ``to_id``; collapse lead uniqueness conflicts."""
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

    loser_leads = list(
        session.scalars(select(SalesLead).where(SalesLead.contact_id == from_id)).all()
    )
    for lead in loser_leads:
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
        else:
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
    merged_leads: Iterable[SalesLead],
    *,
    actor_sub: str,
    event_source: str,
) -> None:
    """Move child rows onto ``keeper`` and delete the extra lead rows."""
    merged_ids: list[UUID] = []
    for lead in merged_leads:
        if lead.id == keeper.id:
            continue
        merged_ids.append(lead.id)
        if _LEAD_TYPE_RANK.get(lead.lead_type, 0) > _LEAD_TYPE_RANK.get(
            keeper.lead_type, 0
        ):
            keeper.lead_type = lead.lead_type
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


def resolve_open_lead_conflicts(
    session: Session,
    *,
    keeper_id: UUID,
    actor_sub: str,
    event_source: str,
    preferred_lead_id: UUID | None = None,
) -> None:
    """Collapse extra non-manual open leads so one-open-per-contact still holds."""
    open_leads = list(
        session.scalars(
            select(SalesLead).where(
                SalesLead.contact_id == keeper_id,
                SalesLead.is_manual.is_(False),
                SalesLead.funnel_stage.in_(tuple(OPEN_FUNNEL_STAGES)),
            )
        ).all()
    )
    if len(open_leads) < 2:
        return
    preferred = next(
        (lead for lead in open_leads if lead.id == preferred_lead_id),
        None,
    )
    keeper_lead = preferred or max(open_leads, key=_open_lead_sort_key)
    extras = [lead for lead in open_leads if lead.id != keeper_lead.id]
    collapse_lead_rows(
        session,
        keeper_lead,
        extras,
        actor_sub=actor_sub,
        event_source=event_source,
    )


def _open_lead_sort_key(lead: SalesLead) -> tuple[int, datetime]:
    updated = lead.updated_at or datetime.min.replace(tzinfo=UTC)
    return (_LEAD_TYPE_RANK.get(lead.lead_type, 0), updated)
