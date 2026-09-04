"""Admin asset share-link API handlers."""

from __future__ import annotations

import base64
import json
from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.assets.share_links import (
    build_share_link_url,
    generate_share_token,
    normalize_allowed_domains,
    resolve_default_allowed_domains,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import AssetVisibility
from app.db.repositories.asset import AssetRepository
from app.exceptions import NotFoundError, ValidationError
from app.utils import get_logger, json_response

logger = get_logger(__name__)


def ensure_default_share_link_for_public_asset(
    repository: AssetRepository,
    *,
    asset_id: UUID,
    visibility: AssetVisibility | None,
    created_by: str,
) -> None:
    """Create a share link with env default domains for a newly public asset."""
    if visibility != AssetVisibility.PUBLIC:
        return
    if repository.get_share_link(asset_id=asset_id) is not None:
        return
    try:
        allowed_domains = resolve_default_allowed_domains()
    except RuntimeError:
        logger.warning(
            "Share link defaults unavailable; public asset created without allowlist",
            extra={"asset_id": str(asset_id)},
        )
        return
    repository.create_share_link(
        asset_id=asset_id,
        share_token=generate_share_token(),
        allowed_domains=allowed_domains,
        created_by=created_by,
    )


def parse_optional_json_body(event: Mapping[str, Any]) -> Mapping[str, Any] | None:
    raw_body = event.get("body")
    if raw_body is None:
        return None
    if not isinstance(raw_body, str):
        raise ValidationError("Request body must be a JSON object", field="body")
    if not raw_body.strip():
        return None

    decoded_body = raw_body
    if event.get("isBase64Encoded"):
        try:
            decoded_body = base64.b64decode(raw_body).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValidationError("Request body is not valid base64 JSON") from exc

    try:
        parsed_body = json.loads(decoded_body)
    except json.JSONDecodeError as exc:
        raise ValidationError("Request body must be valid JSON", field="body") from exc
    if not isinstance(parsed_body, Mapping):
        raise ValidationError("Request body must be a JSON object", field="body")
    return parsed_body


def parse_share_link_allowed_domains(event: Mapping[str, Any]) -> list[str] | None:
    body = parse_optional_json_body(event)
    if body is None:
        return None

    raw_allowed_domains = body.get("allowed_domains")
    if raw_allowed_domains is None:
        raw_allowed_domains = body.get("allowedDomains")
    if raw_allowed_domains is None:
        return None
    if not isinstance(raw_allowed_domains, list):
        raise ValidationError(
            "allowed_domains must be an array of domains",
            field="allowed_domains",
        )
    return normalize_allowed_domains(raw_allowed_domains)


def serialize_share_link_response(
    *,
    event: Mapping[str, Any],
    asset_id: UUID,
    token: str,
    allowed_domains: list[str],
) -> dict[str, Any]:
    return {
        "asset_id": str(asset_id),
        "share_url": build_share_link_url(event, token),
        "allowed_domains": list(allowed_domains),
    }


def get_or_create_share_link(
    event: Mapping[str, Any],
    asset_id: UUID,
    actor_sub: str,
    *,
    request_id: str | None,
) -> dict[str, Any]:
    requested_allowed_domains = parse_share_link_allowed_domains(event)

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id)
        repository = AssetRepository(session)
        asset = repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))

        share_link = repository.get_share_link(asset_id=asset_id)
        status_code = 200
        if share_link is None:
            allowed_domains = (
                requested_allowed_domains or resolve_default_allowed_domains()
            )
            share_link = repository.create_share_link(
                asset_id=asset_id,
                share_token=generate_share_token(),
                allowed_domains=allowed_domains,
                created_by=actor_sub,
            )
            status_code = 201
        elif requested_allowed_domains is not None:
            share_link = repository.update_share_link_allowed_domains(
                share_link,
                allowed_domains=requested_allowed_domains,
            )
        session.commit()

        return json_response(
            status_code,
            serialize_share_link_response(
                event=event,
                asset_id=asset_id,
                token=share_link.share_token,
                allowed_domains=share_link.allowed_domains,
            ),
            event=event,
        )


def get_share_link(event: Mapping[str, Any], asset_id: UUID) -> dict[str, Any]:
    with Session(get_engine()) as session:
        repository = AssetRepository(session)
        asset = repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))

        share_link = repository.get_share_link(asset_id=asset_id)
        if share_link is None:
            raise NotFoundError("Share link", str(asset_id))

        return json_response(
            200,
            serialize_share_link_response(
                event=event,
                asset_id=asset_id,
                token=share_link.share_token,
                allowed_domains=share_link.allowed_domains,
            ),
            event=event,
        )


def rotate_share_link(
    event: Mapping[str, Any],
    asset_id: UUID,
    actor_sub: str,
    *,
    request_id: str | None,
) -> dict[str, Any]:
    requested_allowed_domains = parse_share_link_allowed_domains(event)

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id)
        repository = AssetRepository(session)
        asset = repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))

        share_link = repository.get_share_link(asset_id=asset_id)
        next_token = generate_share_token()
        if share_link is None:
            allowed_domains = (
                requested_allowed_domains or resolve_default_allowed_domains()
            )
            share_link = repository.create_share_link(
                asset_id=asset_id,
                share_token=next_token,
                allowed_domains=allowed_domains,
                created_by=actor_sub,
            )
        else:
            share_link = repository.rotate_share_link(
                share_link,
                share_token=next_token,
                allowed_domains=requested_allowed_domains,
            )
        session.commit()

        return json_response(
            200,
            serialize_share_link_response(
                event=event,
                asset_id=asset_id,
                token=share_link.share_token,
                allowed_domains=share_link.allowed_domains,
            ),
            event=event,
        )


def revoke_share_link(
    event: Mapping[str, Any],
    asset_id: UUID,
    actor_sub: str,
    *,
    request_id: str | None,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id)
        repository = AssetRepository(session)
        asset = repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))

        share_link = repository.get_share_link(asset_id=asset_id)
        if share_link is not None:
            repository.revoke_share_link(share_link)
        session.commit()
        return json_response(204, {}, event=event)
