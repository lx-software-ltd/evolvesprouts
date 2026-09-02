"""Utility modules for the backend application."""

import os

from app.exceptions import ConfigurationError
from app.utils.parsers import (
    parse_datetime,
    parse_decimal,
    parse_enum,
    parse_int,
)
from app.utils.public_http_cache import (
    CACHE_CONTROL_EDGE_CACHEABLE_GET,
    CACHE_CONTROL_NO_STORE,
    public_cacheable_json_response,
)
from app.utils.responses import (
    get_cors_headers,
    get_security_headers,
    json_response,
    method_not_allowed,
    not_found,
    validate_content_type,
)
from app.utils.validators import (
    sanitize_string,
    validate_email,
    validate_range,
    validate_uuid,
)
from app.utils.logging import (
    clear_request_context,
    configure_logging,
    get_logger,
    hash_for_correlation,
    mask_email,
    mask_pii,
    set_request_context,
)
from app.utils.retry import run_with_retry


def require_env(name: str) -> str:
    """Read a required environment variable or raise ConfigurationError."""
    value = os.getenv(name, "").strip()
    if not value:
        raise ConfigurationError(name)
    return value


__all__ = [
    "CACHE_CONTROL_EDGE_CACHEABLE_GET",
    "CACHE_CONTROL_NO_STORE",
    "clear_request_context",
    "configure_logging",
    "get_cors_headers",
    "get_logger",
    "get_security_headers",
    "hash_for_correlation",
    "json_response",
    "mask_email",
    "mask_pii",
    "method_not_allowed",
    "not_found",
    "parse_datetime",
    "parse_decimal",
    "parse_enum",
    "parse_int",
    "public_cacheable_json_response",
    "require_env",
    "run_with_retry",
    "sanitize_string",
    "set_request_context",
    "validate_content_type",
    "validate_email",
    "validate_range",
    "validate_uuid",
]
