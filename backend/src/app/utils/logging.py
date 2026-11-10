"""Structured logging utilities for Lambda functions.

This module provides JSON-formatted logging with request context,
suitable for CloudWatch Logs Insights queries.

SECURITY NOTES:
- Use mask_email() when logging email addresses to comply with privacy regulations
- Use mask_pii() for other personally identifiable information
- Never log passwords, tokens, or secrets
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sys
import traceback
from collections.abc import MutableMapping
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any


def mask_email(email: str) -> str:
    """Mask an email address for safe logging.

    SECURITY: Email addresses are PII and should not be logged in plain text.
    This function masks the email while preserving enough info for debugging.

    Args:
        email: The email address to mask.

    Returns:
        A masked version like "jo***@***.com" or a hash for very short emails.

    Examples:
        >>> mask_email("john.doe@example.com")
        'jo***@***.com'
        >>> mask_email("a@b.co")
        'a***@***.co'
    """
    if not email or "@" not in email:
        return "***"

    local, domain = email.rsplit("@", 1)
    domain_parts = domain.rsplit(".", 1)

    # Show first 2 chars of local part (or 1 if short)
    visible_local = local[:2] if len(local) > 2 else local[:1]

    # Show TLD only
    tld = domain_parts[-1] if len(domain_parts) > 1 else ""

    return f"{visible_local}***@***.{tld}" if tld else f"{visible_local}***@***"


def mask_pii(value: str, visible_chars: int = 4) -> str:
    """Mask a PII value for safe logging.

    SECURITY: Use this for any personally identifiable information.

    Args:
        value: The value to mask.
        visible_chars: Number of characters to show at the start.

    Returns:
        A masked version showing only the first few characters.
    """
    if not value:
        return "***"
    if len(value) <= visible_chars:
        return value[0] + "***"
    return value[:visible_chars] + "***"


def hash_for_correlation(value: str) -> str:
    """Generate a short hash for log correlation without exposing PII.

    SECURITY: Use this when you need to correlate logs across requests
    without logging the actual PII value.

    Args:
        value: The value to hash (e.g., email address).

    Returns:
        A short hash suitable for log correlation.
    """
    return hashlib.sha256(value.encode()).hexdigest()[:12]


# Context variables for request tracking
request_id: ContextVar[str] = ContextVar("request_id", default="")
correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


def _logrecord_builtin_keys() -> frozenset[str]:
    """Attribute names managed by logging.LogRecord (not ``logger.*(..., extra=)``)."""
    sample = logging.LogRecord(
        name="",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg="",
        args=(),
        exc_info=None,
    )
    return frozenset(sample.__dict__.keys()) | frozenset({"message"})


_LOGRECORD_BUILTIN_KEYS = _logrecord_builtin_keys()
_SQL_LOG_MARKERS = (
    "[SQL:",
    "[parameters:",
    "(Background on this error at:",
)
_CONSTRAINT_NAME = re.compile(r"""constraint ["']([A-Za-z0-9_]+)["']""")


class StructuredLogFormatter(logging.Formatter):
    """JSON formatter for structured logging.

    Produces log entries compatible with CloudWatch Logs Insights,
    including request context and exception details.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Format a log record as JSON."""
        log_data: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Add request context if available
        req_id = request_id.get()
        if req_id:
            log_data["request_id"] = req_id

        corr_id = correlation_id.get()
        if corr_id:
            log_data["correlation_id"] = corr_id

        # Add source location for debug/error logs
        if record.levelno >= logging.DEBUG:
            log_data["source"] = {
                "file": record.filename,
                "line": record.lineno,
                "function": record.funcName,
            }

        # Add exception info if present. Database errors include bound
        # parameters, so those messages are reduced to the constraint name.
        if record.exc_info and record.exc_info[0] is not None:
            log_data["exception"] = _exception_fields(record.exc_info)

        # Merge ``logger.info(..., extra={...})`` fields (they become LogRecord attributes)
        for key, value in record.__dict__.items():
            if key in _LOGRECORD_BUILTIN_KEYS or key in log_data:
                continue
            log_data[key] = value

        # Some code may attach a dict as record.extra
        record_extra = getattr(record, "extra", None)
        if isinstance(record_extra, dict):
            for key, value in record_extra.items():
                if key not in log_data:
                    log_data[key] = value

        return json.dumps(log_data, default=str)


def _exception_fields(
    exc_info: tuple[type[BaseException], BaseException, Any],
) -> dict[str, Any]:
    """Return type, a safe message, and a traceback without SQL parameters."""
    _exc_type, exc, _tb = exc_info
    return {
        "type": type(exc).__name__,
        "message": _safe_exception_message(exc),
        "traceback": _safe_traceback(exc),
    }


def _safe_traceback(exc: BaseException) -> list[str]:
    """Format the cause chain, redacting each exception on its own."""
    lines: list[str] = []
    chain = list(reversed(_exception_chain(exc)))
    for index, (item, _reached_by_cause) in enumerate(chain):
        if index:
            caused_directly = chain[index - 1][1]
            if caused_directly:
                lines.append(
                    "The above exception was the direct cause "
                    "of the following exception:\n"
                )
            else:
                lines.append(
                    "During handling of the above exception, "
                    "another exception occurred:\n"
                )
        lines.append("Traceback (most recent call last):\n")
        if item.__traceback__ is not None:
            lines.extend(traceback.format_tb(item.__traceback__))
        lines.append(f"{type(item).__name__}: {_safe_exception_message(item)}\n")
    return lines


def _exception_chain(exc: BaseException) -> list[tuple[BaseException, bool]]:
    """Return the exception and its causes, outermost first.

    The boolean is true when this exception is the explicit ``__cause__``
    of the exception before it.
    """
    chain: list[tuple[BaseException, bool]] = [(exc, False)]
    seen = {id(exc)}
    current = exc
    while True:
        if current.__cause__ is not None:
            nxt: BaseException | None = current.__cause__
            explicit = True
        elif current.__suppress_context__ or current.__context__ is None:
            break
        else:
            nxt = current.__context__
            explicit = False
        if nxt is None or id(nxt) in seen:
            break
        seen.add(id(nxt))
        chain.append((nxt, explicit))
        current = nxt
    return chain


def _safe_exception_message(exc: BaseException) -> str:
    raw = str(exc)
    if not _is_database_exception_text(raw):
        return raw
    match = _CONSTRAINT_NAME.search(raw)
    if match is not None:
        return f"database constraint {match.group(1)}"
    return "database error"


def _is_database_exception_text(raw: str) -> bool:
    if any(marker in raw for marker in _SQL_LOG_MARKERS):
        return True
    return "DETAIL:" in raw and ("Key (" in raw or "constraint" in raw)


class ContextLogger(logging.LoggerAdapter):
    """Logger adapter that automatically includes context variables."""

    def process(
        self,
        msg: str,
        kwargs: MutableMapping[str, Any],
    ) -> tuple[str, MutableMapping[str, Any]]:
        """Process log message to include extra context."""
        extra = kwargs.get("extra", {})

        # Add any context passed to the adapter
        if self.extra:
            extra.update(self.extra)

        kwargs["extra"] = extra
        return msg, kwargs


def configure_logging(level: str | None = None) -> None:
    """Configure structured logging for Lambda execution.

    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR). Defaults to
               LOG_LEVEL environment variable or INFO.
    """
    log_level: str = level or os.getenv("LOG_LEVEL") or "INFO"

    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Add structured handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredLogFormatter())
    root_logger.addHandler(handler)

    # Reduce noise from libraries
    logging.getLogger("boto3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def get_logger(name: str, **extra: Any) -> ContextLogger:
    """Get a context-aware logger.

    Args:
        name: Logger name (typically __name__).
        **extra: Additional context to include in all log messages.

    Returns:
        A ContextLogger instance.
    """
    logger = logging.getLogger(name)
    return ContextLogger(logger, extra)


def set_request_context(
    req_id: str | None = None,
    corr_id: str | None = None,
) -> None:
    """Set request context for logging.

    Call this at the start of each Lambda invocation to set
    context that will be included in all log messages.

    Args:
        req_id: AWS request ID from Lambda context.
        corr_id: Correlation ID for distributed tracing.
    """
    if req_id:
        request_id.set(req_id)
    if corr_id:
        correlation_id.set(corr_id)


def clear_request_context() -> None:
    """Clear request context after Lambda invocation."""
    request_id.set("")
    correlation_id.set("")
