"""Admin location API handlers."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import (
    encode_cursor,
    extract_identity,
    parse_body,
    parse_cursor,
    parse_limit,
    parse_uuid,
    query_param,
    request_id,
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)
from app.api.admin_validators import (
    MAX_ADDRESS_LENGTH,
    MAX_NAME_LENGTH,
    validate_string_length,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import Location
from app.db.repositories import GeographicAreaRepository, LocationRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.nominatim_geocode import geocode_address_with_context
from app.utils import json_response, method_not_allowed, not_found


def handle_admin_locations_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/locations routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "admin", "locations"):
        return not_found(event)

    require_admin_identity(event)

    if len(parts) == 3 and parts[2] == "geocode":
        if method == "POST":
            return _geocode_location(event)
        return method_not_allowed(event)

    if len(parts) == 2:
        if method == "GET":
            return _list_locations(event)
        if method == "POST":
            return _create_location(event)
        return method_not_allowed(event)

    location_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "PUT":
            return _update_location(event, location_id, partial=False)
        if method == "PATCH":
            return _update_location(event, location_id, partial=True)
        if method == "DELETE":
            return _delete_location(event, location_id)
        return method_not_allowed(event)

    return not_found(event)


def _geocode_location(event: Mapping[str, Any]) -> dict[str, Any]:
    body = parse_body(event)
    address = cast(
        str,
        _parse_address(body.get("address"), required=True),
    )

    area_id_raw = body.get("area_id")
    if area_id_raw is None:
        raise ValidationError("area_id is required", field="area_id")
    area_id = parse_uuid(str(area_id_raw))

    with Session(get_engine()) as session:
        geo_repo = GeographicAreaRepository(session)
        area = geo_repo.get_by_id(area_id)
        if area is None:
            raise ValidationError("area_id not found", field="area_id")

        ancestors = geo_repo.get_ancestors(area_id)
        country_iso_codes: list[str] = []
        root = ancestors[0] if ancestors else None
        if root and root.code:
            country_iso_codes.append(str(root.code))
        if root is not None:
            sovereign_code = geo_repo.get_sovereign_country_iso_code(
                cast(UUID, root.id),
            )
            if sovereign_code:
                country_iso_codes.append(str(sovereign_code))

    lat, lng, display_name = geocode_address_with_context(
        address=address,
        country_iso_codes=country_iso_codes,
    )
    payload: dict[str, Any] = {"lat": lat, "lng": lng}
    if display_name:
        payload["display_name"] = display_name
    return json_response(200, payload, event=event)


def _list_locations(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = _parse_limit(event)
    cursor = parse_cursor(query_param(event, "cursor"))
    area_id = _parse_optional_uuid(query_param(event, "area_id"), field="area_id")
    exclude_addresses = _parse_query_bool(
        query_param(event, "exclude_addresses"),
        field="exclude_addresses",
        default=False,
    )
    search_raw = query_param(event, "search")
    search: str | None = None
    if search_raw is not None and str(search_raw).strip() != "":
        search = validate_string_length(
            search_raw,
            "search",
            max_length=MAX_ADDRESS_LENGTH,
            required=False,
        )

    with Session(get_engine()) as session:
        location_repo = LocationRepository(session)
        total_count = location_repo.count_with_filters(
            area_id=area_id,
            search=search,
            exclude_addresses=exclude_addresses,
        )
        rows = list(
            location_repo.list_with_filters(
                limit=limit + 1,
                cursor=cursor,
                area_id=area_id,
                search=search,
                exclude_addresses=exclude_addresses,
            )
        )
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = encode_cursor(rows[-1].id) if has_more and rows else None
        partner_by_loc = (
            location_repo.active_partner_organization_id_label_pairs_by_location_ids(
                [cast(UUID, loc.id) for loc in rows]
            )
        )
        return json_response(
            200,
            {
                "items": [
                    _serialize_location(
                        location,
                        partner_organization_id_label_pairs=partner_by_loc.get(
                            cast(UUID, location.id)
                        ),
                    )
                    for location in rows
                ],
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _create_location(event: Mapping[str, Any]) -> dict[str, Any]:
    body = parse_body(event)
    identity = extract_identity(event)
    location_request_id = request_id(event)

    area_id_raw = body.get("area_id")
    if area_id_raw is None:
        raise ValidationError("area_id is required", field="area_id")
    area_id = parse_uuid(str(area_id_raw))
    name = _parse_name(body.get("name"), required=False)
    address = _parse_address(body.get("address"), required=False)
    lat = _parse_optional_float(body.get("lat"), field="lat")
    lng = _parse_optional_float(body.get("lng"), field="lng")
    _validate_coordinates(lat=lat, lng=lng)

    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=identity.user_sub or "",
            request_id=location_request_id,
        )
        geo_repo = GeographicAreaRepository(session)
        if geo_repo.get_by_id(area_id) is None:
            raise ValidationError("area_id not found", field="area_id")

        location_repo = LocationRepository(session)
        location = Location(
            area_id=area_id,
            name=name,
            address=address,
            lat=lat,
            lng=lng,
        )
        location = location_repo.create(location)
        session.commit()
        partner_by_loc = (
            location_repo.active_partner_organization_id_label_pairs_by_location_ids(
                [cast(UUID, location.id)]
            )
        )
        return json_response(
            201,
            {
                "location": _serialize_location(
                    location,
                    partner_organization_id_label_pairs=partner_by_loc.get(
                        cast(UUID, location.id)
                    ),
                )
            },
            event=event,
        )


def _update_location(
    event: Mapping[str, Any],
    location_id: UUID,
    *,
    partial: bool,
) -> dict[str, Any]:
    body = parse_body(event)
    identity = extract_identity(event)
    location_request_id = request_id(event)

    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=identity.user_sub or "",
            request_id=location_request_id,
        )
        geo_repo = GeographicAreaRepository(session)
        location_repo = LocationRepository(session)
        location = location_repo.get_by_id(location_id)
        if location is None:
            raise NotFoundError("Location", str(location_id))

        partner_pairs = (
            location_repo.active_partner_organization_id_label_pairs_by_location_ids(
                [location_id]
            ).get(location_id)
        )
        partner_names = [label for _oid, label in (partner_pairs or [])]
        if partner_names and "name" in body:
            parsed_name = _parse_name(body.get("name"), required=False)
            current_norm = (location.name or "").strip()
            incoming_norm = (parsed_name or "").strip()
            if incoming_norm != current_norm:
                raise ValidationError(
                    "Location name is managed from the partner organisation record",
                    field="name",
                )

        if not partial:
            if "area_id" not in body:
                raise ValidationError("area_id is required", field="area_id")

        if "area_id" in body:
            area_id = parse_uuid(str(body["area_id"]))
            if geo_repo.get_by_id(area_id) is None:
                raise ValidationError("area_id not found", field="area_id")
            location.area_id = area_id  # type: ignore[assignment]

        if "name" in body:
            location.name = _parse_name(body.get("name"), required=False)

        if "address" in body:
            location.address = _parse_address(body.get("address"), required=False)

        if "lat" in body:
            location.lat = _parse_optional_float(body.get("lat"), field="lat")  # type: ignore[assignment]
        if "lng" in body:
            location.lng = _parse_optional_float(body.get("lng"), field="lng")  # type: ignore[assignment]
        _validate_coordinates(lat=location.lat, lng=location.lng)

        location = location_repo.update(location)
        session.commit()
        partner_by_loc = (
            location_repo.active_partner_organization_id_label_pairs_by_location_ids(
                [location_id]
            )
        )
        return json_response(
            200,
            {
                "location": _serialize_location(
                    location,
                    partner_organization_id_label_pairs=partner_by_loc.get(location_id),
                )
            },
            event=event,
        )


def _delete_location(event: Mapping[str, Any], location_id: UUID) -> dict[str, Any]:
    identity = extract_identity(event)
    location_request_id = request_id(event)

    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=identity.user_sub or "",
            request_id=location_request_id,
        )
        location_repo = LocationRepository(session)
        location = location_repo.get_by_id(location_id)
        if location is None:
            raise NotFoundError("Location", str(location_id))
        partner_pairs = (
            location_repo.active_partner_organization_id_label_pairs_by_location_ids(
                [location_id]
            ).get(location_id)
        )
        partner_names = [label for _oid, label in (partner_pairs or [])]
        if partner_names:
            raise ValidationError(
                "Cannot delete a venue linked to a partner organisation",
                field="location_id",
                status_code=409,
            )
        location_repo.delete(location)
        session.commit()
        return json_response(204, {}, event=event)


def _optional_coordinate_json(value: Any) -> float | None:
    """Return a JSON number for API responses (OpenAPI: double), or None."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    raise TypeError(f"coordinate must be numeric or None, got {type(value).__name__}")


