"""Admin organizations API (CRM and vendor rows)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin_entities_deletes import delete_admin_entity_organization
from app.api.admin_entity_services import list_organization_services
from app.api.admin_entities_helpers import (
    ORGANIZATION_RELATIONSHIP_TYPES,
    request_id,
    ensure_location_exists,
    parse_active_filter,
    parse_limit,
    parse_relationship_type,
    parse_optional_bool_body,
    replace_organization_tags,
)
from app.api.admin_entities_serializers import serialize_organization_summary
from app.api.admin_party_related import (
    organization_related_serializer_kwargs,
    related_flags_for_organizations,
)
from app.api.admin_request import (
    encode_cursor,
    parse_body,
    parse_cursor,
    parse_uuid,
    query_param,
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)
from app.api.admin_services_payload_utils import parse_optional_uuid, parse_uuid_list
from app.api.admin_validators import (
    parse_optional_partner_key,
    validate_string_length,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import (
    Organization,
    OrganizationType,
    RelationshipType,
)
from app.db.repositories.organization import (
    OrganizationListOrder,
    OrganizationRepository,
)
from app.exceptions import DatabaseError, NotFoundError, ValidationError
from app.utils import json_response, method_not_allowed, not_found
from app.utils.logging import get_logger
from app.api.admin_organizations_members import (
    add_organization_member,
    remove_organization_member,
    update_organization_member,
)

logger = get_logger(__name__)


def handle_admin_organizations_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/organizations routes."""
    logger.info(
        "Handling admin organizations route",
        extra={"method": method, "path": path},
    )
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "admin", "organizations"):
        return not_found(event)

    identity = require_admin_identity(event)

    if len(parts) == 2:
        if method == "GET":
            return _list_organizations(event)
        if method == "POST":
            return _create_organization(event, actor_sub=identity.user_sub)
        return method_not_allowed(event)

    organization_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return _get_organization(event, organization_id=organization_id)
        if method == "PATCH":
            return _update_organization(
                event, organization_id=organization_id, actor_sub=identity.user_sub
            )
        if method == "DELETE":
            return delete_admin_entity_organization(
                event,
                organization_id=organization_id,
                actor_sub=identity.user_sub,
            )
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "services":
        if method == "GET":
            return list_organization_services(event, organization_id=organization_id)
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "members":
        if method == "POST":
            return add_organization_member(
                event, organization_id=organization_id, actor_sub=identity.user_sub
            )
        return method_not_allowed(event)

    if len(parts) == 5 and parts[3] == "members":
        member_id = parse_uuid(parts[4])
        if method == "PATCH":
            return update_organization_member(
                event,
                organization_id=organization_id,
                member_id=member_id,
                actor_sub=identity.user_sub,
            )
        if method == "DELETE":
            return remove_organization_member(
                event,
                organization_id=organization_id,
                member_id=member_id,
                actor_sub=identity.user_sub,
            )
        return method_not_allowed(event)

    return not_found(event)


def _parse_organization_type(value: Any, *, field: str) -> OrganizationType:
    if value is None or str(value).strip() == "":
        raise ValidationError(f"{field} is required", field=field)
    try:
        return OrganizationType(str(value).strip().lower())
    except ValueError as exc:
        raise ValidationError(f"Invalid {field}", field=field) from exc


def _apply_organization_partner_key_from_body(
    org: Organization,
    body: Mapping[str, Any],
    *,
    relationship_type: RelationshipType | None = None,
) -> None:
    """Set partner_key from request body; only partner orgs may have a key."""
    if "partner_key" not in body:
        return
    partner_key = parse_optional_partner_key(body.get("partner_key"))
    effective = (
        relationship_type if relationship_type is not None else org.relationship_type
    )
    if effective != RelationshipType.PARTNER:
        if partner_key is not None:
            raise ValidationError(
                "partner_key is only allowed when relationship_type is partner",
                field="partner_key",
            )
        org.partner_key = None
        return
    org.partner_key = partner_key


