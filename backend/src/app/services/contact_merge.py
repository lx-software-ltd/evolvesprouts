"""Merge selected CRM contacts onto a keeper contact."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Contact
from app.exceptions import NotFoundError, ValidationError
from app.services.record_merge import absorb_loser_record

EVENT_SOURCE = "admin_contact_merge"


def merge_contacts(
    session: Session,
    *,
    contact_ids: list[UUID],
    keeper_contact_id: UUID,
    actor_sub: str,
) -> tuple[Contact, list[str]]:
    """Merge ``contact_ids`` into ``keeper_contact_id`` and delete the others.

    Sales leads stay as separate rows except uniqueness conflicts (same-guide
    dedupe and one open automated lead per contact). Returns the keeper and
    Mailchimp emails to archive after commit.
    """
    unique_ids = list(dict.fromkeys(contact_ids))
    if len(unique_ids) < 2:
        raise ValidationError(
            "At least two contact_ids are required", field="contact_ids"
        )
    if keeper_contact_id not in unique_ids:
        raise ValidationError(
            "keeper_contact_id must be one of contact_ids",
            field="keeper_contact_id",
        )

    contacts = session.scalars(select(Contact).where(Contact.id.in_(unique_ids))).all()
    if len(contacts) != len(unique_ids):
        raise NotFoundError("Contact", "one or more contact_ids")

    keeper = next(contact for contact in contacts if contact.id == keeper_contact_id)
    mailchimp_archive_emails: list[str] = []
    for contact in contacts:
        if contact.id == keeper.id:
            continue
        email = absorb_loser_record(
            session,
            keeper,
            contact,
            actor_sub=actor_sub,
            conflict_field="contact_ids",
            event_source=EVENT_SOURCE,
        )
        if email:
            mailchimp_archive_emails.append(email)

    keeper.updated_at = datetime.now(UTC)
    session.flush()
    return keeper, mailchimp_archive_emails
