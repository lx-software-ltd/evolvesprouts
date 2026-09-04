"""Token-authenticated public CRM families API.

``user`` tokens may GET only. ``admin`` tokens may create, update, delete,
and manage members. Payloads match the admin family contract. Services are
not exposed.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_entities_deletes import delete_admin_entity_family
from app.api.admin_entities_serializers import serialize_family_summary
from app.api.admin_families import (
    add_family_member,
    create_family,
    list_families,
    remove_family_member,
    update_family,
    update_family_member,
)
from app.api.admin_party_related import family_related_serializer_kwargs
from app.api.admin_request import parse_uuid, route_has_prefix, split_route_parts
from app.api.public.token_auth import require_api_token, token_actor_sub
from app.db.engine import get_engine
from app.db.repositories import FamilyRepository
from app.exceptions import NotFoundError
from app.utils import json_response, method_not_allowed, not_found


def handle_public_families_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/public/families routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "public", "families"):
        return not_found(event)

    token = require_api_token(event, method)
    actor_sub = token_actor_sub(token)

    if len(parts) == 2:
        if method == "GET":
            return list_families(event)
        if method == "POST":
            return create_family(event, actor_sub=actor_sub)
        return method_not_allowed(event)

    family_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return _get_family(event, family_id=family_id)
        if method == "PATCH":
            return update_family(event, family_id=family_id, actor_sub=actor_sub)
        if method == "DELETE":
            return delete_admin_entity_family(
                event, family_id=family_id, actor_sub=actor_sub
            )
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "members":
        if method == "POST":
            return add_family_member(event, family_id=family_id, actor_sub=actor_sub)
        return method_not_allowed(event)

    if len(parts) == 5 and parts[3] == "members":
        member_id = parse_uuid(parts[4])
        if method == "PATCH":
            return update_family_member(
                event,
                family_id=family_id,
                member_id=member_id,
                actor_sub=actor_sub,
            )
        if method == "DELETE":
            return remove_family_member(
                event,
                family_id=family_id,
                member_id=member_id,
                actor_sub=actor_sub,
            )
        return method_not_allowed(event)

    return not_found(event)


def _get_family(event: Mapping[str, Any], *, family_id: UUID) -> dict[str, Any]:
    with Session(get_engine()) as session:
        family = FamilyRepository(session).get_by_id_for_admin(family_id)
        if family is None:
            raise NotFoundError("Family", str(family_id))
        return json_response(
            200,
            {
                "family": serialize_family_summary(
                    family, **family_related_serializer_kwargs(session, family.id)
                )
            },
            event=event,
        )
