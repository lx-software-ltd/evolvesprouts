"""Shared HTTP cache headers for public GET handlers behind CloudFront ``/api/*``.

Handlers reachable via the website proxy must emit ``Cache-Control`` on every
response path: a shared-cache friendly value on success (200) and ``no-store``
on errors so the edge never retains unsafe payloads. New allowlisted GET routes
must follow the same contract.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.utils.responses import json_response

CACHE_CONTROL_EDGE_CACHEABLE_GET = (
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
)
CACHE_CONTROL_NO_STORE = "no-store"


def public_cacheable_json_response(
    status_code: int,
    body: Any,
    *,
    event: Mapping[str, Any],
) -> dict[str, Any]:
    """JSON response with cache headers for public calendar / free-asset GET routes."""
    cache = (
        CACHE_CONTROL_EDGE_CACHEABLE_GET
        if status_code == 200
        else CACHE_CONTROL_NO_STORE
    )
    return json_response(
        status_code,
        body,
        headers={"Cache-Control": cache},
        event=event,
    )
