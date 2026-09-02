"""Validation helpers for admin APIs."""

from __future__ import annotations

import re
from typing import Any

from app.api.validators import (
    EMAIL_RE,
    MAX_ADDRESS_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_EMAIL_LENGTH,
    MAX_NAME_LENGTH,
    MAX_PHONE_NUMBER_LENGTH,
    MAX_PHONE_REGION_LENGTH,
    MAX_SOCIAL_HANDLE_LENGTH,
    validate_email,
    validate_phone_fields,
    validate_phone_region,
    validate_string_length,
)
from app.exceptions import ValidationError
from app.utils.validators import instagram_handle_for_storage

# Generic payload validators live in ``app.api.validators``; they are re-exported
# here so admin modules keep a single import site.
__all__ = [
    "EMAIL_RE",
    "MAX_ADDRESS_LENGTH",
    "MAX_DESCRIPTION_LENGTH",
    "MAX_EMAIL_LENGTH",
    "MAX_NAME_LENGTH",
    "MAX_PHONE_NUMBER_LENGTH",
    "MAX_PHONE_REGION_LENGTH",
    "MAX_SOCIAL_HANDLE_LENGTH",
    "SERVICE_INSTANCE_SLUG_RE",
    "parse_optional_instagram_handle",
    "parse_optional_partner_key",
    "parse_optional_service_instance_slug",
    "parse_optional_service_instance_slug_like_text",
    "parse_required_service_instance_slug",
    "validate_email",
    "validate_phone_fields",
    "validate_phone_region",
    "validate_string_length",
]

# Lowercase URL-safe slug: alphanumeric segments separated by single hyphens.
SERVICE_INSTANCE_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_MAX_SERVICE_INSTANCE_SLUG_LENGTH = 128


def parse_required_service_instance_slug(value: Any, *, field: str = "slug") -> str:
    """Return a normalized lowercase slug; raises ValidationError if missing or invalid."""
    parsed = parse_optional_service_instance_slug(value, field=field)
    if parsed is None:
        raise ValidationError("slug is required", field=field)
    return parsed


def parse_optional_service_instance_slug(
    value: Any, *, field: str = "slug"
) -> str | None:
    """Return a normalized lowercase slug or None; raises ValidationError if invalid."""
    return _parse_optional_kebab_slug(value, field=field)


def parse_optional_partner_key(value: Any, *, field: str = "partner_key") -> str | None:
    """Normalize optional partner organisation key (same character rules as instance slugs)."""
    return _parse_optional_kebab_slug(value, field=field)


def _parse_optional_kebab_slug(value: Any, *, field: str) -> str | None:
    """Return a normalized lowercase slug or None; raises ValidationError if invalid."""
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    trimmed = value.strip().lower()
    if not trimmed:
        return None
    if len(trimmed) > _MAX_SERVICE_INSTANCE_SLUG_LENGTH:
        raise ValidationError(
            f"{field} must be at most {_MAX_SERVICE_INSTANCE_SLUG_LENGTH} characters",
            field=field,
        )
    if not SERVICE_INSTANCE_SLUG_RE.fullmatch(trimmed):
        raise ValidationError(
            f"{field} must be lowercase letters, digits, and single hyphens between segments",
            field=field,
        )
    return trimmed


def parse_optional_service_instance_slug_like_text(
    value: Any, *, field: str
) -> str | None:
    """Same character rules and normalization as instance slug; for free-text labels."""
    return _parse_optional_kebab_slug(value, field=field)


def parse_optional_instagram_handle(value: Any) -> str | None:
    """Normalize an Instagram handle for storage (no leading ``@``, max 30)."""
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    stored = instagram_handle_for_storage(value)
    if stored is None:
        return None
    if len(stored) > 30:
        raise ValidationError(
            "instagram_handle must be at most 30 characters",
            field="instagram_handle",
        )
    return stored