def _apply_organization_legal_name_from_body(
    org: Organization,
    body: Mapping[str, Any],
    *,
    relationship_type: RelationshipType | None = None,
) -> None:
    """Set legal_name from request body; only partner orgs may have a legal name."""
    if "legal_name" not in body:
        return
    legal_name = validate_string_length(
        body.get("legal_name"),
        "legal_name",
        max_length=255,
        required=False,
    )
    effective = (
        relationship_type if relationship_type is not None else org.relationship_type
    )
    if effective != RelationshipType.PARTNER:
        if legal_name is not None:
            raise ValidationError(
                "legal_name is only allowed when relationship_type is partner",
                field="legal_name",
            )
        org.legal_name = None
        return
    org.legal_name = legal_name


def _parse_organization_list_order(raw: str | None) -> OrganizationListOrder:
    """Parse optional ``sort`` query for ``GET /v1/admin/organizations``."""
    if raw is None or str(raw).strip() == "":
        return "created_desc"
    normalized = str(raw).strip().lower()
    if normalized == "name":
        return "name_asc"
    raise ValidationError(
        "sort must be omitted or name",
        field="sort",
    )


def _parse_relationship_type_filter(
    raw: str | None,
) -> Sequence[RelationshipType] | None:
    """Parse optional relationship_type query.

    When absent, the repository applies the CRM default (excludes ``vendor`` and
    ``partner`` rows).
    When set, filters to that single relationship type (including ``vendor`` for Finance).
    """
    if raw is None or raw.strip() == "":
        return None
    try:
        return (RelationshipType(raw.strip().lower()),)
    except ValueError as exc:
        raise ValidationError(
            "relationship_type must be a valid relationship type",
            field="relationship_type",
        ) from exc


def _is_organizations_partner_key_unique_violation(exc: IntegrityError) -> bool:
    constraint = getattr(getattr(exc, "orig", None), "diag", None)
    constraint_name = (
        getattr(constraint, "constraint_name", None) if constraint else None
    )
    if constraint_name == "organizations_partner_key_unique_idx":
        return True
    message = str(exc).lower()
    return "organizations_partner_key_unique_idx" in message


