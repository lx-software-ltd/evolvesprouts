"""AWS / HTTP proxy – handler and client.

The *handler* runs in a Lambda outside the VPC and executes allow-listed
requests on behalf of callers that cannot reach public endpoints from
inside the VPC.

Two request types are supported:

**AWS API calls** (``type: "aws"`` or implicit format without ``type``):
    Executes a boto3 call.  Gated by ``ALLOWED_ACTIONS`` (comma-separated
    ``service:action`` pairs).

**HTTP requests** (``type: "http"``):
    Makes an outbound HTTP request.  Gated by ``ALLOWED_HTTP_URLS``
    (comma-separated URL prefixes).  Only URLs that start with one of
    the prefixes are allowed.

The *client* functions (``invoke`` / ``http_invoke``) are imported by
in-VPC Lambdas to call the proxy via Lambda-to-Lambda.

Environment (proxy Lambda):
    ALLOWED_ACTIONS    e.g. ``cognito-idp:list_users,cognito-idp:admin_get_user``
    ALLOWED_HTTP_URLS  e.g. ``https://api.example.com/v1/,https://other.io/``
"""

from __future__ import annotations

import json
import os
from typing import Any
from collections.abc import Mapping
from urllib.parse import urlparse

from app.services.aws_clients import get_client

from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


# ======================================================================
# Proxy handler (runs in the proxy Lambda outside VPC)
# ======================================================================

_ALLOWED_ACTIONS: set[str] | None = None
_ALLOWED_HTTP_URLS: list[str] | None = None
_HTTP_PROXY_USER_AGENT = "EvolveSproutsProxy/1.0"


def _get_allowed_actions() -> set[str]:
    global _ALLOWED_ACTIONS
    if _ALLOWED_ACTIONS is None:
        raw = os.getenv("ALLOWED_ACTIONS", "")
        _ALLOWED_ACTIONS = {a.strip() for a in raw.split(",") if a.strip()}
    return _ALLOWED_ACTIONS


def _get_allowed_http_urls() -> list[str]:
    global _ALLOWED_HTTP_URLS
    if _ALLOWED_HTTP_URLS is None:
        raw = os.getenv("ALLOWED_HTTP_URLS", "")
        _ALLOWED_HTTP_URLS = [u.strip() for u in raw.split(",") if u.strip()]
    return _ALLOWED_HTTP_URLS


def proxy_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    """Route to the correct handler based on request type."""
    req_type = event.get("type", "aws")

    if req_type == "http":
        return _handle_http(event)
    return _handle_aws(event)


# ------------------------------------------------------------------
# AWS API handler
# ------------------------------------------------------------------


def _handle_aws(event: Mapping[str, Any]) -> dict[str, Any]:
    """Execute an allow-listed boto3 call and return the result."""

    service: str = event.get("service", "")
    action: str = event.get("action", "")
    params: dict[str, Any] = event.get("params") or {}

    key = f"{service}:{action}"
    allowed = _get_allowed_actions()

    if key not in allowed:
        logger.warning(f"Blocked disallowed AWS action: {key}")
        return {
            "error": {
                "code": "ActionNotAllowed",
                "message": f"{key} is not in the proxy allow-list",
            },
        }

    logger.info(f"Proxying AWS {key}")

    try:
        client = get_client(service)  # type: ignore[call-overload]
        method = getattr(client, action, None)
        if method is None:
            return {
                "error": {
                    "code": "InvalidAction",
                    "message": f"{action} is not a valid method on {service}",
                },
            }
        result = method(**params)
        result.pop("ResponseMetadata", None)
        return {"result": json.loads(json.dumps(result, default=str))}
    except Exception as exc:
        code = (
            getattr(exc, "response", {})
            .get("Error", {})
            .get("Code", type(exc).__name__)
        )
        message = str(exc)
        logger.warning(f"Proxy AWS call {key} failed: {code}: {message}")
        return {"error": {"code": code, "message": message}}


# ------------------------------------------------------------------
# HTTP handler
# ------------------------------------------------------------------


