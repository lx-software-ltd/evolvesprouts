"""Mutation handlers for admin CRM contacts API."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal, overload
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin_contacts_helpers import (
    apply_referral_contact_metadata,
    contact_has_family_or_org_membership,
    parse_contact_source,
    parse_contact_type,
    parse_optional_date,
    parse_referral_contact_id_from_metadata,
    refresh_family_member_roles_for_contact,
    refresh_organization_member_roles_for_contact,
    sync_memberships_from_body,
    validate_referrer_contact,
)
from app.api.admin_contacts_related import related_flags_for_contacts
from app.api.admin_entities_helpers import (
    request_id,
    ensure_location_exists,
    parse_relationship_type,
    parse_optional_bool_body,
    replace_contact_tags,
)
from app.api.admin_entities_serializers import serialize_contact_summary
from app.api.admin_request import parse_body
from app.api.admin_services_payload_utils import parse_optional_uuid, parse_uuid_list
from app.api.admin_validators import (
    parse_optional_instagram_handle,
    validate_email,
    validate_phone_fields,
    validate_string_length,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import Contact, ContactSource
from app.db.repositories import ContactRepository
from app.exceptions import DatabaseError, NotFoundError, ValidationError
from app.services.mailchimp_sync import remove_contact_from_mailchimp
from app.utils import json_response
from app.utils.logging import get_logger, mask_email
from app.api.admin_contacts_delete import (
    MAILCHIMP_PUSH_REMOVE_STATUSES,
)

logger = get_logger(__name__)


def _phone_fields_in_body(body: Mapping[str, Any]) -> bool:
    return "phone_region" in body or "phone_number" in body


@overload
def _parse_contact_phone_pair(
    body: Mapping[str, Any], *, allow_absent: Literal[True]
) -> tuple[str | None, str | None] | None: ...


@overload
def _parse_contact_phone_pair(
    body: Mapping[str, Any], *, allow_absent: Literal[False]
) -> tuple[str | None, str | None]: ...


def _parse_contact_phone_pair(
    body: Mapping[str, Any], *, allow_absent: bool
) -> tuple[str | None, str | None] | None:
    """Return (region, national) or None when ``allow_absent`` and keys omitted."""
    region_raw = body.get("phone_region")
    number_raw = body.get("phone_number")
    if allow_absent and not _phone_fields_in_body(body):
        return None
    if region_raw is None and number_raw is None:
        return None, None
    if region_raw is None or number_raw is None:
        raise ValidationError(
            "phone_region and phone_number must both be provided or both omitted",
            field="phone_number",
        )
    return validate_phone_fields(region_raw, number_raw)


def create_contact(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
) -> dict[str, Any]:
    """Create a CRM contact from request payload."""
    body = parse_body(event)
    first_name = validate_string_length(
        body.get("first_name"),
        "first_name",
        max_length=100,
        required=True,
    )
    last_name = validate_string_length(
        body.get("last_name"),
        "last_name",
        max_length=100,
        required=False,
    )
    email = validate_email(body.get("email"))
    instagram_handle = parse_optional_instagram_handle(body.get("instagram_handle"))
    phone_pair = _parse_contact_phone_pair(body, allow_absent=True)
    phone_region: str | None = None
    phone_national: str | None = None
    if phone_pair is not None:
        phone_region, phone_national = phone_pair
    contact_type = parse_contact_type(body.get("contact_type"), field="contact_type")
    relationship_type = parse_relationship_type(
        body.get("relationship_type"), field="relationship_type"
    )
    source = parse_contact_source(body.get("source"), field="source")
    source_detail = validate_string_length(
        body.get("source_detail"),
        "source_detail",
        max_length=5000,
        required=False,
    )
    date_of_birth = parse_optional_date(
        body.get("date_of_birth"), field="date_of_birth"
    )
    location_id = parse_optional_uuid(body.get("location_id"), "location_id")
    tag_ids = parse_uuid_list(body.get("tag_ids"), "tag_ids")
    family_ids = parse_uuid_list(body.get("family_ids"), "family_ids")
    organization_ids = parse_uuid_list(body.get("organization_ids"), "organization_ids")
    referral_contact_id: UUID | None = None
    referral_contact_in_body = "referral_contact_id" in body
    if referral_contact_in_body:
        referral_contact_id = parse_optional_uuid(
            body.get("referral_contact_id"), "referral_contact_id"
        )

    logger.info(
        "Creating admin CRM contact",
        extra={"actor_sub": actor_sub, "source": source.value},
    )

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        has_membership = bool(family_ids or organization_ids)
        if location_id is not None and has_membership:
            raise ValidationError(
                "location_id must be empty when the contact is linked to a family or organisation",
                field="location_id",
            )
        ensure_location_exists(session, location_id)
        if source == ContactSource.REFERRAL:
            if not referral_contact_in_body or referral_contact_id is None:
                raise ValidationError(
                    "referral_contact_id is required when source is referral",
                    field="referral_contact_id",
                )
            validate_referrer_contact(
                session,
                referrer_id=referral_contact_id,
                subject_contact_id=None,
            )

        repository = ContactRepository(session)
        contact = Contact(
            email=email,
            instagram_handle=instagram_handle,
            first_name=first_name or "",
            last_name=last_name,
            phone_region=phone_region,
            phone_national_number=phone_national,
            contact_type=contact_type,
            relationship_type=relationship_type,
            date_of_birth=date_of_birth,
            location_id=location_id,
            source=source,
            source_detail=source_detail,
        )
        if source == ContactSource.REFERRAL and referral_contact_id is not None:
            apply_referral_contact_metadata(
                contact,
                referral_contact_id=referral_contact_id,
                source_is_referral=True,
            )
        try:
            created = repository.create(contact)
            if tag_ids:
                replace_contact_tags(session, contact_id=created.id, tag_ids=tag_ids)
            if family_ids or organization_ids:
                sync_memberships_from_body(
                    session,
                    contact_id=created.id,
                    family_ids=family_ids,
                    organization_ids=organization_ids,
                )
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise ValidationError(
                "Email or Instagram handle is already in use",
                field="email",
            ) from exc
        session.refresh(created)
        loaded = repository.get_by_id_for_admin(created.id)
        if loaded is None:
            raise DatabaseError("Failed to load contact after create")
        note_counts = repository.count_standalone_notes_for_contacts([loaded.id])
        related_flags = related_flags_for_contacts(session, [loaded.id])
        return json_response(
            201,
            {
                "contact": serialize_contact_summary(
                    loaded,
                    standalone_note_count=note_counts.get(loaded.id, 0),
                    **related_flags[loaded.id].as_serializer_kwargs(),
                )
            },
            event=event,
        )


def update_contact(
    event: Mapping[str, Any],
    *,
    contact_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    """Patch one CRM contact from request payload."""
    body = parse_body(event)
    now = datetime.now(UTC)
    referral_in_body = "referral_contact_id" in body
    referral_id_value = (
        parse_optional_uuid(body.get("referral_contact_id"), "referral_contact_id")
        if referral_in_body
        else None
    )
    sync_memberships = "family_ids" in body or "organization_ids" in body

    logger.info(
        "Updating admin CRM contact",
        extra={"contact_id": str(contact_id), "actor_sub": actor_sub},
    )

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = ContactRepository(session)
        contact = repository.get_by_id_for_admin(contact_id)
        if contact is None:
            raise NotFoundError("Contact", str(contact_id))

        mailchimp_email_for_archive: str | None = None

        if "first_name" in body:
            contact.first_name = (
                validate_string_length(
                    body.get("first_name"),
                    "first_name",
                    max_length=100,
                    required=True,
                )
                or contact.first_name
            )
        if "last_name" in body:
            contact.last_name = validate_string_length(
                body.get("last_name"),
                "last_name",
                max_length=100,
                required=False,
            )
        if "email" in body:
            contact.email = validate_email(body.get("email"))
        if "instagram_handle" in body:
            contact.instagram_handle = parse_optional_instagram_handle(
                body.get("instagram_handle")
            )
        if _phone_fields_in_body(body):
            pair = _parse_contact_phone_pair(body, allow_absent=False)
            contact.phone_region, contact.phone_national_number = pair
        if "contact_type" in body:
            contact.contact_type = parse_contact_type(
                body.get("contact_type"), field="contact_type"
            )
            refresh_family_member_roles_for_contact(session, contact_id=contact.id)
            refresh_organization_member_roles_for_contact(
                session, contact_id=contact.id
            )
        if "relationship_type" in body:
            contact.relationship_type = parse_relationship_type(
                body.get("relationship_type"),
                field="relationship_type",
            )
        if "source" in body:
            contact.source = parse_contact_source(body.get("source"), field="source")
        if "source_detail" in body:
            contact.source_detail = validate_string_length(
                body.get("source_detail"),
                "source_detail",
                max_length=5000,
                required=False,
            )

        effective_source = contact.source
        if effective_source == ContactSource.REFERRAL:
            ref_uuid = _resolve_referral_contact_id_for_referral_source(
                contact=contact,
                referral_in_body=referral_in_body,
                referral_id_value=referral_id_value,
            )
            validate_referrer_contact(
                session,
                referrer_id=ref_uuid,
                subject_contact_id=contact.id,
            )
            apply_referral_contact_metadata(
                contact,
                referral_contact_id=ref_uuid,
                source_is_referral=True,
            )
        else:
            if referral_in_body and referral_id_value is not None:
                raise ValidationError(
                    "referral_contact_id is only allowed when source is referral",
                    field="referral_contact_id",
                )
            apply_referral_contact_metadata(
                contact,
                referral_contact_id=None,
                source_is_referral=False,
            )

        if "date_of_birth" in body:
            contact.date_of_birth = parse_optional_date(
                body.get("date_of_birth"), field="date_of_birth"
            )

        if sync_memberships:
            family_ids = (
                parse_uuid_list(body.get("family_ids"), "family_ids")
                if "family_ids" in body
                else [m.family_id for m in contact.family_members]
            )
            organization_ids = (
                parse_uuid_list(body.get("organization_ids"), "organization_ids")
                if "organization_ids" in body
                else [m.organization_id for m in contact.organization_members]
            )
            sync_memberships_from_body(
                session,
                contact_id=contact.id,
                family_ids=family_ids,
                organization_ids=organization_ids,
            )

        if "location_id" in body:
            loc = parse_optional_uuid(body.get("location_id"), "location_id")
            linked = contact_has_family_or_org_membership(session, contact.id)
            if linked and loc is not None:
                raise ValidationError(
                    "location_id cannot be set while the contact is linked to a family or organisation",
                    field="location_id",
                )
            ensure_location_exists(session, loc)
            contact.location_id = loc
        if "active" in body:
            active = parse_optional_bool_body(body.get("active"), field="active")
            if active is None:
                raise ValidationError("active is required", field="active")
            becoming_archived = (not active) and contact.archived_at is None
            if (
                becoming_archived
                and contact.email
                and contact.mailchimp_status in MAILCHIMP_PUSH_REMOVE_STATUSES
            ):
                mailchimp_email_for_archive = contact.email
            contact.archived_at = None if active else now
        if "tag_ids" in body:
            tag_ids = parse_uuid_list(body.get("tag_ids"), "tag_ids")
            replace_contact_tags(session, contact_id=contact.id, tag_ids=tag_ids)

        try:
            updated = repository.update(contact)
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise ValidationError(
                "Email or Instagram handle is already in use",
                field="email",
            ) from exc
        session.refresh(updated)
        loaded = repository.get_by_id_for_admin(contact_id)
        if loaded is None:
            raise DatabaseError("Failed to load contact after update")
        note_counts = repository.count_standalone_notes_for_contacts([loaded.id])
        related_flags = related_flags_for_contacts(session, [loaded.id])
        payload = {
            "contact": serialize_contact_summary(
                loaded,
                standalone_note_count=note_counts.get(loaded.id, 0),
                **related_flags[loaded.id].as_serializer_kwargs(),
            )
        }

    # Avoid holding the DB session during Mailchimp retries (API Gateway ~30s limit).
    if mailchimp_email_for_archive:
        removal = remove_contact_from_mailchimp(
            email=mailchimp_email_for_archive,
            logger=logger,
            max_attempts=2,
        )
        if removal == "failed":
            logger.warning(
                "Mailchimp remove after contact archive failed (best effort)",
                extra={
                    "lead_email": mask_email(mailchimp_email_for_archive),
                },
            )

    return json_response(200, payload, event=event)


def _resolve_referral_contact_id_for_referral_source(
    *,
    contact: Contact,
    referral_in_body: bool,
    referral_id_value: UUID | None,
) -> UUID:
    if referral_in_body:
        if referral_id_value is None:
            raise ValidationError(
                "referral_contact_id is required when source is referral",
                field="referral_contact_id",
            )
        return referral_id_value

    parsed_meta = parse_referral_contact_id_from_metadata(contact)
    if parsed_meta is None:
        raise ValidationError(
            "referral_contact_id is required when source is referral",
            field="referral_contact_id",
        )
    return parsed_meta
