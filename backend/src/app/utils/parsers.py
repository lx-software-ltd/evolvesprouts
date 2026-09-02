"""Shared parsing utilities for request handling."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any


def parse_datetime(value: str | None) -> datetime | None:
    """Parse an ISO-8601 datetime string.

    Handles both 'Z' suffix and '+00:00' timezone notation.

    Args:
        value: The ISO-8601 datetime string to parse, or None.

    Returns:
        The parsed datetime with timezone info, or None if input is None or empty.

    Raises:
        ValueError: If the string cannot be parsed as an ISO datetime.
    """
    if value is None or value == "":
        return None
    cleaned = value.replace("Z", "+00:00") if value.endswith("Z") else value
    return datetime.fromisoformat(cleaned)


def first_param(params: dict[str, list[str]], key: str) -> str | None:
    """Return the first query parameter value for a key.

    Args:
        params: Dictionary of parameter name to list of values.
        key: The parameter name to look up.

    Returns:
        The first value for the key, or None if not present.
    """
    values = params.get(key, [])
    return values[0] if values else None


def collect_query_params(event: Mapping[str, Any]) -> dict[str, list[str]]:
    """Collect query parameters from API Gateway events.

    Handles both single and multi-value query string parameters.

    Args:
        event: The API Gateway event dictionary.

    Returns:
        Dictionary mapping parameter names to lists of values.
    """
    params: dict[str, list[str]] = {}
    multi = event.get("multiValueQueryStringParameters") or {}
    if multi:
        for key, values in multi.items():
            if not values:
                continue
            filtered = [value for value in values if value is not None]
            if filtered:
                params[key] = filtered
        return params

    single = event.get("queryStringParameters") or {}
    for key, value in single.items():
        if value is not None:
            params[key] = [value]

    return params
