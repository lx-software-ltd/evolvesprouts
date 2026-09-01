"""Validation helpers for admin APIs."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from app.exceptions import ValidationError
from app.utils.validators import instagram_handle_for_storage

# --- Security validation functions ---

# Maximum string lengths to prevent DoS attacks
MAX_NAME_LENGTH = 200
MAX_DESCRIPTION_LENGTH = 5000
MAX_ADDRESS_LENGTH = 500
MAX_URL_LENGTH = 2048
MAX_EMAIL_LENGTH = 320
MAX_PHONE_REGION_LENGTH = 2
MAX_PHONE_NUMBER_LENGTH = 20
MAX_LANGUAGE_CODE_LENGTH = 10
MAX_LANGUAGES_COUNT = 20
MAX_MEDIA_URLS_COUNT = 20
MAX_FEEDBACK_LABELS_COUNT = 20
MAX_SOCIAL_VALUE_LENGTH = 2048
MAX_SOCIAL_HANDLE_LENGTH = 64

# Valid ISO 639-1 language codes (common ones)
VALID_LANGUAGE_CODES = frozenset(
    [
        "en",
        "zh",
        "ja",
        "ko",
        "fr",
        "de",
        "es",
        "pt",
        "it",
        "ru",
        "ar",
        "hi",
        "th",
        "vi",
        "id",
        "ms",
        "tl",
        "nl",
        "pl",
        "tr",
        "yue",  # Cantonese
    ]
)

SOCIAL_FIELDS = (
    "whatsapp",
    "facebook",
    "instagram",
    "tiktok",
    "twitter",
    "xiaohongshu",
    "wechat",
)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SOCIAL_HANDLE_RE = re.compile(r"^@?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
# Lowercase URL-safe slug: alphanumeric segments separated by single hyphens.
SERVICE_INSTANCE_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_MAX_SERVICE_INSTANCE_SLUG_LENGTH = 128


@lru_cache(maxsize=1)
def _valid_currencies() -> frozenset[str]:
    """Return cached ISO 4217 currency codes."""
    import pycountry

    codes: set[str] = set()
    for currency in pycountry.currencies:
        code = getattr(currency, "alpha_3", None)
        if code:
            codes.add(code.upper())
    return frozenset(codes)


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


def validate_string_length(
    value: Any,
    field_name: str,
    max_length: int,
    required: bool = False,
) -> str | None:
    """Validate and sanitize a string input."""
    if value is None:
        if required:
            raise ValidationError(f"{field_name} is required", field=field_name)
        return None
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if not value:
        if required:
            raise ValidationError(f"{field_name} is required", field=field_name)
        return None
    if len(value) > max_length:
        raise ValidationError(
            f"{field_name} must be at most {max_length} characters",
            field=field_name,
        )
    return value


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


def _validate_url(url: str, field_name: str = "url") -> str:
    """Validate a URL is http(s) and within limits."""
    if not isinstance(url, str):
        raise ValidationError(f"{field_name} must be a string", field=field_name)
    url = url.strip()
    if len(url) > MAX_URL_LENGTH:
        raise ValidationError(
            f"{field_name} must be at most {MAX_URL_LENGTH} characters",
            field=field_name,
        )
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValidationError(
            f"{field_name} must use http or https scheme",
            field=field_name,
        )
    if not parsed.netloc:
        raise ValidationError(
            f"{field_name} must have a valid domain", field=field_name
        )
    return url


def _validate_media_urls(urls: list[str]) -> list[str]:
    """Validate media URL list."""
    cleaned = [str(url).strip() for url in urls if str(url).strip()]
    if len(cleaned) > MAX_MEDIA_URLS_COUNT:
        raise ValidationError(
            f"media_urls cannot have more than {MAX_MEDIA_URLS_COUNT} items",
            field="media_urls",
        )
    validated: list[str] = []
    for url in cleaned:
        validated.append(_validate_url(url, "media_urls"))
    return sorted(validated)


def _validate_logo_media_url(
    logo_media_url: str | None,
    media_urls: list[str],
) -> str | None:
    """Validate that logo URL is in media URLs list."""
    if logo_media_url is None:
        return None
    logo_media_url = _validate_url(logo_media_url, "logo_media_url")
    if logo_media_url not in media_urls:
        raise ValidationError(
            "logo_media_url must match one of media_urls",
            field="logo_media_url",
        )
    return logo_media_url


def _validate_social_value(value: Any, field_name: str) -> str | None:
    """Validate a social field."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field_name} must be a string", field=field_name)
    value = value.strip()
    if not value:
        return None
    if len(value) > MAX_SOCIAL_VALUE_LENGTH:
        raise ValidationError(
            f"{field_name} must be at most {MAX_SOCIAL_VALUE_LENGTH} characters",
            field=field_name,
        )
    if value.startswith("http://") or value.startswith("https://"):
        return _validate_url(value, field_name)
    if not SOCIAL_HANDLE_RE.match(value):
        raise ValidationError(
            f"{field_name} must be a valid handle or URL",
            field=field_name,
        )
    return value