def _handle_http(event: Mapping[str, Any]) -> dict[str, Any]:
    """Execute an allow-listed outbound HTTP request.

    Expected event fields:
        type:    "http"
        method:  HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD)
        url:     Full URL
        headers: Optional dict of request headers
        body:    Optional request body (string)
        timeout: Optional timeout in seconds (default 10, max 60)
    """
    import urllib.request
    import urllib.error

    method: str = (event.get("method") or "GET").upper()
    url: str = event.get("url") or ""
    headers: dict[str, str] = event.get("headers") or {}
    body: str | None = event.get("body")
    timeout: int = min(int(event.get("timeout") or 10), 60)

    if not any(k.lower() == "user-agent" for k in headers):
        headers["User-Agent"] = _HTTP_PROXY_USER_AGENT

    if not url:
        return {"error": {"code": "MissingURL", "message": "url is required"}}

    # Validate URL scheme
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http"):
        return {
            "error": {
                "code": "InvalidURL",
                "message": "Only http and https URLs are allowed",
            },
        }

    # Check against allow-list
    allowed_prefixes = _get_allowed_http_urls()
    if not any(url.startswith(prefix) for prefix in allowed_prefixes):
        logger.warning(f"Blocked disallowed HTTP URL: {url}")
        return {
            "error": {
                "code": "URLNotAllowed",
                "message": "URL is not in the proxy allow-list",
            },
        }

    logger.info(f"Proxying HTTP {method} {url}")

    try:
        encoded_body = body.encode("utf-8") if body else None
        req = urllib.request.Request(
            url,
            data=encoded_body,
            headers=headers,
            method=method,
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp_body = resp.read().decode("utf-8", errors="replace")
            resp_headers = dict(resp.getheaders())
            return {
                "result": {
                    "status": resp.status,
                    "headers": resp_headers,
                    "body": resp_body,
                },
            }
    except urllib.error.HTTPError as exc:
        resp_body = ""
        try:
            resp_body = exc.read().decode("utf-8", errors="replace")
        except Exception:  # nosec B110 - best-effort body read; empty string is fine
            resp_body = ""
        return {
            "result": {
                "status": exc.code,
                "headers": dict(exc.headers) if exc.headers else {},
                "body": resp_body,
            },
        }
    except Exception as exc:
        logger.warning(f"HTTP request failed: {type(exc).__name__}: {exc}")
        return {
            "error": {
                "code": type(exc).__name__,
                "message": str(exc),
            },
        }


# ======================================================================
# Client (imported by in-VPC Lambdas)
# ======================================================================


class AwsProxyError(Exception):
    """Raised when the proxy returns an error."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


# Module-level cache
_lambda_client: Any = None
_proxy_arn: str | None = None


def _get_proxy_arn() -> str:
    global _proxy_arn
    if _proxy_arn is None:
        _proxy_arn = os.getenv("AWS_PROXY_FUNCTION_ARN", "")
    if not _proxy_arn:
        raise RuntimeError("AWS_PROXY_FUNCTION_ARN is not configured")
    return _proxy_arn


def _get_lambda_client() -> Any:
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = get_client("lambda")
    return _lambda_client


def _invoke_proxy(payload: dict[str, Any]) -> dict[str, Any]:
    """Low-level invoke of the proxy Lambda.  Returns the parsed body."""
    resp = _get_lambda_client().invoke(
        FunctionName=_get_proxy_arn(),
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode(),
    )

    body = json.loads(resp["Payload"].read())

    if resp.get("FunctionError"):
        raise AwsProxyError("LambdaInvocationError", str(body))

    err = body.get("error")
    if err:
        raise AwsProxyError(err.get("code", "Unknown"), err.get("message", ""))

    return body.get("result", {})


def invoke(service: str, action: str, params: dict[str, Any]) -> dict[str, Any]:
    """Call an AWS API via the proxy Lambda.

    Returns:
        The boto3 response dict (without ``ResponseMetadata``).

    Raises:
        AwsProxyError: on proxy or AWS API failure.
        RuntimeError:  if the proxy ARN is not configured.
    """
    return _invoke_proxy(
        {"type": "aws", "service": service, "action": action, "params": params}
    )


def http_invoke(
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    body: str | None = None,
    timeout: int = 10,
) -> dict[str, Any]:
    """Make an HTTP request via the proxy Lambda.

    Returns:
        ``{"status": int, "headers": dict, "body": str}``

    Raises:
        AwsProxyError: on proxy-level failure (not HTTP errors – those
                       are returned in the result with the status code).
        RuntimeError:  if the proxy ARN is not configured.
    """
    return _invoke_proxy(
        {
            "type": "http",
            "method": method,
            "url": url,
            "headers": headers or {},
            "body": body,
            "timeout": timeout,
        }
    )
