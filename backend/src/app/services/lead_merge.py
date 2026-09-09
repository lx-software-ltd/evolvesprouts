"""Merge selected sales leads onto a keeper lead."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Contact, SalesLead
from app.exceptions import NotFoundError, ValidationError
from app.services.record_merge import absorb_loser_record, collapse_lead_rows

EVENT_SOURCE = "admin_lead_merge"


def merge_leads(
    session: Session,
    *,
    lead_ids: list[UUID],
    keeper_lead_id: UUID,
    actor_sub: str,
) -> tuple[SalesLead, list[str]]:
    """Merge ``lead_ids`` into ``keeper_lead_id`` and delete orphaned contacts.

    Returns the surviving lead and Mailchimp emails to archive after commit.
    """
    unique_ids = list(dict.fromkeys(lead_ids))
    if len(unique_ids) < 2:
        raise ValidationError("At least two lead_ids are required", field="lead_ids")
    if keeper_lead_id not in unique_ids:
        raise ValidationError(
            "keeper_lead_id must be one of lead_ids", field="keeper_lead_id"
        )

    leads = session.scalars(select(SalesLead).where(SalesLead.id.in_(unique_ids))).all()
    if len(leads) != len(unique_ids):
        raise NotFoundError("SalesLead", "one or more lead_ids")

    keeper = next(lead for lead in leads if lead.id == keeper_lead_id)
    merged_leads = [lead for lead in leads if lead.id != keeper_lead_id]
    if keeper.contact_id is None:
        raise ValidationError(
            "Keeper lead must belong to a contact", field="keeper_lead_id"
        )
    for lead in merged_leads:
        if lead.contact_id is None:
            raise ValidationError(
                "All selected leads must belong to a contact", field="lead_ids"
            )

    keeper_contact = session.get(Contact, keeper.contact_id)
    if keeper_contact is None:
        raise NotFoundError("Contact", str(keeper.contact_id))

    mailchimp_archive_emails: list[str] = []
    loser_contact_ids = {
        lead.contact_id for lead in merged_leads if lead.contact_id != keeper.contact_id
    }
    for loser_contact_id in loser_contact_ids:
        loser_contact = session.get(Contact, loser_contact_id)
        if loser_contact is None:
            raise NotFoundError("Contact", str(loser_contact_id))
        email = absorb_loser_record(
            session,
            keeper_contact,
            loser_contact,
            actor_sub=actor_sub,
            conflict_field="lead_ids",
            event_source=EVENT_SOURCE,
            preferred_lead_id=keeper.id,
        )
        if email:
            mailchimp_archive_emails.append(email)

    keeper.contact_id = keeper_contact.id
    surviving_merged: list[SalesLead] = []
    for merged_lead in merged_leads:
        loaded = session.get(SalesLead, merged_lead.id)
        if loaded is not None and loaded.id != keeper.id:
            surviving_merged.append(loaded)
    collapse_lead_rows(
        session,
        keeper,
        surviving_merged,
        actor_sub=actor_sub,
        event_source=EVENT_SOURCE,
    )
    keeper.updated_at = datetime.now(UTC)
    session.flush()
    return keeper, mailchimp_archive_emails