def _serialize_location(
    location: Location,
    *,
    partner_organization_id_label_pairs: list[tuple[UUID, str]] | None = None,
) -> dict[str, Any]:
    pairs = partner_organization_id_label_pairs or []
    names = [label for _org_id, label in pairs]
    org_ids = [str(org_id) for org_id, _label in pairs]
    locked = bool(names)
    return {
        "id": str(location.id),
        "name": location.name,
        "area_id": str(location.area_id),
        "address": location.address,
        "lat": _optional_coordinate_json(location.lat),
        "lng": _optional_coordinate_json(location.lng),
        "created_at": location.created_at,
        "updated_at": location.updated_at,
        "locked_from_partner_org": locked,
        "partner_organization_labels": names,
        "partner_organization_ids": org_ids,
    }


def _parse_query_bool(
    raw_value: str | None,
    *,
    field: str,
    default: bool,
) -> bool:
    if raw_value is None or str(raw_value).strip() == "":
        return default
    normalized = str(raw_value).strip().lower()
    if normalized in {"true", "1", "yes"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    raise ValidationError(f"{field} must be true or false", field=field)


def _parse_limit(event: Mapping[str, Any]) -> int:
    return parse_limit(event)


def _parse_optional_uuid(value: str | None, *, field: str) -> UUID | None:
    if value is None or value.strip() == "":
        return None
    try:
        return parse_uuid(value.strip())
    except ValidationError as exc:
        raise ValidationError(exc.message, field=field) from exc


def _parse_name(value: Any, *, required: bool) -> str | None:
    return validate_string_length(
        value,
        "name",
        max_length=MAX_NAME_LENGTH,
        required=required,
    )


def _parse_address(value: Any, *, required: bool) -> str | None:
    validated = validate_string_length(
        value,
        "address",
        max_length=MAX_ADDRESS_LENGTH,
        required=required,
    )
    return validated


def _parse_optional_float(value: Any, *, field: str) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be a valid number", field=field) from exc


def _validate_coordinates(*, lat: Any, lng: Any) -> None:
    if lat is not None and (lat < -90 or lat > 90):
        raise ValidationError("lat must be between -90 and 90", field="lat")
    if lng is not None and (lng < -180 or lng > 180):
        raise ValidationError("lng must be between -180 and 180", field="lng")
