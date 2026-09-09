"""Admin handler for POST /v1/admin/contacts/merge."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_contacts_related import related_flags_for_contacts
from app.api.admin_entities_helpers import request_id
from app.api.admin_entities_serializers import serialize_contact_summary
from app.api.admin_request import parse_body
from app.api.admin_services_payload_utils import parse_optional_uuid, parse_uuid_list
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.repositories import ContactRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.completion_certificate_common import (
    contact_ids_with_issued_certificates,
)
from app.services.contact_merge import merge_contacts
from app.services.mailchimp_sync import remove_contact_from_mailchimp
from app.utils import json_response
from app.utils.logging import get_logger, mask_email

logger = get_logger(__name__)


def parse_merge_contacts_payload(
    body: Mapping[str, Any],
) -> dict[str, UUID | list[UUID]]:
    raw_ids = body.get("contact_ids")
    if not isinstance(raw_ids, list) or len(raw_ids) < 2:
        raise ValidationError(
            "contact_ids must contain at least two ids", field="contact_ids"
        )
    contact_ids = parse_uuid_list(raw_ids, "contact_ids", reject_empty_members=True)
    if len(contact_ids) < 2:
        raise ValidationError(
            "contact_ids must contain at least two ids", field="contact_ids"
        )
    keeper_contact_id = parse_optional_uuid(
        body.get("keeper_contact_id"), "keeper_contact_id"
    )
    if keeper_contact_id is None:
        raise ValidationError(
            "keeper_contact_id is required", field="keeper_contact_id"
        )
    return {"contact_ids": contact_ids, "keeper_contact_id": keeper_contact_id}


def merge_contacts_payload_from(
    body: Mapping[str, Any],
) -> tuple[list[UUID], UUID]:
    payload = parse_merge_contacts_payload(body)
    contact_ids = payload["contact_ids"]
    keeper_contact_id = payload["keeper_contact_id"]
    if not isinstance(contact_ids, list) or not isinstance(keeper_contact_id, UUID):
        raise ValidationError("Invalid merge payload", field="body")
    return contact_ids, keeper_contact_id


def merge_contacts_request(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    body = parse_body(event)
    contact_ids, keeper_contact_id = merge_contacts_payload_from(body)

    mailchimp_archive_emails: list[str] = []
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        keeper, mailchimp_archive_emails = merge_contacts(
            session,
            contact_ids=contact_ids,
            keeper_contact_id=keeper_contact_id,
            actor_sub=actor_sub,
        )
        session.commit()
        repository = ContactRepository(session)
        contact = repository.get_by_id_for_admin(keeper.id)
        if contact is None:
            raise NotFoundError("Contact", str(keeper.id))
        note_counts = repository.count_standalone_notes_for_contacts([contact.id])
        cert_ids = contact_ids_with_issued_certificates(session, [contact.id])
        related_flags = related_flags_for_contacts(session, [contact.id])
        payload = {
            "contact": serialize_contact_summary(
                contact,
                standalone_note_count=note_counts.get(contact.id, 0),
                has_completion_certificate=contact.id in cert_ids,
                **related_flags[contact.id].as_serializer_kwargs(),
            )
        }

    for email in mailchimp_archive_emails:
        removal = remove_contact_from_mailchimp(
            email=email,
            logger=logger,
            max_attempts=2,
        )
        if removal == "failed":
            logger.warning(
                "Mailchimp remove after contact merge failed (best effort)",
                extra={"lead_email": mask_email(email)},
            )

    return json_response(200, payload, event=event)
