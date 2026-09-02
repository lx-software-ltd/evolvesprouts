"""Request parsing helpers for admin APIs."""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from collections.abc import Callable, Mapping, Sequence
from uuid import UUID

from app.exceptions import AuthorizationError, ValidationError
from app.utils import json_response
from app.utils.parsers import collect_query_params, first_param

DEFAULT_LIST_LIMIT = 25
MAX_LIST_LIMIT = 100


@dataclass(frozen=True)
class RequestIdentity:
    """Caller identity extracted from API Gateway authorizer context."""

    user_sub: str | None
    groups: set[str]
    organization_ids: set[str]

    @property
    def is_authenticated(self) -> bool:
        return bool(self.user_sub)

    @property
    def is_admin_or_manager(self) -> bool:
        normalized = {group.lower() for group in self.groups}
        return "admin" in normalized or "manager" in normalized


def parse_body(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse JSON request body."""
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValidationError("Request body is not valid base64") from exc
    if not raw:
        raise ValidationError("Request body is required")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValidationError("Request body must be valid JSON") from exc


def query_param(event: Mapping[str, Any], name: str) -> str | None:
    """Return a query parameter value."""
    params = collect_query_params(event)
    return first_param(params, name)


def normalize_path(path: str) -> str:
    """Normalize route path for deterministic matching."""
    if not path:
        return ""
    normalized = path.strip()
    if not normalized.startswith("/"):
        normalized = "/" + normalized
    if normalized != "/" and normalized.endswith("/"):
        normalized = normalized[:-1]
    return normalized


def split_route_parts(path: str) -> list[str]:
    """Split normalized API route into segments without version prefix."""
    parts = [segment for segment in normalize_path(path).split("/") if segment]
    if parts and parts[0].startswith("v") and parts[0][1:].isdigit():
        return parts[1:]
    return parts


def request_id(event: Mapping[str, Any]) -> str:
    """Return API Gateway request id if present."""
    request_context = event.get("requestContext")
    if isinstance(request_context, Mapping):
        request_id_value = request_context.get("requestId")
        if isinstance(request_id_value, str):
            return request_id_value.strip()
    return ""


def require_admin_identity(event: Mapping[str, Any]) -> RequestIdentity:
    """Return the caller identity or raise if the authorizer omitted ``user_sub``."""
    identity = extract_identity(event)
    if not identity.user_sub:
        raise AuthorizationError("Authenticated user is required")
    return identity


def extract_identity(event: Mapping[str, Any]) -> RequestIdentity:
    """Extract request identity from API Gateway custom authorizer context."""
    request_context = event.get("requestContext")
    if not isinstance(request_context, Mapping):
        return RequestIdentity(user_sub=None, groups=set(), organization_ids=set())
    authorizer = request_context.get("authorizer")
    if not isinstance(authorizer, Mapping):
        return RequestIdentity(user_sub=None, groups=set(), organization_ids=set())

    user_sub = _to_optional_string(
        authorizer.get("userSub")
        or authorizer.get("principalId")
        or _extract_claim(authorizer.get("claims"), "sub")
    )
    groups = _parse_csv_set(
        _to_optional_string(authorizer.get("groups"))
        or _extract_claim(authorizer.get("claims"), "cognito:groups")
    )
    organization_ids = _parse_csv_set(
        _to_optional_string(authorizer.get("organizationIds"))
        or _to_optional_string(authorizer.get("organizationId"))
        or _extract_claim(authorizer.get("claims"), "custom:organization_ids")
        or _extract_claim(authorizer.get("claims"), "custom:organization_id")
        or _extract_claim(authorizer.get("claims"), "organization_ids")
        or _extract_claim(authorizer.get("claims"), "organization_id")
    )
    return RequestIdentity(
        user_sub=user_sub,
        groups=groups,
        organization_ids=organization_ids,
    )


def parse_limit(
    event_or_raw: Mapping[str, Any] | str | None,
    *,
    default: int = DEFAULT_LIST_LIMIT,
    max_limit: int = MAX_LIST_LIMIT,
) -> int:
    """Parse and validate a list page size from an event or raw query value."""
    raw_value = (
        query_param(event_or_raw, "limit")
        if isinstance(event_or_raw, Mapping)
        else event_or_raw
    )
    if raw_value is None or str(raw_value).strip() == "":
        return default
    try:
        parsed = int(str(raw_value).strip())
    except (TypeError, ValueError) as exc:
        raise ValidationError("limit must be an integer", field="limit") from exc
    if parsed < 1 or parsed > max_limit:
        raise ValidationError(
            f"limit must be between 1 and {max_limit}",
            field="limit",
        )
    return parsed


def paginate_items(
    items: Sequence[Any],
    *,
    limit: int,
    cursor_encoder: Callable[[Any], str | None],
) -> tuple[list[Any], str | None]:
    """Slice one over-fetched page and derive the next cursor."""
    page_items = list(items[:limit])
    has_more = len(items) > limit
    next_cursor = cursor_encoder(page_items[-1]) if has_more and page_items else None
    return page_items, next_cursor


def paginated_json_response(
    *,
    items: Sequence[Any],
    limit: int,
    event: Mapping[str, Any],
    serializer: Callable[[Any], dict[str, Any]],
    cursor_encoder: Callable[[Any], str | None],
    extra_fields: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Build a standard paginated API response payload."""
    page_items, next_cursor = paginate_items(
        items,
        limit=limit,
        cursor_encoder=cursor_encoder,
    )
    body: dict[str, Any] = {
        "items": [serializer(item) for item in page_items],
        "next_cursor": next_cursor,
    }
    if extra_fields:
        body.update(dict(extra_fields))
    return json_response(
        200,
        body,
        event=event,
        headers=dict(headers) if headers is not None else None,
    )


def parse_uuid(value: str) -> UUID:
    """Parse a UUID string."""
    try:
        return UUID(value)
    except (ValueError, TypeError) as exc:
        raise ValidationError(f"Invalid UUID: {value}", field="id") from exc


def _to_uuid(value: UUID | str) -> UUID:
    """Normalize a UUID from UUID or string input."""
    if isinstance(value, UUID):
        return value
    return parse_uuid(value)


def _parse_group_name(event: Mapping[str, Any]) -> str:
    """Parse the group name from the request."""
    raw = event.get("body") or ""
    if not raw:
        return os.getenv("ADMIN_GROUP") or "admin"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        body = {}
    group = body.get("group") if isinstance(body, dict) else None
    return group or os.getenv("ADMIN_GROUP") or "admin"


def parse_cursor(value: str | None) -> UUID | None:
    """Parse cursor for admin listing."""
    if value is None or value == "":
        return None
    try:
        payload = _decode_cursor(value)
        return UUID(payload["id"])
    except (ValueError, KeyError, TypeError) as exc:
        raise ValidationError("Invalid cursor", field="cursor") from exc


def encode_cursor(value: Any) -> str:
    """Encode admin cursor."""
    payload = json.dumps({"id": str(value)}).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("utf-8")
    return encoded.rstrip("=")


def encode_created_cursor(created_at: Any, row_id: UUID) -> str | None:
    """Encode generic created_at/id cursor."""
    if created_at is None:
        return None
    payload = json.dumps(
        {"created_at": _normalize_datetime(created_at).isoformat(), "id": str(row_id)}
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")


def parse_created_cursor(cursor: str | None) -> tuple[datetime | None, UUID | None]:
    """Parse a generic created_at/id cursor payload."""
    if not cursor:
        return None, None

    try:
        payload = _decode_cursor(cursor)
        created_at_raw = payload["created_at"]
        row_id_raw = payload["id"]
        if not isinstance(created_at_raw, str):
            raise ValueError("created_at must be a string")
        parsed_created_at = datetime.fromisoformat(
            created_at_raw.replace("Z", "+00:00")
        )
        return _normalize_datetime(parsed_created_at), UUID(str(row_id_raw))
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValidationError("Invalid cursor", field="cursor") from exc


def _decode_cursor(cursor: str) -> dict[str, Any]:
    """Decode admin cursor."""
    padding = "=" * (-len(cursor) % 4)
    raw = base64.urlsafe_b64decode(cursor + padding)
    return json.loads(raw)


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _to_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _parse_csv_set(value: str | None) -> set[str]:
    if not value:
        return set()
    return {part.strip() for part in value.split(",") if part.strip()}


def _extract_claim(claims: Any, name: str) -> str | None:
    if isinstance(claims, Mapping):
        return _to_optional_string(claims.get(name))
    return None
