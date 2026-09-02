"""High-level payload parsers for admin services APIs."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from app.api.admin_discount_codes_payloads import (
    REFERRAL_DEFAULT_CURRENCY,
    REFERRAL_DEFAULT_DISCOUNT_VALUE,
    ensure_discount_validity_window,
    parse_create_discount_code_payload,
    parse_update_discount_code_payload,
)
from app.api.admin_enrollments_payloads import (
    parse_create_enrollment_payload,
    parse_update_enrollment_payload,
)
from app.api.admin_instances_payloads import (
    parse_create_instance_payload,
    parse_update_instance_payload,
)
from app.api.admin_services_list_filters import (
    parse_discount_code_filters,
    parse_enrollment_filters,
    parse_global_instance_list_filters,
    parse_instance_filters,
    parse_service_filters,
)
from app.api.admin_validators import (
    MAX_DESCRIPTION_LENGTH,
    parse_optional_service_instance_slug_like_text,
)
from app.api.admin_services_payload_utils import (
    has_any_field,
    has_field,
    parse_optional_enum,
    parse_optional_text,
    parse_optional_uuid,
    parse_required_enum,
    parse_required_text,
    parse_service_type_details,
    parse_uuid_list,
)
from app.db.models import ServiceDeliveryMode, ServiceStatus, ServiceType
from app.exceptions import ValidationError

_SERVICE_KEY_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_MAX_SERVICE_KEY_LENGTH = 80
_MAX_BOOKING_SYSTEM_LENGTH = 80


def parse_optional_service_tier(
    value: object, *, field: str = "service_tier"
) -> str | None:
    """Parse optional service tier slug; same rules as instance cohort-style labels."""
    return parse_optional_service_instance_slug_like_text(value, field=field)


def parse_optional_service_key(value: Any, field: str) -> str | None:
    """Parse optional referral service key: strip, lower, validate pattern; empty -> None."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string", field=field)
    trimmed = value.strip().lower()
    if not trimmed:
        return None
    if len(trimmed) > _MAX_SERVICE_KEY_LENGTH:
        raise ValidationError(
            f"{field} must be at most {_MAX_SERVICE_KEY_LENGTH} characters",
            field=field,
        )
    if not _SERVICE_KEY_PATTERN.fullmatch(trimmed):
        raise ValidationError(
            f"{field} must use lowercase letters, numbers, and single hyphens between segments",
            field=field,
        )
    return trimmed


def parse_optional_booking_system(value: Any, field: str) -> str | None:
    """Parse optional booking system label; strip; empty -> None."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string", field=field)
    trimmed = value.strip()
    if not trimmed:
        return None
    if len(trimmed) > _MAX_BOOKING_SYSTEM_LENGTH:
        raise ValidationError(
            f"{field} must be at most {_MAX_BOOKING_SYSTEM_LENGTH} characters",
            field=field,
        )
    return trimmed


def parse_create_service_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """Parse and validate service creation payload."""
    service_type = parse_required_enum(
        body.get("service_type"), ServiceType, "service_type"
    )
    return {
        "service_type": service_type,
        "title": parse_required_text(body.get("title"), "title", max_length=255),
        "service_key": parse_optional_service_key(
            body.get("service_key"), "service_key"
        ),
        "booking_system": parse_optional_booking_system(
            body.get("booking_system"), "booking_system"
        ),
        "description": parse_optional_text(
            body.get("description"), max_length=MAX_DESCRIPTION_LENGTH
        ),
        "cover_image_s3_key": parse_optional_text(
            body.get("cover_image_s3_key"), max_length=1024
        ),
        "delivery_mode": parse_required_enum(
            body.get("delivery_mode"),
            ServiceDeliveryMode,
            "delivery_mode",
        ),
        "status": parse_optional_enum(body.get("status"), ServiceStatus, "status")
        or ServiceStatus.DRAFT,
        "service_tier": parse_optional_service_tier(body.get("service_tier")),
        "location_id": parse_optional_uuid(body.get("location_id"), "location_id"),
        "tag_ids": parse_uuid_list(body.get("tag_ids"), "tag_ids"),
        "asset_ids": parse_uuid_list(body.get("asset_ids"), "asset_ids"),
        "type_details": parse_service_type_details(service_type, body),
    }


def parse_update_service_payload(
    body: Mapping[str, Any],
    *,
    partial: bool,
) -> dict[str, Any]:
    """Parse and validate service update payload."""
    if not body:
        raise ValidationError("At least one field is required", field="body")

    payload: dict[str, Any] = {}
    if has_field(body, "title"):
        payload["title"] = parse_required_text(
            body.get("title"), "title", max_length=255
        )
    if has_field(body, "service_key"):
        payload["service_key"] = parse_optional_service_key(
            body.get("service_key"), "service_key"
        )
    if has_field(body, "booking_system"):
        payload["booking_system"] = parse_optional_booking_system(
            body.get("booking_system"), "booking_system"
        )
    if has_field(body, "description"):
        payload["description"] = parse_optional_text(
            body.get("description"), max_length=MAX_DESCRIPTION_LENGTH
        )
    if has_field(body, "cover_image_s3_key"):
        payload["cover_image_s3_key"] = parse_optional_text(
            body.get("cover_image_s3_key"), max_length=1024
        )
    if has_field(body, "delivery_mode"):
        payload["delivery_mode"] = parse_required_enum(
            body.get("delivery_mode"),
            ServiceDeliveryMode,
            "delivery_mode",
        )
    if has_field(body, "status"):
        payload["status"] = parse_required_enum(
            body.get("status"),
            ServiceStatus,
            "status",
        )
    if has_field(body, "service_tier"):
        payload["service_tier"] = parse_optional_service_tier(body.get("service_tier"))
    if has_field(body, "location_id"):
        payload["location_id"] = parse_optional_uuid(
            body.get("location_id"), "location_id"
        )
    if has_field(body, "tag_ids"):
        payload["tag_ids"] = parse_uuid_list(body.get("tag_ids"), "tag_ids")
    if has_field(body, "asset_ids"):
        payload["asset_ids"] = parse_uuid_list(body.get("asset_ids"), "asset_ids")
    if has_any_field(
        body,
        "training_details",
        "event_details",
        "consultation_details",
        "pricing_unit",
        "event_category",
        "default_price",
        "default_currency",
        "consultation_format",
        "pricing_model",
    ):
        payload["type_details"] = body

    if not partial:
        required = {"title", "delivery_mode"}
        missing = [field for field in required if field not in payload]
        if missing:
            raise ValidationError(
                f"Missing required fields for PUT: {', '.join(sorted(missing))}",
                field="body",
            )

    if not payload:
        raise ValidationError("At least one updatable field is required", field="body")
    return payload


__all__ = [
    "REFERRAL_DEFAULT_CURRENCY",
    "REFERRAL_DEFAULT_DISCOUNT_VALUE",
    "ensure_discount_validity_window",
    "parse_create_discount_code_payload",
    "parse_create_enrollment_payload",
    "parse_create_instance_payload",
    "parse_create_service_payload",
    "parse_discount_code_filters",
    "parse_enrollment_filters",
    "parse_global_instance_list_filters",
    "parse_instance_filters",
    "parse_optional_booking_system",
    "parse_optional_service_key",
    "parse_optional_service_tier",
    "parse_service_filters",
    "parse_update_discount_code_payload",
    "parse_update_enrollment_payload",
    "parse_update_instance_payload",
    "parse_update_service_payload",
]