def validate_email(value: Any) -> str | None:
    """Validate email address."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError("email must be a string", field="email")
    value = value.strip().lower()
    if not value:
        return None
    if len(value) > MAX_EMAIL_LENGTH:
        raise ValidationError(
            f"email must be at most {MAX_EMAIL_LENGTH} characters",
            field="email",
        )
    if not EMAIL_RE.match(value):
        raise ValidationError("email must be a valid email address", field="email")
    return value


def validate_phone_region(value: Any) -> str | None:
    """Validate ISO 3166-1 alpha-2 region code for phone parsing (upper-case)."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError("phone_region must be a string", field="phone_region")
    value = value.strip().upper()
    if not value:
        return None
    if len(value) != MAX_PHONE_REGION_LENGTH:
        raise ValidationError(
            "phone_region must be 2 characters",
            field="phone_region",
        )

    import phonenumbers

    if value not in phonenumbers.SUPPORTED_REGIONS:
        raise ValidationError(
            "phone_region must be a valid ISO 3166-1 alpha-2 region code",
            field="phone_region",
        )
    return value


def validate_phone_fields(
    phone_region: Any, phone_number: Any
) -> tuple[str | None, str | None]:
    """Validate phone_region + phone_number; return (region upper, national digits only)."""
    if phone_region is None and phone_number is None:
        return None, None

    if phone_region is None:
        raise ValidationError("phone_region is required", field="phone_region")
    if phone_number is None:
        raise ValidationError("phone_number is required", field="phone_number")

    region = validate_phone_region(phone_region)
    if region is None:
        raise ValidationError("phone_region is required", field="phone_region")

    if not isinstance(phone_number, str):
        raise ValidationError("phone_number must be a string", field="phone_number")
    number = phone_number.strip()
    normalized_number = re.sub(r"\D", "", number)
    if not number:
        raise ValidationError("phone_number is required", field="phone_number")
    if number != normalized_number:
        raise ValidationError(
            "phone_number must contain digits only (no spaces or punctuation)",
            field="phone_number",
        )
    if len(normalized_number) > MAX_PHONE_NUMBER_LENGTH:
        raise ValidationError(
            f"phone_number must be at most {MAX_PHONE_NUMBER_LENGTH} digits",
            field="phone_number",
        )

    import phonenumbers
    from phonenumbers.phonenumberutil import NumberParseException

    try:
        parsed = phonenumbers.parse(normalized_number, region)
    except NumberParseException as exc:
        raise ValidationError(
            "phone_number must be a valid number",
            field="phone_number",
        ) from exc

    if not phonenumbers.is_valid_number(parsed):
        raise ValidationError(
            "phone_number is not valid for phone_region",
            field="phone_number",
        )

    national_number = phonenumbers.national_significant_number(parsed)
    return region, national_number


