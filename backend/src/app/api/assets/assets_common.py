"""Shared helpers for assets API handlers."""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from uuid import UUID

from app.api.admin_request import (
    encode_cursor,
    normalize_path,
    paginated_json_response,
    parse_body,
    parse_cursor as parse_admin_cursor,
    parse_limit as parse_admin_limit,
    query_param,
)
from app.api.admin_validators import validate_string_length
from app.db.models import (
    AccessGrantType,
    AssetType,
    AssetVisibility,
)
from app.exceptions import ValidationError
from app.services.asset_expense_tagging import (
    CLIENT_DOCUMENT_TAG_NAME,
)
from app.api.assets.assets_storage import (
    MAX_FILE_NAME_LENGTH,
)

__all__ = [
    "normalize_path",
]

_MAX_MIME_TYPE_LENGTH = 127
_MAX_RESOURCE_KEY_LENGTH = 64
_MAX_CONTENT_LANGUAGE_LENGTH = 35
_CONTENT_LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$")
# Admin create/update: only tags exposed in the admin UI / public free-assets list filters.
_ADMIN_ASSET_CONTENT_LANGUAGE_CANONICAL: dict[str, str] = {
    "en": "en",
    "zh-cn": "zh-CN",
    "zh-hk": "zh-HK",
}
_MAX_PRINCIPAL_ID_LENGTH = 128
_RESOURCE_KEY_SANITIZE_RE = re.compile(r"[^a-z0-9]+")


def parse_limit(event: Mapping[str, Any], default: int = 25) -> int:
    """Parse and validate list page size."""
    return parse_admin_limit(event, default=default)


def parse_cursor(event: Mapping[str, Any]) -> UUID | None:
    """Parse cursor query parameter."""
    return parse_admin_cursor(query_param(event, "cursor"))


def parse_admin_asset_list_filters(
    event: Mapping[str, Any],
) -> tuple[str | None, AssetVisibility | None, AssetType | None, str | None]:
    """Parse admin list filter query parameters."""
    query = query_param(event, "query")
    query = query.strip() if query else None

    visibility_raw = query_param(event, "visibility")
    visibility: AssetVisibility | None = None
    if visibility_raw:
        visibility = parse_asset_visibility(visibility_raw)

    asset_type_raw = query_param(event, "asset_type")
    asset_type: AssetType | None = None
    if asset_type_raw:
        asset_type = parse_asset_type(asset_type_raw)

    tag_name_raw = query_param(event, "tag_name")
    tag_name: str | None = None
    if tag_name_raw and tag_name_raw.strip():
        normalized = tag_name_raw.strip()
        if len(normalized) > 100:
            raise ValidationError("tag_name is too long", field="tag_name")
        tag_name = normalized

    return query, visibility, asset_type, tag_name


def parse_content_language_query_param(raw: str | None) -> str | None:
    """Validate optional language query parameter for public resource lists."""
    if raw is None or not raw.strip():
        return None
    return parse_optional_content_language(
        {"language": raw.strip()},
        "language",
    )


def parse_optional_content_language(
    body: Mapping[str, Any],
    *field_names: str,
) -> str | None:
    """Parse optional BCP 47-style content language (e.g. en, zh-HK)."""
    raw = None
    for name in field_names:
        raw = _optional_field(body, name)
        if raw is not None:
            break
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValidationError(
            "content_language must be a string or null",
            field="content_language",
        )
    normalized = raw.strip()
    if not normalized:
        return None
    if len(normalized) > _MAX_CONTENT_LANGUAGE_LENGTH:
        raise ValidationError(
            "content_language is too long",
            field="content_language",
        )
    if not _CONTENT_LANGUAGE_RE.fullmatch(normalized):
        raise ValidationError(
            "content_language must be a BCP 47-style tag (e.g. en, zh-HK)",
            field="content_language",
        )
    return normalized


def parse_admin_asset_content_language(
    body: Mapping[str, Any],
    *field_names: str,
) -> str | None:
    """Parse content_language for admin asset writes; null or one of en, zh-CN, zh-HK."""
    parsed = parse_optional_content_language(body, *field_names)
    if parsed is None:
        return None
    key = parsed.replace("_", "-").lower()
    canonical = _ADMIN_ASSET_CONTENT_LANGUAGE_CANONICAL.get(key)
    if canonical is None:
        raise ValidationError(
            "content_language must be null or one of: en, zh-CN, zh-HK",
            field="content_language",
        )
    return canonical


