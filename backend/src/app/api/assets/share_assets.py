"""Public stable share-link route handlers."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.auth.authorizer_utils import extract_bearer_token
from app.auth.jwt_validator import JWTValidationError, decode_and_verify_token
from app.api.admin_request import split_route_parts
from app.api.assets.assets_common import (
    generate_download_url,
    signed_link_no_cache_headers,
)
from app.api.assets.share_links import (
    extract_request_source_domain,
    is_valid_share_token,
)
from app.db.models import AssetVisibility
from app.db.engine import get_engine
from app.db.repositories.asset import AssetRepository
from app.utils import json_response


def handle_share_assets_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/assets/share/{token} route."""
    parts = split_route_parts(path)
    if len(parts) != 3 or parts[0] != "assets" or parts[1] != "share":
        return json_response(404, {"error": "Not found"}, event=event)

    if method != "GET":
        return json_response(405, {"error": "Method not allowed"}, event=event)

    return _resolve_share_token(event, parts[2], require_source_domain=True)


def handle_email_download_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/assets/email-download/{token} (email links; no Referer/Origin check)."""
    parts = split_route_parts(path)
    if len(parts) != 3 or parts[0] != "assets" or parts[1] != "email-download":
        return json_response(404, {"error": "Not found"}, event=event)

    if method != "GET":
        return json_response(405, {"error": "Method not allowed"}, event=event)

    return _resolve_share_token(event, parts[2], require_source_domain=False)


def _resolve_share_token(
    event: Mapping[str, Any],
    share_token: str,
    *,
    require_source_domain: bool,
) -> dict[str, Any]:
    if not is_valid_share_token(share_token):
        return json_response(404, {"error": "Not found"}, event=event)

    with Session(get_engine()) as session:
        repository = AssetRepository(session)
        share_link = repository.get_share_link_by_token(token=share_token)
        if share_link is None:
            return json_response(404, {"error": "Not found"}, event=event)
        if require_source_domain:
            source_domain = extract_request_source_domain(event)
            allowed_domains = set(share_link.allowed_domains or [])
            if not source_domain or source_domain not in allowed_domains:
                return json_response(403, {"error": "Forbidden"}, event=event)

        asset = repository.get_by_id(share_link.asset_id)
        if asset is None:
            return json_response(404, {"error": "Not found"}, event=event)
        if (
            asset.visibility == AssetVisibility.RESTRICTED
            and not _is_restricted_share_request_authenticated(event)
        ):
            return json_response(401, {"error": "Unauthorized"}, event=event)

        download = generate_download_url(s3_key=asset.s3_key)
        response_headers = signed_link_no_cache_headers()
        response_headers["Location"] = download["download_url"]
        return json_response(
            302,
            {},
            headers=response_headers,
            event=event,
        )


def _is_restricted_share_request_authenticated(event: Mapping[str, Any]) -> bool:
    headers = event.get("headers")
    if not isinstance(headers, Mapping):
        return False

    token = extract_bearer_token(headers)
    if not token:
        return False
    try:
        claims = decode_and_verify_token(token)
    except JWTValidationError:
        return False
    return bool(claims.sub)
