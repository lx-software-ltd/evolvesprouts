"""Token-authenticated public geographic-area reads.

Both ``user`` and ``admin`` tokens may GET. Writes are not exposed.
Payloads match the admin geographic-area list contract.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.api.admin_geographic_areas import list_geographic_areas
from app.api.admin_request import route_has_prefix, split_route_parts
from app.api.public.token_auth import require_api_token
from app.utils import method_not_allowed, not_found


def handle_public_geographic_areas_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/public/geographic-areas routes."""
    parts = split_route_parts(path)
    if len(parts) != 2 or not route_has_prefix(parts, "public", "geographic-areas"):
        return not_found(event)

    require_api_token(event, method)
    if method != "GET":
        return method_not_allowed(event)
    return list_geographic_areas(event)
