"""CloudFormation custom resource response helpers."""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from typing import Any
from collections.abc import Mapping
from urllib.parse import urlparse

from app.utils.logging import get_logger

logger = get_logger(__name__)


def send_cfn_response(
    event: Mapping[str, Any],
    context: Any,
    status: str,
    data: Mapping[str, Any] | None = None,
    physical_resource_id: str | None = None,
    reason: str | None = None,
) -> None:
    """Send a response for a CloudFormation custom resource.

    Uses urllib.request for HTTPS communication instead of low-level
    http.client.HTTPSConnection to satisfy security linting requirements.
    """
    response_url = str(event.get("ResponseURL", "")).strip()
    if not response_url:
        raise ValueError("Missing ResponseURL in CloudFormation event")
    _validate_response_url(response_url)

    response_body = {
        "Status": status,
        "Reason": _sanitize_reason(reason, context),
        "PhysicalResourceId": physical_resource_id or _default_physical_id(context),
        "StackId": event.get("StackId", ""),
        "RequestId": event.get("RequestId", ""),
        "LogicalResourceId": event.get("LogicalResourceId", ""),
        "Data": dict(data or {}),
    }
    body_bytes = json.dumps(response_body).encode("utf-8")

    # Create SSL context with secure defaults
    ssl_context = ssl.create_default_context()

    # Build request using urllib.request (preferred over http.client.HTTPSConnection)
    request = urllib.request.Request(
        response_url,
        data=body_bytes,
        method="PUT",
        headers={
            "Content-Type": "",
            "Content-Length": str(len(body_bytes)),
        },
    )

    try:
        # SECURITY: URL is validated by _validate_response_url() above:
        # 1. Must use HTTPS scheme (not file://, ftp://, etc.)
        # 2. Must have valid hostname
        # 3. Hostname must end with .amazonaws.com or .amazonaws.com.cn
        # This is safe because CloudFormation ResponseURLs are always S3 pre-signed URLs
        # and the validation prevents the file:// scheme attack vector.
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected  # noqa: E501
        with urllib.request.urlopen(  # nosec B310
            request,
            context=ssl_context,
        ) as response:
            response.read()
            logger.info(
                "Sent CloudFormation response",
                extra={
                    "status": status,
                    "http_status": response.status,
                    "logical_resource_id": response_body["LogicalResourceId"],
                },
            )
    except urllib.error.URLError:
        logger.error(
            "Failed to send CloudFormation response",
            extra={
                "status": status,
                "logical_resource_id": response_body["LogicalResourceId"],
            },
            exc_info=True,
        )
        raise


def _default_physical_id(context: Any) -> str:
    log_stream = ""
    if context:
        log_stream = getattr(context, "log_stream_name", "")
    return log_stream or "custom-resource"


def _sanitize_reason(reason: str | None, context: Any) -> str:
    if reason:
        safe_reason = reason
    else:
        log_stream = ""
        if context:
            log_stream = getattr(context, "log_stream_name", "")
        safe_reason = f"See CloudWatch Logs: {log_stream}" if log_stream else "See logs"
    return safe_reason[:256]


def _validate_response_url(response_url: str) -> None:
    parsed = urlparse(response_url)
    if parsed.scheme != "https":
        raise ValueError("CloudFormation ResponseURL must use https")
    hostname = parsed.hostname or ""
    if not hostname:
        raise ValueError("CloudFormation ResponseURL is missing hostname")
    allowed_suffixes = (".amazonaws.com", ".amazonaws.com.cn")
    if not hostname.endswith(allowed_suffixes):
        raise ValueError("CloudFormation ResponseURL hostname is invalid")
