"""Admin organisation member handlers (/v1/admin/organizations/{id}/members)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_entities_helpers import (
    assert_contact_can_join_organization,
    request_id,
)
from app.api.admin_entities_serializers import serialize_organization_summary
from app.api.admin_party_related import (
    organization_related_serializer_kwargs,
)
from app.api.admin_request import (
    parse_body,
    parse_uuid,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import (
    Contact,
    OrganizationMember,
)
from app.db.models.organization import organization_membership_role_from_contact_type
from app.db.repositories.organization import (
    OrganizationRepository,
)
from app.exceptions import DatabaseError, NotFoundError, ValidationError
from app.utils import json_response

_DEFAULT_LIMIT = 25


def add_organization_member(
    event: Mapping[str, Any],
    *,
    organization_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    contact_id = parse_uuid(str(body.get("contact_id")))
    is_primary = body.get("is_primary_contact")
    if is_primary is None:
        is_primary_contact = False
    elif isinstance(is_primary, bool):
        is_primary_contact = is_primary
    elif isinstance(is_primary, str) and is_primary.strip().lower() in {"true", "1"}:
        is_primary_contact = True
    elif isinstance(is_primary, str) and is_primary.strip().lower() in {"false", "0"}:
        is_primary_contact = False
    else:
        raise ValidationError(
            "is_primary_contact must be true or false",
            field="is_primary_contact",
        )

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = OrganizationRepository(session)
        org = repository.get_non_vendor_organization_by_id(organization_id)
        if org is None:
            raise NotFoundError("Organization", str(organization_id))
        contact = session.get(Contact, contact_id)
        if contact is None:
            raise ValidationError("contact_id not found", field="contact_id")
        assert_contact_can_join_organization(
            session, contact_id=contact_id, organization_id=organization_id
        )

        role = organization_membership_role_from_contact_type(contact.contact_type)
        member = OrganizationMember(
            organization_id=organization_id,
            contact_id=contact_id,
            role=role,
            is_primary_contact=is_primary_contact,
        )
        session.add(member)
        contact.location_id = None
        session.commit()
        loaded = repository.get_non_vendor_organization_by_id(organization_id)
        if loaded is None:
            raise DatabaseError("Failed to load organization after adding member")
        return json_response(
            201,
            {
                "organization": serialize_organization_summary(
                    loaded, **organization_related_serializer_kwargs(session, loaded.id)
                )
            },
            event=event,
        )


def update_organization_member(
    event: Mapping[str, Any],
    *,
    organization_id: UUID,
    member_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    if "is_primary_contact" not in body:
        raise ValidationError(
            "is_primary_contact is required",
            field="is_primary_contact",
        )
    is_primary = body.get("is_primary_contact")
    if isinstance(is_primary, bool):
        is_primary_contact = is_primary
    elif isinstance(is_primary, str) and is_primary.strip().lower() in {"true", "1"}:
        is_primary_contact = True
    elif isinstance(is_primary, str) and is_primary.strip().lower() in {"false", "0"}:
        is_primary_contact = False
    else:
        raise ValidationError(
            "is_primary_contact must be true or false",
            field="is_primary_contact",
        )

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = OrganizationRepository(session)
        org = repository.get_non_vendor_organization_by_id(organization_id)
        if org is None:
            raise NotFoundError("Organization", str(organization_id))
        member = session.get(OrganizationMember, member_id)
        if member is None or member.organization_id != organization_id:
            raise NotFoundError("OrganizationMember", str(member_id))

        if is_primary_contact:
            for m in org.organization_members:
                m.is_primary_contact = m.id == member_id
        else:
            member.is_primary_contact = False

        session.commit()
        loaded = repository.get_non_vendor_organization_by_id(organization_id)
        if loaded is None:
            raise DatabaseError("Failed to load organization after updating member")
        return json_response(
            200,
            {
                "organization": serialize_organization_summary(
                    loaded, **organization_related_serializer_kwargs(session, loaded.id)
                )
            },
            event=event,
        )


def remove_organization_member(
    event: Mapping[str, Any],
    *,
    organization_id: UUID,
    member_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = OrganizationRepository(session)
        org = repository.get_non_vendor_organization_by_id(organization_id)
        if org is None:
            raise NotFoundError("Organization", str(organization_id))
        member = session.get(OrganizationMember, member_id)
        if member is None or member.organization_id != organization_id:
            raise NotFoundError("OrganizationMember", str(member_id))
        session.delete(member)
        session.commit()
        loaded = repository.get_non_vendor_organization_by_id(organization_id)
        if loaded is None:
            raise DatabaseError("Failed to load organization after removing member")
        return json_response(
            200,
            {
                "organization": serialize_organization_summary(
                    loaded, **organization_related_serializer_kwargs(session, loaded.id)
                )
            },
            event=event,
        )
