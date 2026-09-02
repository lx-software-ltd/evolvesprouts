"""Create/update payload parsers for admin enrollments."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.api.admin_validators import MAX_DESCRIPTION_LENGTH
from app.api.admin_services_payload_utils import (
    has_field,
    parse_optional_currency,
    parse_optional_datetime,
    parse_optional_decimal,
    parse_optional_enum,
    parse_optional_text,
    parse_optional_uuid,
    parse_required_enum,
)
from app.db.models import EnrollmentStatus
from app.exceptions import ValidationError


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
