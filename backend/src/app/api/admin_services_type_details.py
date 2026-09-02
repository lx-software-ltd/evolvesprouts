"""Per-service-type detail payload parsing for admin services and instances."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.api.admin_services_payload_utils import (
    extract_obj,
    parse_optional_currency,
    parse_optional_decimal,
    parse_optional_enum,
    parse_optional_int,
    parse_optional_text,
    parse_required_enum,
    parse_required_non_negative_decimal,
)
from app.api.admin_validators import MAX_DESCRIPTION_LENGTH
from app.db.models import (
    ConsultationFormat,
    ConsultationPricingModel,
    EventCategory,
    ServiceType,
    TrainingFormat,
    TrainingPricingUnit,
)
from app.exceptions import ValidationError
from app.utils.logging import get_logger

logger = get_logger(__name__)


_CONSULTATION_INSTANCE_FORBIDDEN_TOP_LEVEL = frozenset(
    {
        "pricing_model",
        "price",
        "currency",
        "package_sessions",
        "default_hourly_rate",
        "default_package_price",
        "default_package_sessions",
        "default_currency",
    }
)


def reject_consultation_instance_pricing_payload(body: Mapping[str, Any]) -> None:
    """Reject instance payloads that try to set catalog-level consultation pricing."""
    if body.get("consultation_details") is not None:
        raise ValidationError(
            "Consultation pricing now lives on the parent service catalog row. "
            "Edit `consultation_details` on the service, not the instance.",
            field="consultation_details",
        )
    for key in _CONSULTATION_INSTANCE_FORBIDDEN_TOP_LEVEL:
        if key in body:
            raise ValidationError(
                "Consultation pricing now lives on the parent service catalog row. "
                "Edit `consultation_details` on the service, not the instance.",
                field="consultation_details",
            )


def parse_service_type_details(
    service_type: ServiceType, body: Mapping[str, Any]
) -> dict[str, Any]:
    """Parse service type-specific details."""
    logger.debug(
        "Parsing service type details",
        extra={"service_type": service_type.value},
    )
    if service_type == ServiceType.TRAINING_COURSE:
        source = extract_obj(body, "training_details")
        return {
            "pricing_unit": parse_optional_enum(
                source.get("pricing_unit") or body.get("pricing_unit"),
                TrainingPricingUnit,
                "pricing_unit",
            )
            or TrainingPricingUnit.PER_PERSON,
            "default_price": parse_optional_decimal(
                source.get("default_price")
                if "default_price" in source
                else body.get("default_price"),
                "default_price",
            ),
            "default_currency": parse_optional_currency(
                source.get("default_currency")
                if "default_currency" in source
                else body.get("default_currency"),
                "default_currency",
            )
            or "HKD",
        }
    if service_type == ServiceType.EVENT:
        source = extract_obj(body, "event_details")
        return {
            "event_category": parse_required_enum(
                source.get("event_category") or body.get("event_category"),
                EventCategory,
                "event_category",
            ),
            "default_price": parse_optional_decimal(
                source.get("default_price")
                if "default_price" in source
                else body.get("default_price"),
                "default_price",
            ),
            "default_currency": parse_optional_currency(
                source.get("default_currency")
                if "default_currency" in source
                else body.get("default_currency"),
                "default_currency",
            )
            or "HKD",
        }

    source = extract_obj(body, "consultation_details")
    duration_minutes = parse_optional_int(
        source.get("duration_minutes")
        if "duration_minutes" in source
        else body.get("duration_minutes"),
        "duration_minutes",
        minimum=1,
    )
    if duration_minutes is None:
        raise ValidationError(
            "duration_minutes is required for consultation services",
            field="duration_minutes",
        )
    return {
        "consultation_format": parse_required_enum(
            source.get("consultation_format") or body.get("consultation_format"),
            ConsultationFormat,
            "consultation_format",
        ),
        "max_group_size": parse_optional_int(
            source.get("max_group_size")
            if "max_group_size" in source
            else body.get("max_group_size"),
            "max_group_size",
            minimum=1,
        ),
        "duration_minutes": duration_minutes,
        "pricing_model": parse_optional_enum(
            source.get("pricing_model") or body.get("pricing_model"),
            ConsultationPricingModel,
            "pricing_model",
        )
        or ConsultationPricingModel.FREE,
        "default_hourly_rate": parse_optional_decimal(
            source.get("default_hourly_rate")
            if "default_hourly_rate" in source
            else body.get("default_hourly_rate"),
            "default_hourly_rate",
        ),
        "default_package_price": parse_optional_decimal(
            source.get("default_package_price")
            if "default_package_price" in source
            else body.get("default_package_price"),
            "default_package_price",
        ),
        "default_package_sessions": parse_optional_int(
            source.get("default_package_sessions")
            if "default_package_sessions" in source
            else body.get("default_package_sessions"),
            "default_package_sessions",
            minimum=1,
        ),
        "default_currency": parse_optional_currency(
            source.get("default_currency")
            if "default_currency" in source
            else body.get("default_currency"),
            "default_currency",
        )
        or "HKD",
    }


def parse_instance_type_details(
    service_type: ServiceType, body: Mapping[str, Any]
) -> dict[str, Any]:
    """Parse instance type-specific details."""
    logger.debug(
        "Parsing instance type details",
        extra={"service_type": service_type.value},
    )
    if service_type == ServiceType.TRAINING_COURSE:
        source = extract_obj(body, "training_details")
        return {
            "training_format": parse_required_enum(
                source.get("training_format") or body.get("training_format"),
                TrainingFormat,
                "training_format",
            ),
            "price": parse_required_non_negative_decimal(
                source.get("price") if "price" in source else body.get("price"),
                "price",
            ),
            "currency": parse_optional_currency(
                source.get("currency")
                if "currency" in source
                else body.get("currency"),
                "currency",
            )
            or "HKD",
            "pricing_unit": parse_optional_enum(
                source.get("pricing_unit")
                if "pricing_unit" in source
                else body.get("pricing_unit"),
                TrainingPricingUnit,
                "pricing_unit",
            )
            or TrainingPricingUnit.PER_PERSON,
        }
    if service_type == ServiceType.EVENT:
        tiers_value = body.get("event_ticket_tiers")
        if tiers_value is None:
            return {"event_ticket_tiers": []}
        if not isinstance(tiers_value, list):
            raise ValidationError(
                "event_ticket_tiers must be an array",
                field="event_ticket_tiers",
            )
        tiers: list[dict[str, Any]] = []
        for idx, entry in enumerate(tiers_value):
            if not isinstance(entry, Mapping):
                raise ValidationError(
                    f"event_ticket_tiers[{idx}] must be an object",
                    field="event_ticket_tiers",
                )
            name_raw = parse_optional_text(entry.get("name"), max_length=100)
            tiers.append(
                {
                    "name": (name_raw or "").strip(),
                    "description": parse_optional_text(
                        entry.get("description"), max_length=MAX_DESCRIPTION_LENGTH
                    ),
                    "price": parse_optional_decimal(entry.get("price"), "price"),
                    "currency": parse_optional_currency(
                        entry.get("currency"), "currency"
                    ),
                    "max_quantity": parse_optional_int(
                        entry.get("max_quantity"), "max_quantity", minimum=1
                    ),
                    "sort_order": parse_optional_int(
                        entry.get("sort_order"), "sort_order", minimum=0
                    )
                    or idx,
                }
            )
        return {"event_ticket_tiers": tiers}
    if service_type in (ServiceType.CONSULTATION, ServiceType.INTRO_CALL):
        reject_consultation_instance_pricing_payload(body)
        return {}
    raise AssertionError(
        f"Unhandled service_type for instance details: {service_type!r}"
    )