def _parse_asset_core_fields_for_write(body: Mapping[str, Any]) -> dict[str, Any]:
    title = _required_text(body, "title", max_length=255)
    description = _optional_text(body, "description", max_length=5000)
    file_name = _required_text(
        body, "file_name", "fileName", max_length=MAX_FILE_NAME_LENGTH
    )
    resource_key = _optional_resource_key(body, "resource_key", "resourceKey")
    asset_type = parse_asset_type(
        _optional_field(body, "asset_type", "assetType") or "document"
    )
    content_type = _optional_text(
        body, "content_type", "contentType", max_length=_MAX_MIME_TYPE_LENGTH
    )
    content_language = parse_admin_asset_content_language(
        body, "content_language", "contentLanguage"
    )
    visibility = parse_asset_visibility(
        _optional_field(body, "visibility") or "restricted"
    )
    return {
        "title": title,
        "description": description,
        "file_name": file_name,
        "resource_key": resource_key,
        "asset_type": asset_type,
        "content_type": content_type,
        "content_language": content_language,
        "visibility": visibility,
    }


def _parse_client_tag_required_value(body: Mapping[str, Any]) -> str | None:
    raw = _optional_field(body, "client_tag", "clientTag")
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValidationError("client_tag must be a string or null", field="client_tag")
    normalized = raw.strip().lower()
    if normalized == CLIENT_DOCUMENT_TAG_NAME.lower():
        return CLIENT_DOCUMENT_TAG_NAME
    raise ValidationError(
        'client_tag must be null or "client_document"',
        field="client_tag",
    )


def _parse_client_tag_for_create(body: Mapping[str, Any]) -> str | None:
    if not _has_any_field(body, "client_tag", "clientTag"):
        return None
    return _parse_client_tag_required_value(body)


