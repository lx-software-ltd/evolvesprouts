"""Input validation utilities."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any
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
