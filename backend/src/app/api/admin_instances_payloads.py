"""Create/update payload parsers for admin service instances."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.api.admin_validators import (
    MAX_DESCRIPTION_LENGTH,
    parse_optional_service_instance_slug,
    parse_optional_service_instance_slug_like_text,
    parse_required_service_instance_slug,
)
from app.api.admin_service_instance_partners import parse_partner_organization_ids
from app.api.admin_services_payload_utils import (
    has_any_field,
    has_field,
    parse_instance_type_details,
    parse_optional_bool,
    parse_optional_enum,
    parse_optional_external_url,
    parse_optional_int,
    parse_optional_text,
    parse_optional_uuid,
    parse_required_bool,
    parse_required_enum,
    parse_session_slots,
    parse_uuid_list,
    reject_consultation_instance_pricing_payload,
)
from app.db.models import InstanceStatus, Service, ServiceDeliveryMode, ServiceType
from app.exceptions import ValidationError


def _reject_deprecated_instance_age_group(body: Mapping[str, Any]) -> None:
    """Instance ``age_group`` was removed; tier lives on the parent service as ``service_tier``."""
    if has_field(body, "age_group"):
        raise ValidationError(
            "age_group was removed; set service_tier on the parent service instead",
            field="age_group",
        )

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
