"""Custom exception classes for the application.

This module provides domain-specific exception classes that carry
appropriate HTTP status codes and structured error information.
"""

from __future__ import annotations

from typing import Any

_PROBLEMS = {
    400: ("invalid_request", "Bad Request"),
    401: ("unauthenticated", "Unauthorized"),
    403: ("forbidden", "Forbidden"),
    404: ("not_found", "Not Found"),
    405: ("method_not_allowed", "Method Not Allowed"),
    409: ("conflict", "Conflict"),
    429: ("rate_limited", "Too Many Requests"),
    500: ("internal_error", "Internal Server Error"),
}


def problem_body(
    status_code: int,
    message: str,
    detail: str | None = None,
    request_id: str = "",
    field: str | None = None,
) -> dict[str, Any]:
    """Error body for /v1. Omit ``detail`` when it repeats ``error``."""
    code, title = _PROBLEMS.get(status_code, ("error", "Error"))
    body: dict[str, Any] = {
        "type": "about:blank",
        "title": title,
        "status": status_code,
        "code": code,
        "request_id": request_id,
        "error": message,
    }
    if detail and detail != message:
        body["detail"] = detail
    if field:
        body["field"] = field
        body["errors"] = [{"field": field, "message": message}]
    return body


class AppError(Exception):
    """Base exception for application errors.

    All application-specific exceptions should inherit from this class.
    Each exception carries an HTTP status code and optional details.

    Attributes:
        message: Human-readable error message.
        status_code: HTTP status code (default 500).
        detail: Optional additional context.
    """

    def __init__(
        self,
        message: str,
        status_code: int = 500,
        detail: str | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.detail = detail

    def to_dict(self) -> dict[str, Any]:
        """Convert exception to API response body."""
        return problem_body(
            self.status_code,
            self.message,
            self.detail,
            field=getattr(self, "field", None),
        )


class ValidationError(AppError):
    """Raised when input validation fails.

    Use for malformed requests, invalid parameter values,
    or constraint violations in user input.
    """

    def __init__(
        self, message: str, field: str | None = None, *, status_code: int = 400
    ):
        detail = f"Field: {field}" if field else None
        super().__init__(message, status_code=status_code, detail=detail)
        self.field = field


class ConflictError(AppError):
    """HTTP 409 with structured body (``error`` plus optional keys)."""

    def __init__(self, code: str, **extra: Any):
        super().__init__(code, status_code=409)
        self._extra = {k: v for k, v in extra.items() if v is not None}

    def to_dict(self) -> dict[str, Any]:
        out = super().to_dict()
        out.update(self._extra)
        return out


class NotFoundError(AppError):
    """Raised when a requested resource is not found.

    Use when a specific entity lookup fails (e.g., by ID).
    """

    def __init__(self, resource: str, identifier: str):
        super().__init__(
            f"{resource} not found: {identifier}",
            status_code=404,
        )
        self.resource = resource
        self.identifier = identifier


class AuthorizationError(AppError):
    """Raised when authorization fails.

    Use when the user is authenticated but lacks permission
    for the requested action.
    """

    def __init__(self, message: str = "Forbidden"):
        super().__init__(message, status_code=403)


class AuthenticationError(AppError):
    """Raised when authentication fails.

    Use when credentials are missing or invalid.
    """

    def __init__(self, message: str = "Unauthorized"):
        super().__init__(message, status_code=401)


class ConfigurationError(AppError):
    """Raised when required configuration is missing.

    Use when environment variables or settings are not properly configured.
    """

    def __init__(self, config_name: str):
        super().__init__(
            f"Missing required configuration: {config_name}",
            status_code=500,
        )
        self.config_name = config_name


class DatabaseError(AppError):
    """Raised when a database operation fails.

    Use for connection errors, query failures, or constraint violations.
    """

    def __init__(self, message: str, detail: str | None = None):
        super().__init__(
            message,
            status_code=500,
            detail=detail,
        )


class RateLimitError(AppError):
    """Raised when rate limits are exceeded.

    Use when the client has made too many requests.
    """

    def __init__(self, message: str = "Rate limit exceeded"):
        super().__init__(message, status_code=429)


class CursorError(ValidationError):
    """Raised when a pagination cursor is invalid.

    Use when cursor parsing or validation fails.
    """

    def __init__(self, detail: str | None = None):
        super().__init__("Invalid cursor", field="cursor")
        self.detail = detail
