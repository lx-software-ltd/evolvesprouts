"""Authenticated user asset API handlers."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import (
    AuthenticatedIdentity,
    parse_uuid,
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)
from app.api.assets.assets_common import (
    paginate_response,
    parse_cursor,
    parse_limit,
)
from app.api.assets.assets_serializers import serialize_asset
from app.api.assets.assets_storage import (
    generate_download_url,
    signed_link_no_cache_headers,
)
from app.db.engine import get_engine
from app.db.repositories.asset import AssetRepository
from app.exceptions import AuthorizationError, NotFoundError
from app.utils import json_response, method_not_allowed, not_found


def handle_user_assets_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/user/assets* routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "user", "assets"):
        return not_found(event)

    identity = require_admin_identity(event)

    if len(parts) == 2 and method == "GET":
        return _list_accessible_assets(event, identity)

    if len(parts) == 4 and parts[3] == "download" and method == "GET":
        asset_id = parse_uuid(parts[2])
        return _download_asset(event, asset_id, identity)

    return method_not_allowed(event)


def _list_accessible_assets(
    event: Mapping[str, Any], identity: AuthenticatedIdentity
) -> dict[str, Any]:
    limit = parse_limit(event)
    cursor = parse_cursor(event)

    with Session(get_engine()) as session:
        repository = AssetRepository(session)
        assets = repository.list_accessible_assets(
            user_sub=identity.user_sub,
            organization_ids=identity.organization_ids,
            is_admin_or_manager=identity.is_admin_or_manager,
            limit=limit + 1,
            cursor=cursor,
        )
        return paginate_response(
            items=assets,
            limit=limit,
            event=event,
            serializer=serialize_asset,
        )


def _download_asset(
    event: Mapping[str, Any],
    asset_id: UUID,
    identity: AuthenticatedIdentity,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        repository = AssetRepository(session)
        asset = repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))

        can_access = repository.can_access_asset(
            asset=asset,
            user_sub=identity.user_sub,
            organization_ids=identity.organization_ids,
            is_admin_or_manager=identity.is_admin_or_manager,
            is_authenticated=identity.is_authenticated,
        )
        if not can_access:
            raise AuthorizationError("Access denied for this asset")

        download = generate_download_url(s3_key=asset.s3_key)
        return json_response(
            200,
            {"asset_id": str(asset.id), **download},
            headers=signed_link_no_cache_headers(),
            event=event,
        )
