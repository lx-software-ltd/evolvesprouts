"""Admin geographic area API handlers."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import (
    parse_uuid,
    query_param,
    require_admin_identity,
    split_route_parts,
)
from app.db.engine import get_engine
from app.db.models import GeographicArea
from app.db.repositories import GeographicAreaRepository
from app.exceptions import ValidationError
from app.utils import json_response


def handle_admin_geographic_areas_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/geographic-areas routes."""
    parts = split_route_parts(path)
    if len(parts) != 2 or parts[0] != "admin" or parts[1] != "geographic-areas":
        return json_response(404, {"error": "Not found"}, event=event)

    require_admin_identity(event)

    if method != "GET":
        return json_response(405, {"error": "Method not allowed"}, event=event)

    return _list_geographic_areas(event)


def _list_geographic_areas(event: Mapping[str, Any]) -> dict[str, Any]:
    parent_id = _parse_optional_uuid(query_param(event, "parent_id"), "parent_id")
    flat = _parse_bool(query_param(event, "flat"), default=False)
    active_only = _parse_bool(query_param(event, "active_only"), default=True)
    if parent_id is not None and flat:
        raise ValidationError("flat cannot be true when parent_id is provided", "flat")

    with Session(get_engine()) as session:
        repository = GeographicAreaRepository(session)
        if parent_id is not None:
            items = repository.get_children(parent_id)
        elif flat:
            items = repository.get_all_flat(active_only=active_only)
        else:
            items = repository.get_all_roots(active_only=active_only)
        return json_response(
            200,
            {"items": [_serialize_geographic_area(item) for item in items]},
            event=event,
        )


def _serialize_geographic_area(area: GeographicArea) -> dict[str, Any]:
    return {
        "id": str(area.id),
        "parent_id": str(area.parent_id) if area.parent_id else None,
        "name": area.name,
        "name_translations": area.name_translations or {},
        "level": area.level,
        "code": area.code,
        "active": area.active,
        "display_order": area.display_order,
        "sovereign_country_id": str(area.sovereign_country_id)
        if area.sovereign_country_id
        else None,
    }


def _parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None or value == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes"}:
        return True
    if normalized in {"0", "false", "no"}:
        return False
    raise ValidationError("Value must be true or false")


def _parse_optional_uuid(value: str | None, field: str) -> UUID | None:
    if value is None or value.strip() == "":
        return None
    try:
        return parse_uuid(value.strip())
    except ValidationError as exc:
        raise ValidationError(exc.message, field=field) from exc
