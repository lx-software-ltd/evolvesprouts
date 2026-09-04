"""Token-authenticated public locations API.

``user`` tokens may GET only. ``admin`` tokens may create, patch, and geocode.
Payloads match the admin location contract. Delete is not exposed.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_locations import (
    create_location,
    geocode_location,
    list_locations,
    serialize_location,
    update_location,
)
from app.api.admin_request import parse_uuid, route_has_prefix, split_route_parts
from app.api.public.token_auth import require_api_token
from app.db.engine import get_engine
from app.db.repositories import LocationRepository
from app.exceptions import NotFoundError
from app.utils import json_response, method_not_allowed, not_found


def handle_public_locations_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/public/locations routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "public", "locations"):
        return not_found(event)

    require_api_token(event, method)

    if len(parts) == 3 and parts[2] == "geocode":
        if method == "POST":
            return geocode_location(event)
        return method_not_allowed(event)

    if len(parts) == 2:
        if method == "GET":
            return list_locations(event)
        if method == "POST":
            return create_location(event)
        return method_not_allowed(event)

    if len(parts) != 3:
        return not_found(event)

    location_id = parse_uuid(parts[2])
    if method == "GET":
        return _get_location(event, location_id=location_id)
    if method == "PATCH":
        return update_location(event, location_id, partial=True)
    return method_not_allowed(event)


def _get_location(event: Mapping[str, Any], *, location_id: UUID) -> dict[str, Any]:
    with Session(get_engine()) as session:
        location_repo = LocationRepository(session)
        location = location_repo.get_by_id(location_id)
        if location is None:
            raise NotFoundError("Location", str(location_id))
        partner_by_loc = (
            location_repo.active_partner_organization_id_label_pairs_by_location_ids(
                [location_id]
            )
        )
        return json_response(
            200,
            {
                "location": serialize_location(
                    location,
                    partner_organization_id_label_pairs=partner_by_loc.get(location_id),
                )
            },
            event=event,
        )
