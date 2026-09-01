"""Meta Graph Conversations API client via the outbound AWS HTTP proxy."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlencode

from app.services.aws_proxy import AwsProxyError, http_invoke
from app.services.aws_clients import get_secretsmanager_client
from app.utils.logging import get_logger
from app.utils.retry import run_with_retry

logger = get_logger(__name__)

_DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com"
_DEFAULT_GRAPH_VERSION = "v21.0"


class MetaGraphApiError(RuntimeError):
    """Raised when a Graph API request fails."""

    def __init__(self, *, status_code: int, message: str) -> None:
        self.status_code = status_code
        super().__init__(message)


def graph_base_url() -> str:
    """Return the configured Graph API origin (no trailing path)."""
    raw = os.getenv("META_GRAPH_API_BASE_URL", "").strip() or _DEFAULT_GRAPH_BASE_URL
    return raw.rstrip("/")


def graph_api_version() -> str:
    """Return the configured Graph API version token."""
    raw = os.getenv("META_GRAPH_API_VERSION", "").strip() or _DEFAULT_GRAPH_VERSION
    return raw.lstrip("/")


def load_page_access_token() -> str:
    """Load the Page access token from env or Secrets Manager JSON/plain text."""
    direct = os.getenv("META_PAGE_ACCESS_TOKEN", "").strip()
    if direct:
        return direct
    secret_arn = os.getenv("META_PAGE_ACCESS_TOKEN_SECRET_ARN", "").strip()
    if not secret_arn:
        raise MetaGraphApiError(
            status_code=500,
            message="Meta page access token is not configured",
        )
    response = get_secretsmanager_client().get_secret_value(SecretId=secret_arn)
    secret_str = str(response.get("SecretString") or "").strip()
    if not secret_str:
        raise MetaGraphApiError(
            status_code=500,
            message="Meta page access token secret is empty",
        )
    try:
        parsed = json.loads(secret_str)
    except json.JSONDecodeError:
        return secret_str
    if isinstance(parsed, dict):
        token = str(parsed.get("token") or parsed.get("access_token") or "").strip()
        if token:
            return token
    raise MetaGraphApiError(
        status_code=500,
        message="Meta page access token secret is missing token",
    )


def graph_get(
    path: str,
    *,
    params: dict[str, str] | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    """GET a Graph path through the AWS HTTP proxy with retry on 429/5xx."""
    access_token = token or load_page_access_token()
    query = dict(params or {})
    encoded = urlencode(query)
    suffix = f"?{encoded}" if encoded else ""
    url = f"{graph_base_url()}/{graph_api_version()}/{path.lstrip('/')}{suffix}"

    def _call() -> dict[str, Any]:
        try:
            response = http_invoke(
                method="GET",
                url=url,
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=25,
            )
        except AwsProxyError as exc:
            raise MetaGraphApiError(
                status_code=502,
                message=f"Meta Graph proxy call failed: {exc.code}",
            ) from exc
        status_code = int(response.get("status") or 0)
        raw_body = str(response.get("body") or "").strip()
        parsed: dict[str, Any] = {}
        if raw_body:
            try:
                candidate = json.loads(raw_body)
            except json.JSONDecodeError:
                candidate = None
            if isinstance(candidate, dict):
                parsed = candidate
        if status_code < 200 or status_code >= 300:
            error_payload = parsed.get("error")
            error = error_payload if isinstance(error_payload, dict) else {}
            detail = str(error.get("message") or raw_body[:400] or status_code)
            if status_code == 401:
                detail = (
                    f"{detail}. META_PAGE_ACCESS_TOKEN must be a Graph Page "
                    "or system-user access token, not the webhook verify string."
                )
            raise MetaGraphApiError(
                status_code=status_code,
                message=f"Meta Graph request failed ({status_code}): {detail}",
            )
        return parsed

    return run_with_retry(
        _call,
        max_attempts=4,
        base_delay_seconds=1.0,
        should_retry=_is_retryable_graph_error,
        logger=logger,
        operation_name="meta.graph.get",
    )


def _is_retryable_graph_error(exc: Exception) -> bool:
    if isinstance(exc, MetaGraphApiError):
        return exc.status_code == 429 or exc.status_code >= 500
    return isinstance(exc, (ConnectionError, TimeoutError))
