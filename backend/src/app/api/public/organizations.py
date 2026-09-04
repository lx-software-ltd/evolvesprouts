"""Token-authenticated public CRM organisations API.

``user`` tokens may GET only. ``admin`` tokens may create, update, delete,
and manage members. Payloads match the admin organisation contract. Services
are not exposed.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_entities_deletes import delete_admin_entity_organization
from app.api.admin_entities_serializers import serialize_organization_summary
from app.api.admin_organizations import (
    create_organization,
    list_organizations,
    update_organization,
)
from app.api.admin_organizations_members import (
    add_organization_member,
    remove_organization_member,
    update_organization_member,
)
from app.api.admin_party_related import organization_related_serializer_kwargs
from app.api.admin_request import parse_uuid, route_has_prefix, split_route_parts
from app.api.public.token_auth import require_api_token, token_actor_sub
from app.db.engine import get_engine
from app.db.repositories.organization import OrganizationRepository
from app.exceptions import NotFoundError
from app.utils import json_response, method_not_allowed, not_found


def handle_public_organizations_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/public/organizations routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "public", "organizations"):
        return not_found(event)

    token = require_api_token(event, method)
    actor_sub = token_actor_sub(token)

    if len(parts) == 2:
        if method == "GET":
            return list_organizations(event)
        if method == "POST":
            return create_organization(event, actor_sub=actor_sub)
        return method_not_allowed(event)

    organization_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return _get_organization(event, organization_id=organization_id)
        if method == "PATCH":
            return update_organization(
                event, organization_id=organization_id, actor_sub=actor_sub
            )
        if method == "DELETE":
            return delete_admin_entity_organization(
                event,
                organization_id=organization_id,
                actor_sub=actor_sub,
            )
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "members":
        if method == "POST":
            return add_organization_member(
                event, organization_id=organization_id, actor_sub=actor_sub
            )
        return method_not_allowed(event)

    if len(parts) == 5 and parts[3] == "members":
        member_id = parse_uuid(parts[4])
        if method == "PATCH":
            return update_organization_member(
                event,
                organization_id=organization_id,
                member_id=member_id,
                actor_sub=actor_sub,
            )
        if method == "DELETE":
            return remove_organization_member(
                event,
                organization_id=organization_id,
                member_id=member_id,
                actor_sub=actor_sub,
            )
        return method_not_allowed(event)

    return not_found(event)


def _get_organization(
    event: Mapping[str, Any], *, organization_id: UUID
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        org = OrganizationRepository(session).get_organization_by_id(organization_id)
        if org is None:
            raise NotFoundError("Organization", str(organization_id))
        return json_response(
            200,
            {
                "organization": serialize_organization_summary(
                    org, **organization_related_serializer_kwargs(session, org.id)
                )
            },
            event=event,
        )
