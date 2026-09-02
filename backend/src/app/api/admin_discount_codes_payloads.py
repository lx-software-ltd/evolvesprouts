"""Create/update payload parsers for admin discount codes."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.api.admin_validators import MAX_DESCRIPTION_LENGTH
from app.api.admin_services_payload_utils import (
    has_field,
    parse_optional_bool,
    parse_optional_currency,
    parse_optional_datetime,
    parse_optional_int,
    parse_optional_text,
    parse_optional_uuid,
    parse_required_bool,
    parse_required_decimal,
    parse_required_enum,
    parse_required_non_negative_decimal,
    parse_required_text,
)
from app.db.models import DiscountType
from app.exceptions import ValidationError

_MAX_CODE_LENGTH = 50
REFERRAL_DEFAULT_DISCOUNT_VALUE = Decimal("0")
REFERRAL_DEFAULT_CURRENCY = "HKD"


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
