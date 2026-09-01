"""Input validation utilities."""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import unquote, urlparse
from uuid import UUID


def validate_uuid(value: str, field_name: str = "id") -> UUID:
    """Validate and parse a UUID string.

    Args:
        value: The string to validate as a UUID.
        field_name: Name of the field for error messages.

    Returns:
        The parsed UUID.

    Raises:
        ValueError: If the string is not a valid UUID.
    """
    try:
        return UUID(value)
    except (ValueError, TypeError) as e:
        raise ValueError(f"Invalid {field_name}: must be a valid UUID") from e


def validate_email(value: str) -> str:
    """Validate an email address.

    Args:
        value: The email address to validate.

    Returns:
        The lowercase email address.

    Raises:
        ValueError: If the email address is invalid.
    """
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    if not re.match(pattern, value):
        raise ValueError("Invalid email address")
    return value.lower()


def validate_range(
    value: int,
    min_val: int,
    max_val: int,
    field_name: str,
) -> int:
    """Validate a numeric value is within range.

    Args:
        value: The value to validate.
        min_val: Minimum allowed value (inclusive).
        max_val: Maximum allowed value (inclusive).
        field_name: Name of the field for error messages.

    Returns:
        The validated value.

    Raises:
        ValueError: If the value is out of range.
    """
    if not min_val <= value <= max_val:
        raise ValueError(f"{field_name} must be between {min_val} and {max_val}")
    return value


_INSTAGRAM_HANDLE_MAX_LENGTH = 30
_INSTAGRAM_HANDLE_RE = re.compile(r"^[a-z0-9._]{1,30}$")
_IGSID_LIKE_DIGIT_LENGTH = 15
_RESERVED_INSTAGRAM_PATHS = frozenset(
    {
        "p",
        "reel",
        "reels",
        "stories",
        "explore",
        "accounts",
        "direct",
        "about",
        "legal",
    }
)


def instagram_handle_for_storage(value: str | None) -> str | None:
    """Return a stored Instagram handle: no leading ``@``, lowercased.

    Empty or whitespace-only input returns ``None``. Does not validate charset.
    """
    if value is None:
        return None
    trimmed = str(value).strip().lstrip("@").strip()
    if not trimmed:
        return None
    return trimmed.lower()


def parse_instagram_username(
    value: str | None,
    *,
    platform_user_id: str | None = None,
) -> str | None:
    """Return a handle suitable for ``contacts.instagram_handle``, or ``None``.

    Rejects display names, IGSID/PSID copies, and values that are not Instagram
    username characters. Never stores a leading ``@``.
    """
    handle = instagram_handle_for_storage(value)
    if handle is None or len(handle) > _INSTAGRAM_HANDLE_MAX_LENGTH:
        return None
    if not _INSTAGRAM_HANDLE_RE.fullmatch(handle):
        return None
    if handle.isdigit() and len(handle) >= _IGSID_LIKE_DIGIT_LENGTH:
        return None
    if platform_user_id is not None:
        scoped = str(platform_user_id).strip().lower()
        if scoped and handle == scoped:
            return None
    return handle


def extract_instagram_username(
    event: Mapping[str, Any],
    message: Mapping[str, Any],
    *,
    platform_user_id: str,
) -> str | None:
    """Return the first valid Instagram username from a Meta payload."""
    values: list[str] = []
    sender = event.get("sender")
    if isinstance(sender, Mapping):
        username = sender.get("username")
        if isinstance(username, str) and username.strip():
            values.append(username)
    for key in ("username", "from"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            values.append(value)
        elif isinstance(value, Mapping):
            nested = value.get("username")
            if isinstance(nested, str) and nested.strip():
                values.append(nested)
    for raw in values:
        handle = parse_instagram_username(raw, platform_user_id=platform_user_id)
        if handle is not None:
            return handle
    return None


def instagram_handle_from_profile_url(raw: str | None) -> str | None:
    """Return the last Instagram path segment, or a bare handle, lowercased."""
    if not isinstance(raw, str):
        return None
    stripped = raw.strip()
    if not stripped:
        return None
    if "://" not in stripped and "/" not in stripped.lstrip("@"):
        handle = stripped.lstrip("@").strip().strip("/")
        return handle.lower() or None
    candidate = stripped if "://" in stripped else f"https://{stripped.lstrip('/')}"
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None
    parts = [unquote(part) for part in parsed.path.split("/") if part]
    if not parts:
        return None
    handle = parts[0].lstrip("@").strip()
    if not handle or handle.lower() in _RESERVED_INSTAGRAM_PATHS:
        return None
    return handle.lower()


def own_instagram_handle() -> str | None:
    """Business Instagram handle from PUBLIC_WWW / NEXT_PUBLIC profile URL."""
    from app.config.public_www import get_public_www

    raw = get_public_www("INSTAGRAM_URL")
    if not (isinstance(raw, str) and raw.strip()):
        raw = os.getenv("NEXT_PUBLIC_INSTAGRAM_URL", "")
    return instagram_handle_from_profile_url(raw)


def is_own_instagram_handle(name: str | None) -> bool:
    """True when *name* is the configured business Instagram handle."""
    handle = own_instagram_handle()
    if not handle or not isinstance(name, str):
        return False
    normalized = name.strip().lstrip("@").lower()
    return bool(normalized) and normalized == handle


def sanitize_string(
    value: str | None,
    max_length: int = 1000,
    strip: bool = True,
) -> str | None:
    """Sanitize a string input.

    Args:
        value: The string to sanitize, or None.
        max_length: Maximum allowed length.
        strip: Whether to strip whitespace.

    Returns:
        The sanitized string, or None if input is None.

    Raises:
        ValueError: If the string exceeds max_length.
    """
    if value is None:
        return None
    if strip:
        value = value.strip()
    if len(value) > max_length:
        raise ValueError(f"Value exceeds maximum length of {max_length}")
    return value if value else None