def parse_create_asset_payload(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse and validate create asset request payload."""
    body = parse_body(event)
    result = _parse_asset_core_fields_for_write(body)
    result["client_tag"] = _parse_client_tag_for_create(body)
    return result


def parse_update_asset_payload(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse and validate full update asset request payload."""
    body = parse_body(event)
    result = _parse_asset_core_fields_for_write(body)
    specified = _has_any_field(body, "client_tag", "clientTag")
    result["client_tag_specified"] = specified
    result["client_tag"] = _parse_client_tag_required_value(body) if specified else None
    return result


def parse_partial_update_asset_payload(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse and validate partial update payload for PATCH requests."""
    body = parse_body(event)
    payload: dict[str, Any] = {}

    if _has_any_field(body, "title"):
        payload["title"] = _required_text(body, "title", max_length=255)
    if _has_any_field(body, "description"):
        payload["description"] = _optional_text(body, "description", max_length=5000)
    if _has_any_field(body, "file_name", "fileName"):
        payload["file_name"] = _required_text(
            body,
            "file_name",
            "fileName",
            max_length=MAX_FILE_NAME_LENGTH,
        )
    if _has_any_field(body, "resource_key", "resourceKey"):
        payload["resource_key"] = _optional_resource_key(
            body, "resource_key", "resourceKey"
        )
    if _has_any_field(body, "asset_type", "assetType"):
        asset_type_raw = _optional_field(body, "asset_type", "assetType")
        if not asset_type_raw:
            raise ValidationError("asset_type is required", field="asset_type")
        payload["asset_type"] = parse_asset_type(asset_type_raw)
    if _has_any_field(body, "content_type", "contentType"):
        payload["content_type"] = _optional_text(
            body,
            "content_type",
            "contentType",
            max_length=_MAX_MIME_TYPE_LENGTH,
        )
    if _has_any_field(body, "content_language", "contentLanguage"):
        payload["content_language"] = parse_admin_asset_content_language(
            body, "content_language", "contentLanguage"
        )
        payload["content_language_specified"] = True
    if _has_any_field(body, "visibility"):
        visibility_raw = _optional_field(body, "visibility")
        if not visibility_raw:
            raise ValidationError("visibility is required", field="visibility")
        payload["visibility"] = parse_asset_visibility(visibility_raw)

    if _has_any_field(body, "client_tag", "clientTag"):
        payload["client_tag_specified"] = True
        payload["client_tag"] = _parse_client_tag_required_value(body)

    if not payload:
        raise ValidationError(
            "At least one updatable field is required",
            field="body",
        )

    return payload


def parse_grant_payload(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse and validate create grant payload."""
    body = parse_body(event)
    grant_type_raw = _optional_field(body, "grant_type", "grantType")
    if not grant_type_raw:
        raise ValidationError("grant_type is required", field="grant_type")
    grant_type = parse_grant_type(grant_type_raw)

    grantee_id = _optional_text(
        body, "grantee_id", "granteeId", max_length=_MAX_PRINCIPAL_ID_LENGTH
    )
    if grant_type == AccessGrantType.ALL_AUTHENTICATED:
        grantee_id = None
    elif not grantee_id:
        raise ValidationError(
            "grantee_id is required for organization and user grants",
            field="grantee_id",
        )

    return {
        "grant_type": grant_type,
        "grantee_id": grantee_id,
    }


def parse_asset_visibility(value: str) -> AssetVisibility:
    """Parse visibility enum from input."""
    normalized = value.strip().lower()
    try:
        return AssetVisibility(normalized)
    except ValueError as exc:
        raise ValidationError(
            "visibility must be 'public' or 'restricted'", field="visibility"
        ) from exc


def parse_asset_type(value: str) -> AssetType:
    """Parse asset type enum from input."""
    normalized = value.strip().lower()
    try:
        return AssetType(normalized)
    except ValueError as exc:
        raise ValidationError(
            "asset_type must be one of guide, video, pdf, document",
            field="asset_type",
        ) from exc


def parse_grant_type(value: str) -> AccessGrantType:
    """Parse grant type enum from input."""
    normalized = value.strip().lower()
    try:
        return AccessGrantType(normalized)
    except ValueError as exc:
        raise ValidationError(
            "grant_type must be one of all_authenticated, organization, user",
            field="grant_type",
        ) from exc


def paginate_response(
    *,
    items: Sequence[Any],
    limit: int,
    event: Mapping[str, Any],
    serializer: Callable[[Any], dict[str, Any]],
    extra_fields: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Build a standard paginated API response payload."""
    return paginated_json_response(
        items=items,
        limit=limit,
        event=event,
        serializer=serializer,
        cursor_encoder=lambda item: encode_cursor(item.id),
        extra_fields=extra_fields,
        headers=headers,
    )


def parse_init_asset_content_replace_payload(
    event: Mapping[str, Any],
) -> dict[str, Any]:
    """Parse body for POST .../assets/{id}/content/init (replace file, step 1)."""
    body = parse_body(event)
    file_name = _required_text(
        body, "file_name", "fileName", max_length=MAX_FILE_NAME_LENGTH
    )
    content_type = _optional_text(
        body, "content_type", "contentType", max_length=_MAX_MIME_TYPE_LENGTH
    )
    return {"file_name": file_name, "content_type": content_type}


def parse_complete_asset_content_replace_payload(
    event: Mapping[str, Any],
) -> dict[str, Any]:
    """Parse body for POST .../assets/{id}/content/complete (replace file, step 2)."""
    body = parse_body(event)
    pending_key = _required_text(
        body,
        "pending_s3_key",
        "pendingS3Key",
        max_length=1024,
    ).strip()
    if not pending_key:
        raise ValidationError("pending_s3_key is required", field="pending_s3_key")
    file_name = _required_text(
        body, "file_name", "fileName", max_length=MAX_FILE_NAME_LENGTH
    )
    content_type = _optional_text(
        body, "content_type", "contentType", max_length=_MAX_MIME_TYPE_LENGTH
    )
    return {
        "pending_s3_key": pending_key,
        "file_name": file_name,
        "content_type": content_type,
    }


def _required_text(body: Mapping[str, Any], *keys: str, max_length: int) -> str:
    value = _optional_field(body, *keys)
    normalized = validate_string_length(
        value, keys[0], max_length=max_length, required=True
    )
    if normalized is None:
        raise ValidationError(f"{keys[0]} is required", field=keys[0])
    return normalized


def _optional_text(body: Mapping[str, Any], *keys: str, max_length: int) -> str | None:
    value = _optional_field(body, *keys)
    return validate_string_length(value, keys[0], max_length=max_length, required=False)


def _optional_resource_key(body: Mapping[str, Any], *keys: str) -> str | None:
    value = _optional_field(body, *keys)
    normalized = validate_string_length(value, keys[0], max_length=200, required=False)
    if normalized is None:
        return None

    slug = _RESOURCE_KEY_SANITIZE_RE.sub("-", normalized.lower()).strip("-")
    slug = slug[:_MAX_RESOURCE_KEY_LENGTH].strip("-")
    if not slug:
        raise ValidationError("resource_key is invalid", field=keys[0])
    return slug


def _optional_field(body: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in body:
            return body.get(key)
    return None


def _has_any_field(body: Mapping[str, Any], *keys: str) -> bool:
    return any(key in body for key in keys)


def _to_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized if normalized else None
    return str(value).strip() or None


def _parse_csv_set(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def _extract_claim(claims: Any, key: str) -> str | None:
    if not isinstance(claims, Mapping):
        return None
    value = claims.get(key)
    if value is None:
        return None
    if isinstance(value, list):
        return ",".join(str(item).strip() for item in value if str(item).strip())
    return _to_optional_string(value)
