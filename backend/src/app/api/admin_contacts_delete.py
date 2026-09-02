"""Delete handler for admin CRM contacts (hard delete plus Mailchimp archive)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin_entities_helpers import (
    request_id,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.enums import MailchimpSyncStatus
from app.db.models.note import Note
from app.db.models.sales_lead import SalesLead
from app.db.repositories import ContactRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.mailchimp_sync import remove_contact_from_mailchimp
from app.utils import json_response
from app.utils.logging import get_logger, mask_email

logger = get_logger(__name__)


MAILCHIMP_PUSH_REMOVE_STATUSES = frozenset(
    {
        MailchimpSyncStatus.SYNCED,
        MailchimpSyncStatus.FAILED,
        MailchimpSyncStatus.PENDING,
    }
)


def delete_contact(
    event: Mapping[str, Any],
    *,
    contact_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    """Permanently delete one CRM contact and dependent CRM rows.

    Orphan cleanup may race this handler and also call Mailchimp archive for the same email;
    duplicate archive calls are idempotent on Mailchimp (404 is treated as success).
    """
    logger.info(
        "Deleting admin CRM contact",
        extra={"contact_id": str(contact_id), "actor_sub": actor_sub},
    )

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = ContactRepository(session)
        contact = repository.get_by_id_for_admin(contact_id)
        if contact is None:
            raise NotFoundError("Contact", str(contact_id))

        mailchimp_email_for_delete: str | None = None
        if contact.email and contact.mailchimp_status in MAILCHIMP_PUSH_REMOVE_STATUSES:
            mailchimp_email_for_delete = contact.email

        lead_ids = list(
            session.scalars(
                select(SalesLead.id).where(SalesLead.contact_id == contact_id)
            ).all()
        )
        if lead_ids:
            session.execute(delete(Note).where(Note.lead_id.in_(tuple(lead_ids))))
        session.execute(delete(Note).where(Note.contact_id == contact_id))
        session.execute(delete(SalesLead).where(SalesLead.contact_id == contact_id))

        try:
            repository.delete(contact)
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise ValidationError(
                "Contact cannot be deleted while it is still referenced",
                field="contact_id",
            ) from exc

    # Avoid holding the DB session during Mailchimp retries (API Gateway ~30s limit).
    if mailchimp_email_for_delete:
        removal = remove_contact_from_mailchimp(
            email=mailchimp_email_for_delete,
            logger=logger,
            max_attempts=2,
        )
        if removal == "failed":
            logger.warning(
                "Mailchimp remove after contact delete failed (best effort)",
                extra={"lead_email": mask_email(mailchimp_email_for_delete)},
            )

    return json_response(204, {}, event=event)
