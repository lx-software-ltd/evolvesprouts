"""High-level payload parsers for admin services APIs."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.api.admin_party_related import parse_related_party_ids
from app.api.admin_request import parse_limit, query_param
from app.api.admin_validators import (
    MAX_DESCRIPTION_LENGTH,
    parse_optional_service_instance_slug,
    parse_optional_service_instance_slug_like_text,
    parse_required_service_instance_slug,
)
from app.api.admin_services_cursor import (
    parse_created_cursor,
    parse_service_list_cursor,
)
from app.api.admin_service_instance_partners import parse_partner_organization_ids
from app.api.admin_services_payload_utils import (
    has_any_field,
    has_field,
    parse_instance_type_details,
    reject_consultation_instance_pricing_payload,
    parse_optional_bool,
    parse_optional_currency,
    parse_optional_datetime,
    parse_optional_decimal,
    parse_optional_enum,
    parse_optional_int,
    parse_optional_external_url,
    parse_optional_text,
    parse_optional_uuid,
    parse_required_bool,
    parse_required_decimal,
    parse_required_non_negative_decimal,
    parse_required_enum,
    parse_required_text,
    parse_service_type_details,
    parse_session_slots,
    parse_uuid_list,
)
from app.db.models import (
    DiscountType,
    EnrollmentStatus,
    InstanceStatus,
    Service,
    ServiceDeliveryMode,
    ServiceStatus,
    ServiceType,
)
from app.exceptions import ValidationError
from app.utils.logging import get_logger

_MAX_CODE_LENGTH = 50
_SERVICE_KEY_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_MAX_SERVICE_KEY_LENGTH = 80
_MAX_BOOKING_SYSTEM_LENGTH = 80
logger = get_logger(__name__)

# Sibling defaults: admin_web `REFERRAL_DEFAULT_*` in `apps/admin_web/src/types/services.ts`.
REFERRAL_DEFAULT_DISCOUNT_VALUE = Decimal("0")
REFERRAL_DEFAULT_CURRENCY = "HKD"


def parse_optional_service_tier(
    value: object, *, field: str = "service_tier"
) -> str | None:
    """Parse optional service tier slug; same rules as instance cohort-style labels."""
    return parse_optional_service_instance_slug_like_text(value, field=field)


def _reject_deprecated_instance_age_group(body: Mapping[str, Any]) -> None:
    """Instance ``age_group`` was removed; tier lives on the parent service as ``service_tier``."""
    if has_field(body, "age_group"):
        raise ValidationError(
            "age_group was removed; set service_tier on the parent service instead",
            field="age_group",
        )


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


def parse_create_instance_payload(
    body: Mapping[str, Any], service: Service
) -> dict[str, Any]:
    """Parse and validate service-instance creation payload."""
    _reject_deprecated_instance_age_group(body)
    slug_value = parse_required_service_instance_slug(body.get("slug"))
    return {
        "title": parse_optional_text(body.get("title"), max_length=255),
        "slug": slug_value,
        "description": parse_optional_text(
            body.get("description"), max_length=MAX_DESCRIPTION_LENGTH
        ),
        "cover_image_s3_key": parse_optional_text(
            body.get("cover_image_s3_key"), max_length=1024
        ),
        "status": parse_optional_enum(body.get("status"), InstanceStatus, "status")
        or InstanceStatus.SCHEDULED,
        "delivery_mode": parse_optional_enum(
            body.get("delivery_mode"),
            ServiceDeliveryMode,
            "delivery_mode",
        ),
        "location_id": parse_optional_uuid(body.get("location_id"), "location_id"),
        "max_capacity": parse_optional_int(
            body.get("max_capacity"), "max_capacity", minimum=1
        ),
        "capacity_left_override": parse_optional_int(
            body.get("capacity_left_override"),
            "capacity_left_override",
            minimum=0,
        ),
        "waitlist_enabled": parse_optional_bool(
            body.get("waitlist_enabled"), "waitlist_enabled"
        )
        or False,
        "instructor_id": parse_optional_text(body.get("instructor_id"), max_length=128),
        "cohort": parse_optional_service_instance_slug_like_text(
            body.get("cohort"), field="cohort"
        ),
        "notes": parse_optional_text(
            body.get("notes"), max_length=MAX_DESCRIPTION_LENGTH
        ),
        "external_url": parse_optional_external_url(
            body.get("external_url"), "external_url"
        ),
        "partner_organization_ids": parse_partner_organization_ids(body),
        "session_slots": parse_session_slots(body.get("session_slots")),
        "tag_ids": parse_uuid_list(body.get("tag_ids"), "tag_ids"),
        "type_details": parse_instance_type_details(service.service_type, body),
    }


def parse_update_instance_payload(
    body: Mapping[str, Any],
    service: Service,
) -> dict[str, Any]:
    """Parse and validate service-instance update payload."""
    if not body:
        raise ValidationError("At least one field is required", field="body")
    _reject_deprecated_instance_age_group(body)
    if service.service_type in (ServiceType.CONSULTATION, ServiceType.INTRO_CALL):
        reject_consultation_instance_pricing_payload(body)
    payload: dict[str, Any] = {}
    if has_field(body, "title"):
        payload["title"] = parse_optional_text(body.get("title"), max_length=255)
    if has_field(body, "slug"):
        parsed_slug = parse_optional_service_instance_slug(body.get("slug"))
        if parsed_slug is None:
            raise ValidationError(
                "slug cannot be cleared",
                field="slug",
            )
        payload["slug"] = parsed_slug
    if has_field(body, "description"):
        payload["description"] = parse_optional_text(
            body.get("description"), max_length=MAX_DESCRIPTION_LENGTH
        )
    if has_field(body, "cover_image_s3_key"):
        payload["cover_image_s3_key"] = parse_optional_text(
            body.get("cover_image_s3_key"), max_length=1024
        )
    if has_field(body, "status"):
        payload["status"] = parse_required_enum(
            body.get("status"), InstanceStatus, "status"
        )
    if has_field(body, "delivery_mode"):
        payload["delivery_mode"] = parse_optional_enum(
            body.get("delivery_mode"),
            ServiceDeliveryMode,
            "delivery_mode",
        )
    if has_field(body, "location_id"):
        payload["location_id"] = parse_optional_uuid(
            body.get("location_id"), "location_id"
        )
    if has_field(body, "max_capacity"):
        payload["max_capacity"] = parse_optional_int(
            body.get("max_capacity"), "max_capacity", minimum=1
        )
    if has_field(body, "capacity_left_override"):
        payload["capacity_left_override"] = parse_optional_int(
            body.get("capacity_left_override"),
            "capacity_left_override",
            minimum=0,
        )
    if has_field(body, "waitlist_enabled"):
        payload["waitlist_enabled"] = parse_required_bool(
            body.get("waitlist_enabled"), "waitlist_enabled"
        )
    if has_field(body, "instructor_id"):
        payload["instructor_id"] = parse_optional_text(
            body.get("instructor_id"), max_length=128
        )
    if has_field(body, "cohort"):
        payload["cohort"] = parse_optional_service_instance_slug_like_text(
            body.get("cohort"), field="cohort"
        )
    if has_field(body, "notes"):
        payload["notes"] = parse_optional_text(
            body.get("notes"), max_length=MAX_DESCRIPTION_LENGTH
        )
    if has_field(body, "external_url"):
        payload["external_url"] = parse_optional_external_url(
            body.get("external_url"), "external_url"
        )
    if has_field(body, "partner_organization_ids"):
        payload["partner_organization_ids"] = parse_partner_organization_ids(body)
    if has_field(body, "session_slots"):
        payload["session_slots"] = parse_session_slots(body.get("session_slots"))
    if has_field(body, "tag_ids"):
        payload["tag_ids"] = parse_uuid_list(body.get("tag_ids"), "tag_ids")
    if has_any_field(
        body,
        "training_details",
        "event_ticket_tiers",
        "consultation_details",
        "training_format",
        "pricing_model",
    ):
        payload["type_details"] = parse_instance_type_details(
            service.service_type, body
        )

    if "status" not in payload:
        raise ValidationError("status is required for PUT", field="status")
    if not payload:
        raise ValidationError("At least one updatable field is required", field="body")
    if service.service_type == ServiceType.EVENT and "type_details" not in payload:
        non_status = {key for key in payload if key != "status"}
        if non_status:
            raise ValidationError(
                "event_ticket_tiers (or nested event tier fields) is required when "
                "updating other fields on an event instance",
                field="event_ticket_tiers",
            )
    return payload


def parse_create_enrollment_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """Parse and validate enrollment create payload."""
    payload = {
        "contact_id": parse_optional_uuid(body.get("contact_id"), "contact_id"),
        "family_id": parse_optional_uuid(body.get("family_id"), "family_id"),
        "organization_id": parse_optional_uuid(
            body.get("organization_id"), "organization_id"
        ),
        "ticket_tier_id": parse_optional_uuid(
            body.get("ticket_tier_id"), "ticket_tier_id"
        ),
        "discount_code_id": parse_optional_uuid(
            body.get("discount_code_id"), "discount_code_id"
        ),
        "status": parse_optional_enum(body.get("status"), EnrollmentStatus, "status")
        or EnrollmentStatus.REGISTERED,
        "amount_paid": parse_optional_decimal(body.get("amount_paid"), "amount_paid"),
        "currency": parse_optional_currency(body.get("currency"), "currency"),
        "notes": parse_optional_text(
            body.get("notes"), max_length=MAX_DESCRIPTION_LENGTH
        ),
    }
    if not any(
        (payload["contact_id"], payload["family_id"], payload["organization_id"])
    ):
        raise ValidationError(
            "One of contact_id, family_id, or organization_id is required",
            field="enrollment",
        )
    return payload


def parse_update_enrollment_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """Parse and validate enrollment update payload."""
    if not body:
        raise ValidationError("At least one field is required", field="body")
    payload: dict[str, Any] = {}
    if has_field(body, "status"):
        payload["status"] = parse_required_enum(
            body.get("status"), EnrollmentStatus, "status"
        )
    if has_field(body, "enrolled_at"):
        parsed_enrolled_at = parse_optional_datetime(
            body.get("enrolled_at"), "enrolled_at"
        )
        if parsed_enrolled_at is None:
            raise ValidationError(
                "enrolled_at cannot be cleared; omit the field to leave unchanged",
                field="enrolled_at",
            )
        payload["enrolled_at"] = parsed_enrolled_at
    if has_field(body, "amount_paid"):
        payload["amount_paid"] = parse_optional_decimal(
            body.get("amount_paid"), "amount_paid"
        )
    if has_field(body, "currency"):
        payload["currency"] = parse_optional_currency(body.get("currency"), "currency")
    if has_field(body, "notes"):
        payload["notes"] = parse_optional_text(
            body.get("notes"), max_length=MAX_DESCRIPTION_LENGTH
        )
    if has_field(body, "discount_code_id"):
        raw_dc = body.get("discount_code_id")
        if raw_dc is None or (isinstance(raw_dc, str) and not raw_dc.strip()):
            payload["discount_code_id"] = None
        else:
            payload["discount_code_id"] = parse_optional_uuid(
                raw_dc, "discount_code_id"
            )
    promote_family = has_field(body, "promote_to_family_id")
    promote_org = has_field(body, "promote_to_organization_id")
    if promote_family and promote_org:
        raise ValidationError(
            "Send only one of promote_to_family_id or promote_to_organization_id",
            field="body",
        )
    if promote_family:
        fid = parse_optional_uuid(
            body.get("promote_to_family_id"), "promote_to_family_id"
        )
        if fid is None:
            raise ValidationError(
                "promote_to_family_id must be a UUID",
                field="promote_to_family_id",
            )
        payload["promote_to_family_id"] = fid
    if promote_org:
        oid = parse_optional_uuid(
            body.get("promote_to_organization_id"), "promote_to_organization_id"
        )
        if oid is None:
            raise ValidationError(
                "promote_to_organization_id must be a UUID",
                field="promote_to_organization_id",
            )
        payload["promote_to_organization_id"] = oid
    if not payload:
        raise ValidationError("At least one updatable field is required", field="body")
    return payload


def ensure_discount_validity_window(
    valid_from: datetime | None,
    valid_until: datetime | None,
) -> None:
    """Reject ranges where the end is strictly before the start."""
    if valid_from is not None and valid_until is not None:
        if valid_from > valid_until:
            raise ValidationError(
                "valid_until must be on or after valid_from",
                field="valid_until",
            )


def parse_create_discount_code_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """Parse and validate discount-code create payload."""
    discount_type = parse_required_enum(
        body.get("discount_type"), DiscountType, "discount_type"
    )
    valid_from = parse_optional_datetime(body.get("valid_from"), "valid_from")
    valid_until = parse_optional_datetime(body.get("valid_until"), "valid_until")
    discount_value: Decimal
    currency: str | None
    if discount_type == DiscountType.REFERRAL:
        discount_value = REFERRAL_DEFAULT_DISCOUNT_VALUE
        currency = REFERRAL_DEFAULT_CURRENCY
    else:
        discount_value = parse_required_decimal(
            body.get("discount_value"), "discount_value"
        )
        currency = parse_optional_currency(body.get("currency"), "currency")
    payload = {
        "code": parse_required_text(
            body.get("code"), "code", max_length=_MAX_CODE_LENGTH
        ),
        "description": parse_optional_text(
            body.get("description"), max_length=MAX_DESCRIPTION_LENGTH
        ),
        "discount_type": discount_type,
        "discount_value": discount_value,
        "currency": currency,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "service_id": parse_optional_uuid(body.get("service_id"), "service_id"),
        "instance_id": parse_optional_uuid(body.get("instance_id"), "instance_id"),
        "max_uses": parse_optional_int(body.get("max_uses"), "max_uses", minimum=1),
        "active": parse_optional_bool(body.get("active"), "active"),
    }
    if discount_type == DiscountType.ABSOLUTE and not payload["currency"]:
        raise ValidationError(
            "currency is required for absolute discounts", field="currency"
        )
    ensure_discount_validity_window(valid_from, valid_until)
    return payload


def parse_update_discount_code_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """Parse and validate discount-code update payload."""
    if not body:
        raise ValidationError("At least one field is required", field="body")
    payload: dict[str, Any] = {}
    if has_field(body, "description"):
        payload["description"] = parse_optional_text(
            body.get("description"), max_length=MAX_DESCRIPTION_LENGTH
        )
    if has_field(body, "discount_type"):
        payload["discount_type"] = parse_required_enum(
            body.get("discount_type"), DiscountType, "discount_type"
        )
    if has_field(body, "discount_value"):
        payload["discount_value"] = parse_required_non_negative_decimal(
            body.get("discount_value"), "discount_value"
        )
    if has_field(body, "currency"):
        payload["currency"] = parse_optional_currency(body.get("currency"), "currency")
    if has_field(body, "valid_from"):
        payload["valid_from"] = parse_optional_datetime(
            body.get("valid_from"), "valid_from"
        )
    if has_field(body, "valid_until"):
        payload["valid_until"] = parse_optional_datetime(
            body.get("valid_until"), "valid_until"
        )
    if has_field(body, "service_id"):
        payload["service_id"] = parse_optional_uuid(
            body.get("service_id"), "service_id"
        )
    if has_field(body, "instance_id"):
        payload["instance_id"] = parse_optional_uuid(
            body.get("instance_id"), "instance_id"
        )
    if has_field(body, "max_uses"):
        payload["max_uses"] = parse_optional_int(
            body.get("max_uses"), "max_uses", minimum=1
        )
    if has_field(body, "active"):
        payload["active"] = parse_required_bool(body.get("active"), "active")
    if not payload:
        raise ValidationError("At least one updatable field is required", field="body")
    if payload.get("discount_type") == DiscountType.REFERRAL:
        payload["discount_value"] = REFERRAL_DEFAULT_DISCOUNT_VALUE
        payload["currency"] = REFERRAL_DEFAULT_CURRENCY
    return payload
