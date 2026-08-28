"""Admin handlers for managing hashed API tokens."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.api.admin_request import (
    encode_created_cursor,
    extract_identity,
    parse_body,
    parse_created_cursor,
    parse_limit,
    parse_uuid,
    query_param,
    request_id,
)
from app.api.admin_validators import MAX_NAME_LENGTH, validate_string_length
from app.api.assets.assets_common import split_route_parts
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.api_key import ApiKey
from app.db.repositories.api_key import ApiKeyRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.api_keys import ALLOWED_SCOPES, generate_api_key
from app.utils import json_response, parse_datetime
from app.utils.logging import get_logger

logger = get_logger(__name__)


def handle_admin_api_keys_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/api-keys routes (list, create, get, revoke)."""
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "api-keys":
        return json_response(404, {"error": "Not found"}, event=event)

    identity = extract_identity(event)
    if not identity.user_sub:
        raise ValidationError("Authenticated user is required", field="authorization")

    resource_id = parts[2] if len(parts) == 3 else None
    if len(parts) > 3:
        return json_response(404, {"error": "Not found"}, event=event)

    if method == "GET" and resource_id is None:
        return _list_api_keys(event)
    if method == "GET" and resource_id is not None:
        return _get_api_key(event, resource_id)
    if method == "POST" and resource_id is None:
        return _create_api_key(event, actor_sub=identity.user_sub)
    if method == "DELETE" and resource_id is not None:
        return _revoke_api_key(event, resource_id, actor_sub=identity.user_sub)
    return json_response(405, {"error": "Method not allowed"}, event=event)


def _list_api_keys(event: Mapping[str, Any]) -> dict[str, Any]:
    """List API tokens with cursor pagination."""
    limit = parse_limit(event)
    cursor_created_at, cursor_id = parse_created_cursor(query_param(event, "cursor"))

    with Session(get_engine()) as session:
        repo = ApiKeyRepository(session)
        rows = repo.list_newest(
            limit=limit + 1,
            cursor_created_at=cursor_created_at,
            cursor_id=cursor_id,
        )

    has_more = len(rows) > limit
    trimmed = list(rows)[:limit]
    next_cursor = (
        encode_created_cursor(trimmed[-1].created_at, trimmed[-1].id)
        if has_more and trimmed
        else None
    )
    return json_response(
        200,
        {
            "items": [_serialize_api_key(row) for row in trimmed],
            "next_cursor": next_cursor,
        },
        event=event,
    )


def _get_api_key(event: Mapping[str, Any], resource_id: str) -> dict[str, Any]:
    """Get a single API token by id."""
    with Session(get_engine()) as session:
        repo = ApiKeyRepository(session)
        entity = repo.get_by_id(parse_uuid(resource_id))
        if entity is None:
            raise NotFoundError("api-keys", resource_id)
        return json_response(200, _serialize_api_key(entity), event=event)


def _create_api_key(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    """Create a new API token; the plaintext value is returned once."""
    body = parse_body(event)

    name = validate_string_length(
        body.get("name"), "name", MAX_NAME_LENGTH, required=True
    )
    if name is None:
        raise ValidationError("name is required", field="name")

    scope = body.get("scope")
    if scope not in ALLOWED_SCOPES:
        raise ValidationError(
            f"scope must be one of: {', '.join(ALLOWED_SCOPES)}",
            field="scope",
        )

    expires_at = _parse_optional_expiry(body.get("expires_at"))
    generated = generate_api_key()

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repo = ApiKeyRepository(session)
        entity = ApiKey(
            name=name,
            key_prefix=generated.prefix,
            key_hash=generated.key_hash,
            scope=scope,
            created_by=actor_sub,
            expires_at=expires_at,
        )
        repo.create(entity)
        session.commit()
        session.refresh(entity)
        logger.info(f"Created API token {entity.id} (scope={scope})")

        payload = _serialize_api_key(entity)
        # SECURITY: the plaintext token is only returned in this response and
        # is never stored or logged.
        payload["api_token"] = generated.plaintext
        return json_response(201, payload, event=event)


def _revoke_api_key(
    event: Mapping[str, Any],
    resource_id: str,
    *,
    actor_sub: str,
) -> dict[str, Any]:
    """Revoke an API token (idempotent soft delete)."""
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repo = ApiKeyRepository(session)
        entity = repo.get_by_id(parse_uuid(resource_id))
        if entity is None:
            raise NotFoundError("api-keys", resource_id)
        repo.revoke(entity)
        session.commit()
        session.refresh(entity)
        logger.info(f"Revoked API token {resource_id}")
        return json_response(200, _serialize_api_key(entity), event=event)


def _parse_optional_expiry(value: Any) -> datetime | None:
    """Parse an optional expiry timestamp; must be in the future."""
    if value is None or value == "":
        return None
    try:
        parsed = parse_datetime(str(value))
    except ValueError:
        parsed = None
    if parsed is None:
        raise ValidationError(
            "Invalid expires_at format. Use ISO 8601 (e.g. 2027-01-01T00:00:00Z)",
            field="expires_at",
        )
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if parsed <= datetime.now(timezone.utc):
        raise ValidationError(
            "expires_at must be in the future",
            field="expires_at",
        )
    return parsed


def _serialize_api_key(entity: ApiKey) -> dict[str, Any]:
    """Serialize an API token without its hash."""
    return {
        "id": str(entity.id),
        "name": entity.name,
        "key_prefix": entity.key_prefix,
        "scope": entity.scope,
        "status": _key_status(entity),
        "created_by": entity.created_by,
        "created_at": _isoformat(entity.created_at),
        "expires_at": _isoformat(entity.expires_at),
        "revoked_at": _isoformat(entity.revoked_at),
        "last_used_at": _isoformat(entity.last_used_at),
    }


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _key_status(entity: ApiKey) -> str:
    """Compute the display status of a token."""
    if entity.revoked_at is not None:
        return "revoked"
    expires_at = entity.expires_at
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            return "expired"
    return "active"
