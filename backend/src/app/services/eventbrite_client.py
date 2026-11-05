"""Eventbrite API client helpers."""

from __future__ import annotations

import json
from typing import Any

from app.services.aws_proxy import AwsProxyError, http_invoke
from app.utils.logging import get_logger
from app.utils.retry import run_with_retry

logger = get_logger(__name__)


class EventbriteApiError(RuntimeError):
    """Raised when an Eventbrite API request fails."""

    def __init__(self, *, status_code: int, message: str) -> None:
        self.status_code = status_code
        super().__init__(message)


def eventbrite_request(
    *,
    method: str,
    base_url: str,
    path: str,
    token: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Perform one Eventbrite API request through the AWS proxy."""

    def _call() -> dict[str, Any]:
        body = json.dumps(payload) if payload is not None else None
        headers = {"Authorization": f"Bearer {token}"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        try:
            response = http_invoke(
                method=method,
                url=f"{base_url.rstrip('/')}{path}",
                headers=headers,
                body=body,
                timeout=20,
            )
        except AwsProxyError as exc:
            raise EventbriteApiError(
                status_code=502, message=f"Eventbrite proxy call failed: {exc.code}"
            ) from exc

        status_code = int(response.get("status") or 0)
        raw_body = str(response.get("body") or "").strip()
        parsed_body: dict[str, Any] | None = None
        if raw_body:
            try:
                candidate = json.loads(raw_body)
                if isinstance(candidate, dict):
                    parsed_body = candidate
            except json.JSONDecodeError:
                parsed_body = None

        if status_code < 200 or status_code >= 300:
            detail = ""
            if parsed_body is not None:
                detail = str(
                    parsed_body.get("error_description")
                    or parsed_body.get("error")
                    or ""
                )
            if not detail:
                detail = raw_body[:500]
            raise EventbriteApiError(
                status_code=status_code,
                message=f"Eventbrite API request failed ({status_code}): {detail}",
            )

        return parsed_body or {}

    return run_with_retry(
        _call,
        max_attempts=4,
        base_delay_seconds=1.0,
        should_retry=_is_retryable_eventbrite_error,
        logger=logger,
        operation_name=f"eventbrite.{method.lower()}",
    )


def _is_retryable_eventbrite_error(exc: Exception) -> bool:
    if isinstance(exc, EventbriteApiError):
        return exc.status_code == 429 or exc.status_code >= 500
    return isinstance(exc, (ConnectionError, TimeoutError))
