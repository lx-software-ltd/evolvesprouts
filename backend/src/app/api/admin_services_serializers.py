"""Serialization helpers for admin services APIs."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from app.api.admin_entities_helpers import serialize_tag_ref
from app.api.instance_capacity import compute_capacity_left_effective
from app.db.models import (
    DiscountCode,
    Enrollment,
    EventTicketTier,
    InstanceSessionSlot,
    Service,
    ServiceInstance,
)
from app.db.models.enums import (
    CAPACITY_ENROLLMENT_STATUSES,
    ConsultationPricingModel,
    EventbriteSyncStatus,
    ServiceType,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _decimal_to_string(value: Decimal | None) -> str | None:
    return str(value) if value is not None else None


def _training_details_summary(service: Service) -> dict[str, Any] | None:
    """Return training pricing fields for list/summary payloads when present."""
    details = service.training_course_details
    if details is None:
        return None
    return {
        "pricing_unit": details.pricing_unit.value,
        "default_price": _decimal_to_string(details.default_price),
        "default_currency": details.default_currency,
    }


def _event_details_summary(service: Service) -> dict[str, Any] | None:
    """Return event category for list/summary payloads when present."""
    details = service.event_details
    if details is None:
        return None
    return {
        "event_category": details.event_category.value,
        "default_price": _decimal_to_string(details.default_price),
        "default_currency": details.default_currency,
    }


def _consultation_details_summary(service: Service) -> dict[str, Any] | None:
    """Return consultation pricing fields for list/summary payloads when present."""
    details = service.consultation_details
    if details is None:
        return None
    return {
        "consultation_format": details.consultation_format.value,
        "max_group_size": details.max_group_size,
        "duration_minutes": details.duration_minutes,
        "pricing_model": details.pricing_model.value,
        "default_hourly_rate": _decimal_to_string(details.default_hourly_rate),
        "default_package_price": _decimal_to_string(details.default_package_price),
        "default_package_sessions": details.default_package_sessions,
        "default_currency": details.default_currency,
    }


def serialize_service_summary(
    service: Service, *, instances_count: int
) -> dict[str, Any]:
    """Serialize service list row payload."""
    logger.debug("Serializing service summary", extra={"service_id": str(service.id)})
    return {
        "id": str(service.id),
        "service_type": service.service_type.value,
        "title": service.title,
        "description": service.description,
        "service_key": service.service_key,
        "booking_system": service.booking_system,
        "cover_image_s3_key": service.cover_image_s3_key,
        "delivery_mode": service.delivery_mode.value,
        "status": service.status.value,
        "service_tier": service.service_tier,
        "location_id": str(service.location_id) if service.location_id else None,
        "created_by": service.created_by,
        "created_at": service.created_at.isoformat() if service.created_at else None,
        "updated_at": service.updated_at.isoformat() if service.updated_at else None,
        "instances_count": instances_count,
        "training_details": _training_details_summary(service),
        "event_details": _event_details_summary(service),
        "consultation_details": _consultation_details_summary(service),
    }


def serialize_service_detail(service: Service) -> dict[str, Any]:
    """Serialize service detail payload with type-specific details."""
    detail = serialize_service_summary(service, instances_count=len(service.instances))
    detail["tag_ids"] = [str(tag.id) for tag in service.tags]
    detail["asset_ids"] = [str(asset.id) for asset in service.assets]
    detail["instances_count"] = len(service.instances)
    detail["training_details"] = None
    detail["event_details"] = None
    detail["consultation_details"] = None
    if service.training_course_details is not None:
        detail["training_details"] = _training_details_summary(service)
    if service.event_details is not None:
        ed = service.event_details
        detail["event_details"] = {
            "event_category": ed.event_category.value,
            "default_price": _decimal_to_string(ed.default_price),
            "default_currency": ed.default_currency,
        }
    if service.consultation_details is not None:
        detail["consultation_details"] = {
            "consultation_format": service.consultation_details.consultation_format.value,
            "max_group_size": service.consultation_details.max_group_size,
            "duration_minutes": service.consultation_details.duration_minutes,
            "pricing_model": service.consultation_details.pricing_model.value,
            "default_hourly_rate": _decimal_to_string(
                service.consultation_details.default_hourly_rate
            ),
            "default_package_price": _decimal_to_string(
                service.consultation_details.default_package_price
            ),
            "default_package_sessions": service.consultation_details.default_package_sessions,
            "default_currency": service.consultation_details.default_currency,
        }
    return detail


def _consultation_service_price_for_model(
    service: Service, *, pricing_model: ConsultationPricingModel
) -> Decimal | None:
    """Pick the service-template price field that matches the pricing model."""
    cd = service.consultation_details
    if cd is None:
        return None
    if pricing_model == ConsultationPricingModel.HOURLY:
        return cd.default_hourly_rate
    if pricing_model == ConsultationPricingModel.PACKAGE:
        return cd.default_package_price
    return None


def _resolved_training_details(
    instance: ServiceInstance, service: Service
) -> dict[str, Any] | None:
    if instance.training_details is not None:
        td = instance.training_details
        return {
            "training_format": td.training_format.value,
            "price": _decimal_to_string(td.price),
            "currency": td.currency,
            "pricing_unit": td.pricing_unit.value,
        }
    std = service.training_course_details
    if service.service_type != ServiceType.TRAINING_COURSE or std is None:
        return None
    return {
        "training_format": "group",
        "price": _decimal_to_string(std.default_price),
        "currency": std.default_currency,
        "pricing_unit": std.pricing_unit.value,
    }


def _resolved_consultation_details(
    instance: ServiceInstance, service: Service
) -> dict[str, Any] | None:
    del instance  # Tier/consultation pricing is catalog-level only after tier-per-service migration.
    scd = service.consultation_details
    if (
        service.service_type not in (ServiceType.CONSULTATION, ServiceType.INTRO_CALL)
        or scd is None
    ):
        return None
    pm = scd.pricing_model
    resolved_price = _decimal_to_string(
        _consultation_service_price_for_model(service, pricing_model=pm)
    )
    return {
        "pricing_model": pm.value,
        "price": resolved_price,
        "currency": scd.default_currency,
        "package_sessions": scd.default_package_sessions,
    }


def _resolved_event_ticket_tiers(
    instance: ServiceInstance, service: Service
) -> list[dict[str, Any]]:
    if instance.ticket_tiers:
        return [serialize_event_ticket_tier(tier) for tier in instance.ticket_tiers]
    ed = service.event_details
    if service.service_type != ServiceType.EVENT or ed is None:
        return []
    return [
        {
            "id": None,
            "instance_id": str(instance.id),
            "name": ed.event_category.value,
            "description": None,
            "price": _decimal_to_string(ed.default_price) or "0.00",
            "currency": ed.default_currency,
            "max_quantity": None,
            "sort_order": 0,
        }
    ]


def _capacity_enrollment_count_from_loaded(instance: ServiceInstance) -> int:
    """Count capacity enrollments when ``instance.enrollments`` is loaded (detail payloads)."""
    enrollments = getattr(instance, "enrollments", None)
    if not enrollments:
        return 0
    return sum(1 for row in enrollments if row.status in CAPACITY_ENROLLMENT_STATUSES)


def _eventbrite_last_error(instance: ServiceInstance) -> str | None:
    raw = instance.eventbrite_last_error
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    return text or None


def serialize_instance(
    instance: ServiceInstance,
    *,
    capacity_enrolled_count: int | None = None,
    enrollment_counts_by_instance_id: dict[UUID, int] | None = None,
) -> dict[str, Any]:
    """Serialize service instance payload."""
    service = instance.service
    resolved_title = instance.title if instance.title is not None else service.title
    resolved_slug = instance.slug
    resolved_description = (
        instance.description
        if instance.description is not None
        else service.description
    )
    resolved_cover_image_s3_key = (
        instance.cover_image_s3_key
        if instance.cover_image_s3_key is not None
        else service.cover_image_s3_key
    )
    resolved_delivery_mode = (
        instance.delivery_mode.value
        if instance.delivery_mode is not None
        else service.delivery_mode.value
    )
    resolved_location_id = (
        str(instance.location_id)
        if instance.location_id is not None
        else (str(service.location_id) if service.location_id else None)
    )
    sorted_instance_tags = sorted(
        instance.instance_tags,
        key=lambda row: (
            row.tag.name.lower() if row.tag else "",
            str(row.tag_id),
        ),
    )
    if capacity_enrolled_count is not None:
        enrolled_for_capacity = capacity_enrolled_count
    elif enrollment_counts_by_instance_id is not None:
        enrolled_for_capacity = enrollment_counts_by_instance_id.get(instance.id, 0)
    else:
        enrolled_for_capacity = _capacity_enrollment_count_from_loaded(instance)
    return {
        "id": str(instance.id),
        "service_id": str(instance.service_id),
        "parent_service_title": service.title,
        "parent_service_tier": service.service_tier,
        "parent_service_type": service.service_type.value,
        "parent_service_key": service.service_key,
        "title": instance.title,
        "slug": instance.slug,
        "description": instance.description,
        "cover_image_s3_key": instance.cover_image_s3_key,
        "status": instance.status.value,
        "delivery_mode": instance.delivery_mode.value
        if instance.delivery_mode
        else None,
        "location_id": str(instance.location_id) if instance.location_id else None,
        "max_capacity": instance.max_capacity,
        "capacity_enrolled_count": enrolled_for_capacity,
        "capacity_left_override": instance.capacity_left_override,
        "capacity_left_effective": compute_capacity_left_effective(
            max_capacity=instance.max_capacity,
            capacity_enrolled_count=enrolled_for_capacity,
            capacity_left_override=instance.capacity_left_override,
        ),
        "waitlist_enabled": instance.waitlist_enabled,
        "eventbrite_sync_status": (
            instance.eventbrite_sync_status.value
            if instance.eventbrite_sync_status is not None
            else EventbriteSyncStatus.PENDING.value
        ),
        "eventbrite_event_url": instance.eventbrite_event_url,
        "eventbrite_last_error": _eventbrite_last_error(instance),
        "external_url": instance.external_url,
        "partner_organizations": [
            {
                "id": str(link.organization_id),
                "name": link.organization.name,
                "archived": link.organization.archived_at is not None,
                "location_id": str(link.organization.location_id)
                if link.organization.location_id
                else None,
            }
            for link in sorted(
                instance.partner_organization_links,
                key=lambda row: row.sort_order,
            )
        ],
        "instructor_id": instance.instructor_id,
        "cohort": instance.cohort,
        "notes": instance.notes,
        "tags": [
            serialize_tag_ref(link.tag) for link in sorted_instance_tags if link.tag
        ],
        "tag_ids": [str(link.tag_id) for link in sorted_instance_tags],
        "created_by": instance.created_by,
        "created_at": instance.created_at.isoformat() if instance.created_at else None,
        "updated_at": instance.updated_at.isoformat() if instance.updated_at else None,
        "resolved_title": resolved_title,
        "resolved_slug": resolved_slug,
        "resolved_description": resolved_description,
        "resolved_cover_image_s3_key": resolved_cover_image_s3_key,
        "resolved_delivery_mode": resolved_delivery_mode,
        "resolved_location_id": resolved_location_id,
        "session_slots": [
            serialize_session_slot(slot) for slot in instance.session_slots
        ],
        "training_details": (
            {
                "training_format": instance.training_details.training_format.value,
                "price": _decimal_to_string(instance.training_details.price),
                "currency": instance.training_details.currency,
                "pricing_unit": instance.training_details.pricing_unit.value,
            }
            if instance.training_details is not None
            else None
        ),
        "resolved_training_details": _resolved_training_details(instance, service),
        "event_ticket_tiers": [
            serialize_event_ticket_tier(tier) for tier in instance.ticket_tiers
        ],
        "resolved_event_ticket_tiers": _resolved_event_ticket_tiers(instance, service),
        "consultation_details": None,
        "resolved_consultation_details": _resolved_consultation_details(
            instance, service
        ),
    }


def serialize_session_slot(slot: InstanceSessionSlot) -> dict[str, Any]:
    """Serialize one session slot."""
    return {
        "id": str(slot.id),
        "instance_id": str(slot.instance_id),
        "purpose_service_id": str(slot.purpose_service_id)
        if slot.purpose_service_id
        else None,
        "location_id": str(slot.location_id) if slot.location_id else None,
        "starts_at": slot.starts_at.isoformat() if slot.starts_at else None,
        "ends_at": slot.ends_at.isoformat() if slot.ends_at else None,
        "sort_order": slot.sort_order,
    }


def serialize_event_ticket_tier(tier: EventTicketTier) -> dict[str, Any]:
    """Serialize one event ticket tier."""
    return {
        "id": str(tier.id),
        "instance_id": str(tier.instance_id),
        "name": tier.name,
        "description": tier.description,
        "price": _decimal_to_string(tier.price),
        "currency": tier.currency,
        "max_quantity": tier.max_quantity,
        "sort_order": tier.sort_order,
    }


def serialize_enrollment(
    enrollment: Enrollment,
    *,
    party_display_name: str,
) -> dict[str, Any]:
    """Serialize enrollment payload."""
    payload: dict[str, Any] = {
        "id": str(enrollment.id),
        "instance_id": str(enrollment.instance_id),
        "contact_id": str(enrollment.contact_id) if enrollment.contact_id else None,
        "family_id": str(enrollment.family_id) if enrollment.family_id else None,
        "organization_id": str(enrollment.organization_id)
        if enrollment.organization_id
        else None,
        "ticket_tier_id": str(enrollment.ticket_tier_id)
        if enrollment.ticket_tier_id
        else None,
        "discount_code_id": str(enrollment.discount_code_id)
        if enrollment.discount_code_id
        else None,
        "status": enrollment.status.value,
        "amount_paid": _decimal_to_string(enrollment.amount_paid),
        "currency": enrollment.currency,
        "enrolled_at": enrollment.enrolled_at.isoformat()
        if enrollment.enrolled_at
        else None,
        "cancelled_at": enrollment.cancelled_at.isoformat()
        if enrollment.cancelled_at
        else None,
        "notes": enrollment.notes,
        "created_by": enrollment.created_by,
        "created_at": enrollment.created_at.isoformat()
        if enrollment.created_at
        else None,
        "updated_at": enrollment.updated_at.isoformat()
        if enrollment.updated_at
        else None,
        "party_display_name": party_display_name,
    }
    return payload


def serialize_discount_code(code: DiscountCode) -> dict[str, Any]:
    """Serialize discount-code payload."""
    return {
        "id": str(code.id),
        "code": code.code,
        "description": code.description,
        "discount_type": code.discount_type.value,
        "discount_value": _decimal_to_string(code.discount_value),
        "currency": code.currency,
        "valid_from": code.valid_from.isoformat() if code.valid_from else None,
        "valid_until": code.valid_until.isoformat() if code.valid_until else None,
        "service_id": str(code.service_id) if code.service_id else None,
        "instance_id": str(code.instance_id) if code.instance_id else None,
        "max_uses": code.max_uses,
        "current_uses": code.current_uses,
        "active": code.active,
        "created_by": code.created_by,
        "created_at": code.created_at.isoformat() if code.created_at else None,
        "updated_at": code.updated_at.isoformat() if code.updated_at else None,
    }
