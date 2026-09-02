"""Shared API Gateway request helpers for non-admin route modules.

Route handlers outside ``admin_request`` consumers should import from here
instead of ``app.api.assets.assets_common`` to avoid a misleading dependency
direction.
"""

from __future__ import annotations

from app.api.admin_request import (
    extract_identity,
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)

__all__ = [
    "extract_identity",
    "require_admin_identity",
    "route_has_prefix",
    "split_route_parts",
]
