"""Public asset API handlers."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import parse_uuid, route_has_prefix, split_route_parts
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
from app.db.models import AssetVisibility
from app.db.repositories.asset import AssetRepository
from app.exceptions import NotFoundError
from app.utils import json_response, method_not_allowed, not_found


def handle_public_assets_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/assets/public* routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "assets", "public"):
        return not_found(event)

    if len(parts) == 2 and method == "GET":
        return _list_public_assets(event)

    if len(parts) == 4 and parts[3] == "download" and method == "GET":
        asset_id = parse_uuid(parts[2])
        return _download_public_asset(event, asset_id)

    return method_not_allowed(event)


def _list_public_assets(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event)
    cursor = parse_cursor(event)

    with Session(get_engine()) as session:
        repository = AssetRepository(session)
        assets = repository.list_public_assets(limit=limit + 1, cursor=cursor)
        return paginate_response(
            items=assets,
            limit=limit,
            event=event,
            serializer=serialize_asset,
        )


def _download_public_asset(event: Mapping[str, Any], asset_id: UUID) -> dict[str, Any]:
    with Session(get_engine()) as session:
        repository = AssetRepository(session)
        asset = repository.get_by_id(asset_id)
        if asset is None or asset.visibility != AssetVisibility.PUBLIC:
            raise NotFoundError("Asset", str(asset_id))

        download = generate_download_url(s3_key=asset.s3_key)
        return json_response(
            200,
            {"asset_id": str(asset.id), **download},
            headers=signed_link_no_cache_headers(),
            event=event,
        )