def _validate_currency(currency: str) -> str:
    """Validate currency code."""
    if not currency:
        return "HKD"

    if not isinstance(currency, str):
        currency = str(currency)
    currency = currency.strip().upper()

    if currency not in _valid_currencies():
        raise ValidationError(
            "currency must be a valid ISO 4217 code (e.g., HKD, USD, EUR)",
            field="currency",
        )
    return currency


def _validate_manager_id(manager_id: Any, required: bool = False) -> str | None:
    """Validate a manager_id as UUID string."""
    if manager_id is None:
        if required:
            raise ValidationError("manager_id is required", field="manager_id")
        return None
    if not isinstance(manager_id, str):
        manager_id = str(manager_id)

    manager_id = manager_id.strip()

    if not manager_id:
        if required:
            raise ValidationError("manager_id is required", field="manager_id")
        return None

    try:
        parsed = UUID(manager_id)
        return str(parsed)
    except (ValueError, TypeError) as exc:
        raise ValidationError(
            "manager_id must be a valid UUID (Cognito user sub)",
            field="manager_id",
        ) from exc


def _validate_language_code(code: str, field_name: str = "language") -> str:
    """Validate a language code."""
    if not code:
        raise ValidationError(f"{field_name} cannot be empty", field=field_name)

    if not isinstance(code, str):
        code = str(code)
    code = code.strip().lower()
    if len(code) > MAX_LANGUAGE_CODE_LENGTH:
        raise ValidationError(
            f"{field_name} must be at most {MAX_LANGUAGE_CODE_LENGTH} characters",
            field=field_name,
        )
    if code not in VALID_LANGUAGE_CODES:
        raise ValidationError(
            f"{field_name} must be a valid ISO 639-1 language code (e.g., en, zh)",
            field=field_name,
        )
    return code


def _validate_languages(languages: list[str]) -> list[str]:
    """Validate language code list."""
    if len(languages) > MAX_LANGUAGES_COUNT:
        raise ValidationError(
            f"languages cannot have more than {MAX_LANGUAGES_COUNT} items",
            field="languages",
        )
    validated: list[str] = []
    seen = set()
    for i, lang in enumerate(languages):
        if lang and str(lang).strip():
            code = _validate_language_code(str(lang).strip(), f"languages[{i}]")
            if code not in seen:
                validated.append(code)
                seen.add(code)
    return validated


def _validate_translations_map(
    value: Any,
    field_name: str,
    max_length: int,
) -> dict[str, str]:
    """Validate a language translation map."""
    if value is None:
        return {}

    if not isinstance(value, dict):
        raise ValidationError(f"{field_name} must be an object", field=field_name)

    if len(value) > MAX_LANGUAGES_COUNT:
        raise ValidationError(
            f"{field_name} cannot have more than {MAX_LANGUAGES_COUNT} items",
            field=field_name,
        )

    cleaned: dict[str, str] = {}
    for key, raw in value.items():
        code = _validate_language_code(str(key), f"{field_name}.{key}")
        if code == "en":
            continue
        text = validate_string_length(raw, f"{field_name}.{code}", max_length)
        if text is None:
            continue
        cleaned[code] = text
    return cleaned


def _parse_languages(value: Any) -> list[str]:
    """Parse and validate languages from JSON."""
    if value is None:
        return []
    if isinstance(value, list):
        languages = [str(item) for item in value if item]
    elif isinstance(value, str):
        languages = [item.strip() for item in value.split(",") if item.strip()]
    else:
        raise ValidationError(
            "languages must be a list or comma-separated string",
            field="languages",
        )

    return _validate_languages(languages)


def _parse_media_urls(value: Any) -> list[str]:
    """Parse media URLs from JSON."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    raise ValidationError(
        "media_urls must be a list or comma-separated string",
        field="media_urls",
    )
