"""Shared response utilities for Lambda handlers."""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from typing import Any
from collections.abc import Mapping


from pydantic import BaseModel

from app.exceptions import ValidationError


def api_gateway_http_method(event: Mapping[str, Any]) -> str:
    """Return the HTTP method from a Lambda proxy event, uppercased.

    Supports API Gateway REST (``httpMethod``) and HTTP API v2
    (``requestContext.http.method``). Returns an empty string when absent.
    """
    raw = event.get("httpMethod")
    if isinstance(raw, str) and raw.strip():
        return raw.strip().upper()
    request_context = event.get("requestContext")
    if isinstance(request_context, Mapping):
        http = request_context.get("http")
        if isinstance(http, Mapping):
            nested = http.get("method")
            if isinstance(nested, str) and nested.strip():
                return nested.strip().upper()
    return ""


def validate_content_type(
    event: Mapping[str, Any],
    required_methods: tuple[str, ...] = ("POST", "PUT", "PATCH"),
) -> None:
    """Validate Content-Type header for requests that require a body.

    SECURITY: This prevents content-type confusion attacks and ensures
    the server only processes requests with the expected content type.

    Args:
        event: The Lambda event containing headers and method.
        required_methods: HTTP methods that require Content-Type validation.

    Raises:
        ValidationError: If Content-Type is missing or not application/json.
    """
    method = api_gateway_http_method(event)
    if method not in required_methods:
        return

    headers = event.get("headers") or {}

    raw_body = event.get("body")
    has_body = False
    if isinstance(raw_body, str):
        has_body = bool(raw_body.strip())
    elif raw_body is not None:
        has_body = True

    # Some endpoints use POST/PUT without a request body (for example
    # action-style routes). Only enforce Content-Type when a body exists.
    if not has_body:
        return

    # Get Content-Type header case-insensitively
    content_type = None
    for key, value in headers.items():
        if key.lower() == "content-type":
            content_type = str(value).lower().strip()
            break

    if not content_type:
        raise ValidationError(
            "Content-Type header is required for requests with a body",
            field="Content-Type",
        )

    # Check if it's JSON (allowing for charset parameters like "application/json; charset=utf-8")
    if not content_type.startswith("application/json"):
        raise ValidationError(
            "Content-Type must be application/json",
            field="Content-Type",
        )


def _caller_supplies_shared_friendly_cache_control(cache_control: str) -> bool:
    """True when caller overrides default no-store security caching for shared caches."""
    lowered = cache_control.lower()
    if "public" in lowered:
        return True
    if "no-store" in lowered or "no-cache" in lowered:
        return False
    if "max-age" in lowered or "s-maxage" in lowered:
        return True
    return False


def get_security_headers() -> dict[str, str]:
    """Get security headers for all responses.

    SECURITY: These headers protect against common web vulnerabilities:
    - X-Content-Type-Options: Prevents MIME type sniffing
    - X-Frame-Options: Prevents clickjacking
    - X-XSS-Protection: Enables browser XSS filter (older browsers)
    - Cache-Control: Prevents caching of sensitive data

    Returns:
        Dictionary of security headers.
    """
    return {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
    }


def get_cors_headers(
    event: Mapping[str, Any] | None = None,
) -> dict[str, str]:
    """Get CORS headers for the response.

    Args:
        event: The Lambda event containing the request origin header.

    Returns:
        Dictionary of CORS headers to include in the response.
    """
    # Read allowlist from environment only; infrastructure must provide
    # CORS_ALLOWED_ORIGINS to keep runtime and API Gateway behavior aligned.
    allowed_origins_env = os.getenv("CORS_ALLOWED_ORIGINS", "")
    allowed_origins = [
        origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()
    ]

    # Get the request origin
    request_origin = None
    if event:
        headers = event.get("headers") or {}
        # Headers may be case-insensitive, check both
        request_origin = headers.get("origin") or headers.get("Origin")

    # If the request origin is in our allowed list, return it
    # Otherwise, return the first allowed origin (for non-browser clients)
    if request_origin and request_origin in allowed_origins:
        allow_origin: str | None = request_origin
    elif allowed_origins:
        # For requests without an Origin header (like curl), we can't
        # return a specific origin. Return the first one for preflight
        # compatibility, but browsers will handle this correctly.
        allow_origin = allowed_origins[0]
    else:
        allow_origin = None

    headers = {
        "Access-Control-Allow-Headers": (
            "Content-Type,Authorization,X-Amz-Date,X-Api-Key,"
            "X-Amz-Security-Token,X-Turnstile-Token"
        ),
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        # Chromium Private Network Access: browsers may send
        # Access-Control-Request-Private-Network on preflight; without this
        # allow header, requests fail with "local address space" CORS errors.
        "Access-Control-Allow-Private-Network": "true",
    }
    if allow_origin:
        headers["Access-Control-Allow-Origin"] = allow_origin
        headers["Vary"] = "Origin"
    return headers


def json_response(
    status_code: int,
    body: Any,
    headers: dict[str, str] | None = None,
    event: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a JSON API Gateway response.

    Args:
        status_code: HTTP status code.
        body: Response body (dict, Pydantic model, or dataclass).
        headers: Optional additional headers to include.
        event: Optional Lambda event for CORS origin detection.

    Returns:
        API Gateway response dictionary.
    """
    response_headers = {
        "Content-Type": "application/json",
    }

    # Add security headers
    response_headers.update(get_security_headers())

    # Add CORS headers
    response_headers.update(get_cors_headers(event))

    if headers:
        response_headers.update(headers)
        cc = headers.get("Cache-Control")
        if isinstance(cc, str) and _caller_supplies_shared_friendly_cache_control(cc):
            # Security defaults include Pragma: no-cache for sensitive JSON; strip it
            # when the handler opts into shared edge caching so intermediaries are not
            # confused by contradictory directives (see RFC 7234).
            response_headers.pop("Pragma", None)

    payload = _serialize_body(body)

    return {
        "statusCode": status_code,
        "headers": response_headers,
        "body": json.dumps(payload, default=str),
    }


def _serialize_body(body: Any) -> Any:
    """Serialize response body to JSON-compatible format.

    Args:
        body: The body to serialize.

    Returns:
        JSON-serializable representation of the body.
    """
    if isinstance(body, BaseModel):
        if hasattr(body, "model_dump"):
            return body.model_dump()
        return body.dict()

    if hasattr(body, "__dataclass_fields__"):
        return asdict(body)

    return body


def not_found(
    event: Mapping[str, Any] | None = None,
    *,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Standard 404 body for unmatched routes or resources."""
    return json_response(404, {"error": "Not found"}, headers=headers, event=event)


def method_not_allowed(
    event: Mapping[str, Any] | None = None,
    *,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Standard 405 body for a known route with an unsupported HTTP method."""
    return json_response(
        405, {"error": "Method not allowed"}, headers=headers, event=event
    )