def _list_organizations(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event)
    cursor = parse_cursor(query_param(event, "cursor"))
    query = validate_string_length(
        query_param(event, "query"),
        "query",
        max_length=255,
        required=False,
    )
    active = parse_active_filter(query_param(event, "active"))
    relationship_types = _parse_relationship_type_filter(
        query_param(event, "relationship_type")
    )
    list_order = _parse_organization_list_order(query_param(event, "sort"))
    include_relationships = not (
        relationship_types is not None
        and len(relationship_types) == 1
        and relationship_types[0] == RelationshipType.VENDOR
    )

    with Session(get_engine()) as session:
        repository = OrganizationRepository(session)
        rows = repository.list_organizations(
            limit=limit + 1,
            cursor=cursor,
            query=query,
            active=active,
            relationship_types=relationship_types,
            include_relationships=include_relationships,
            list_order=list_order,
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        next_cursor = (
            encode_cursor(page_rows[-1].id) if has_more and page_rows else None
        )
        total_count = repository.count_organizations(
            query=query,
            active=active,
            relationship_types=relationship_types,
        )
        flags_by_id = related_flags_for_organizations(
            session, [r.id for r in page_rows]
        )
        return json_response(
            200,
            {
                "items": [
                    serialize_organization_summary(
                        r, **flags_by_id[r.id].as_serializer_kwargs()
                    )
                    for r in page_rows
                ],
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _get_organization(
    event: Mapping[str, Any], *, organization_id: UUID
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        repository = OrganizationRepository(session)
        org = repository.get_non_vendor_organization_by_id(organization_id)
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


def _create_organization(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    body = parse_body(event)
    now = datetime.now(UTC)
    name = validate_string_length(
        body.get("name"),
        "name",
        max_length=255,
        required=True,
    )
    organization_type = _parse_organization_type(
        body.get("organization_type"), field="organization_type"
    )
    relationship_type = parse_relationship_type(
        body.get("relationship_type"),
        field="relationship_type",
        allowed=ORGANIZATION_RELATIONSHIP_TYPES,
    )
    website = validate_string_length(
        body.get("website"),
        "website",
        max_length=500,
        required=False,
    )
    location_id = parse_optional_uuid(body.get("location_id"), "location_id")
    tag_ids = parse_uuid_list(body.get("tag_ids"), "tag_ids")

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        ensure_location_exists(session, location_id)
        repository = OrganizationRepository(session)
        org = Organization(
            name=name or "",
            organization_type=organization_type,
            relationship_type=relationship_type,
            website=website,
            location_id=location_id,
        )
        if "active" in body:
            active = parse_optional_bool_body(body.get("active"), field="active")
            if active is None:
                raise ValidationError("active is required", field="active")
            org.archived_at = None if active else now
        _apply_organization_partner_key_from_body(
            org, body, relationship_type=relationship_type
        )
        _apply_organization_legal_name_from_body(
            org, body, relationship_type=relationship_type
        )
        created = repository.create(org)
        if tag_ids:
            replace_organization_tags(
                session, organization_id=created.id, tag_ids=tag_ids
            )
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            if _is_organizations_partner_key_unique_violation(exc):
                raise ValidationError(
                    "Partner key already in use",
                    field="partner_key",
                    status_code=409,
                ) from exc
            raise
        loader = (
            repository.get_organization_by_id
            if relationship_type == RelationshipType.VENDOR
            else repository.get_non_vendor_organization_by_id
        )
        loaded = loader(created.id)
        if loaded is None:
            raise DatabaseError("Failed to load organization after create")
        return json_response(
            201,
            {
                "organization": serialize_organization_summary(
                    loaded, **organization_related_serializer_kwargs(session, loaded.id)
                )
            },
            event=event,
        )


def _update_organization(
    event: Mapping[str, Any],
    *,
    organization_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    now = datetime.now(UTC)
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repository = OrganizationRepository(session)
        org = repository.get_non_vendor_organization_by_id(organization_id)
        if org is None:
            raise NotFoundError("Organization", str(organization_id))

        if "name" in body:
            org.name = (
                validate_string_length(
                    body.get("name"),
                    "name",
                    max_length=255,
                    required=True,
                )
                or org.name
            )
        if "organization_type" in body:
            org.organization_type = _parse_organization_type(
                body.get("organization_type"), field="organization_type"
            )
        if "relationship_type" in body:
            org.relationship_type = parse_relationship_type(
                body.get("relationship_type"),
                field="relationship_type",
                allowed=ORGANIZATION_RELATIONSHIP_TYPES,
            )
            if org.relationship_type != RelationshipType.PARTNER:
                org.partner_key = None
                org.legal_name = None
        if "website" in body:
            org.website = validate_string_length(
                body.get("website"),
                "website",
                max_length=500,
                required=False,
            )
        if "location_id" in body:
            loc = parse_optional_uuid(body.get("location_id"), "location_id")
            ensure_location_exists(session, loc)
            org.location_id = loc
        if "active" in body:
            active = parse_optional_bool_body(body.get("active"), field="active")
            if active is None:
                raise ValidationError("active is required", field="active")
            org.archived_at = None if active else now
        if "tag_ids" in body:
            tag_ids = parse_uuid_list(body.get("tag_ids"), "tag_ids")
            replace_organization_tags(session, organization_id=org.id, tag_ids=tag_ids)

        _apply_organization_partner_key_from_body(org, body)
        _apply_organization_legal_name_from_body(org, body)

        repository.update(org)
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            if _is_organizations_partner_key_unique_violation(exc):
                raise ValidationError(
                    "Partner key already in use",
                    field="partner_key",
                    status_code=409,
                ) from exc
            raise
        loader = (
            repository.get_organization_by_id
            if org.relationship_type == RelationshipType.VENDOR
            else repository.get_non_vendor_organization_by_id
        )
        loaded = loader(organization_id)
        if loaded is None:
            raise DatabaseError("Failed to load organization after update")
        return json_response(
            200,
            {
                "organization": serialize_organization_summary(
                    loaded, **organization_related_serializer_kwargs(session, loaded.id)
                )
            },
            event=event,
        )
