"""Query-filter parsers for admin services list endpoints."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.api.admin_party_related import parse_related_party_ids
from app.api.admin_request import parse_limit, query_param
from app.api.admin_services_cursor import (
    parse_created_cursor,
    parse_service_list_cursor,
)
from app.api.admin_services_payload_utils import (
    parse_optional_bool,
    parse_optional_enum,
    parse_optional_text,
    parse_optional_uuid,
)
from app.db.models import (
    EnrollmentStatus,
    InstanceStatus,
    ServiceStatus,
    ServiceType,
)
from app.exceptions import ValidationError
from app.utils.logging import get_logger

logger = get_logger(__name__)


def parse_service_filters(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse query filters for service list endpoint."""
    logger.debug("Parsing service list filters")
    limit = parse_limit(event)
    cursor_title, cursor_id = parse_service_list_cursor(query_param(event, "cursor"))
    return {
        "limit": limit,
        "cursor_title": cursor_title,
        "cursor_id": cursor_id,
        "service_type": parse_optional_enum(
            query_param(event, "service_type"),
            ServiceType,
            "service_type",
        ),
        "status": parse_optional_enum(
            query_param(event, "status"),
            ServiceStatus,
            "status",
        ),
        "search": parse_optional_text(query_param(event, "search")),
    }


def parse_instance_filters(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse query filters for service instance list endpoint."""
    logger.debug("Parsing service instance list filters")
    limit = parse_limit(event)
    cursor_created_at, cursor_id = parse_created_cursor(query_param(event, "cursor"))
    return {
        "limit": limit,
        "cursor_created_at": cursor_created_at,
        "cursor_id": cursor_id,
        "status": parse_optional_enum(
            query_param(event, "status"),
            InstanceStatus,
            "status",
        ),
    }


def parse_global_instance_list_filters(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse query filters for cross-service instance list endpoint."""
    logger.debug("Parsing global service instance list filters")
    limit = parse_limit(event)
    cursor_created_at, cursor_id = parse_created_cursor(query_param(event, "cursor"))
    contact_id, family_id, organization_id = parse_related_party_ids(event)
    return {
        "limit": limit,
        "cursor_created_at": cursor_created_at,
        "cursor_id": cursor_id,
        "status": parse_optional_enum(
            query_param(event, "status"),
            InstanceStatus,
            "status",
        ),
        "service_id": parse_optional_uuid(
            query_param(event, "service_id"), "service_id"
        ),
        "service_type": parse_optional_enum(
            query_param(event, "service_type"),
            ServiceType,
            "service_type",
        ),
        "contact_id": contact_id,
        "family_id": family_id,
        "organization_id": organization_id,
    }


def parse_enrollment_filters(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse query filters for enrollment list endpoint."""
    logger.debug("Parsing enrollment list filters")
    limit = parse_limit(event)
    cursor_created_at, cursor_id = parse_created_cursor(query_param(event, "cursor"))
    return {
        "limit": limit,
        "cursor_created_at": cursor_created_at,
        "cursor_id": cursor_id,
        "status": parse_optional_enum(
            query_param(event, "status"),
            EnrollmentStatus,
            "status",
        ),
    }


def parse_discount_code_filters(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse query filters for discount-code list endpoint."""
    logger.debug("Parsing discount code list filters")
    limit = parse_limit(event)
    cursor_created_at, cursor_id = parse_created_cursor(query_param(event, "cursor"))
    scope_raw = parse_optional_text(query_param(event, "scope"), max_length=20)
    scope = (scope_raw or "").strip().lower()
    if scope not in {"", "all", "unscoped", "service", "instance"}:
        raise ValidationError(
            "scope must be one of: all, unscoped, service, instance",
            field="scope",
        )
    if scope in {"", "all"}:
        scope_norm: str | None = None
    elif scope == "unscoped":
        scope_norm = "unscoped"
    else:
        scope_norm = scope
    return {
        "limit": limit,
        "cursor_created_at": cursor_created_at,
        "cursor_id": cursor_id,
        "active": parse_optional_bool(query_param(event, "active"), "active"),
        "service_id": parse_optional_uuid(
            query_param(event, "service_id"), "service_id"
        ),
        "instance_id": parse_optional_uuid(
            query_param(event, "instance_id"), "instance_id"
        ),
        "search": parse_optional_text(query_param(event, "search")),
        "scope": scope_norm,
    }
