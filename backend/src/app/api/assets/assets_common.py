"""Shared helpers for assets API handlers."""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

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
    Asset,
    AssetAccessGrant,
    AssetType,
    AssetVisibility,
)
from app.exceptions import ValidationError
from app.services.asset_expense_tagging import (
    CLIENT_DOCUMENT_TAG_NAME,
    EXPENSE_ATTACHMENT_TAG_NAME,
)
from app.services.asset_invoice_tagging import CUSTOMER_INVOICE_TAG_NAME
from app.services.aws_clients import get_s3_client
from app.services.cloudfront_signing import generate_signed_download_url
from app.utils import require_env
from sqlalchemy import inspect

__all__ = [
    "normalize_path",
]

_MAX_FILE_NAME_LENGTH = 255
# Admin presigned PUT uploads (create + replace): reject completes larger than this (bytes).
_MAX_ASSET_PRESIGNED_UPLOAD_BYTES = 52_428_800  # 50 MiB
_ADMIN_ASSET_REPLACE_CONTENT_TYPE = "application/pdf"
_UUID_OBJECT_NAME_PREFIX_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-",
    re.IGNORECASE,
)
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
_DEFAULT_PRESIGN_TTL_SECONDS = 900
_MIN_PRESIGN_TTL_SECONDS = 60
_MAX_PRESIGN_TTL_SECONDS = 3600
_DEFAULT_DOWNLOAD_LINK_EXPIRY_DAYS = 9999
_MIN_DOWNLOAD_LINK_EXPIRY_DAYS = 1
_MAX_DOWNLOAD_LINK_EXPIRY_DAYS = 36500
_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")
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
        body, "file_name", "fileName", max_length=_MAX_FILE_NAME_LENGTH
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


def _asset_has_tag_name(asset: Asset, tag_name: str) -> bool:
    needle = tag_name.lower()
    for link in asset.asset_tags:
        tag = link.tag
        if tag is not None and tag.name.lower() == needle:
            return True
    return False


def asset_links_expense_attachment(asset: Asset) -> bool:
    """Return True when the asset carries the expense_attachment tag (relationship loaded)."""
    return _asset_has_tag_name(asset, EXPENSE_ATTACHMENT_TAG_NAME)


def asset_links_customer_invoice(asset: Asset) -> bool:
    """Return True when the asset carries the customer_invoice tag (relationship loaded)."""
    return _asset_has_tag_name(asset, CUSTOMER_INVOICE_TAG_NAME)


def asset_links_restricted_system_document(asset: Asset) -> bool:
    """Return True when expense or customer-invoice system tags are present."""
    return asset_links_expense_attachment(asset) or asset_links_customer_invoice(asset)


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
            max_length=_MAX_FILE_NAME_LENGTH,
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


def build_s3_key(asset_id: UUID, file_name: str) -> str:
    """Build canonical S3 object key for a new asset."""
    sanitized = sanitize_file_name(file_name)
    return f"assets/{asset_id}/{uuid4()}-{sanitized}"


def file_name_from_pending_asset_content_key(s3_key: str) -> str:
    """Return the filename segment after the UUID prefix in a key from ``build_s3_key``."""
    segment = s3_key.rsplit("/", maxsplit=1)[-1]
    match = _UUID_OBJECT_NAME_PREFIX_RE.match(segment)
    if match is None:
        raise ValidationError(
            "pending_s3_key has an unexpected object name format",
            field="pending_s3_key",
        )
    suffix = segment[match.end() :]
    if not suffix:
        raise ValidationError(
            "pending_s3_key has an unexpected object name format",
            field="pending_s3_key",
        )
    return suffix


def max_asset_presigned_upload_bytes() -> int:
    """Maximum allowed S3 object size for admin asset uploads (create and replace complete)."""
    return _MAX_ASSET_PRESIGNED_UPLOAD_BYTES


def admin_asset_replace_content_type() -> str:
    """Content-Type bound for admin PDF replace presigns and enforced on complete."""
    return _ADMIN_ASSET_REPLACE_CONTENT_TYPE


def validate_pending_asset_content_s3_key(*, asset_id: UUID, pending_key: str) -> None:
    """Ensure pending upload key is under this asset's prefix (defense in depth)."""
    if ".." in pending_key or pending_key.strip() != pending_key:
        raise ValidationError("pending_s3_key is invalid", field="pending_s3_key")
    expected_prefix = f"assets/{asset_id}/"
    if not pending_key.startswith(expected_prefix):
        raise ValidationError(
            "pending_s3_key does not match this asset",
            field="pending_s3_key",
        )


def sanitize_file_name(file_name: str) -> str:
    """Sanitize filename to safe object-key segment."""
    normalized = file_name.strip()
    if not normalized:
        return "asset"
    cleaned = _FILENAME_SAFE_RE.sub("-", normalized)
    cleaned = cleaned.strip("-")
    return cleaned[:_MAX_FILE_NAME_LENGTH] if cleaned else "asset"


def generate_upload_url(*, s3_key: str, content_type: str | None) -> dict[str, Any]:
    """Generate a presigned PUT URL for upload."""
    bucket_name = _require_assets_bucket_name()
    ttl_seconds = _presign_ttl_seconds()
    s3_client = get_s3_client()

    params: dict[str, Any] = {"Bucket": bucket_name, "Key": s3_key}
    headers: dict[str, str] = {}
    if content_type:
        params["ContentType"] = content_type
        headers["Content-Type"] = content_type

    url = s3_client.generate_presigned_url(
        "put_object",
        Params=params,
        ExpiresIn=ttl_seconds,
        HttpMethod="PUT",
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=ttl_seconds)
    return {
        "upload_url": url,
        "upload_method": "PUT",
        "upload_headers": headers,
        "expires_at": expires_at.isoformat(),
    }


def generate_download_url(
    *,
    s3_key: str,
    cache_bust_key: str | None = None,
    expires_at: datetime | None = None,
) -> dict[str, Any]:
    """Generate a CloudFront-signed GET URL for download."""
    if expires_at is None:
        expiry_days = _download_link_expiry_days()
        expires_at = datetime.now(UTC) + timedelta(days=expiry_days)
    url = generate_signed_download_url(
        s3_key=s3_key,
        expires_at=expires_at,
        cache_bust_key=cache_bust_key,
    )
    return {
        "download_url": url,
        "expires_at": expires_at.isoformat(),
    }


def signed_link_no_cache_headers() -> dict[str, str]:
    """Return headers that force revalidation for signed-link responses."""
    return {
        "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }


def delete_s3_object(*, s3_key: str) -> None:
    """Delete an S3 object by key."""
    bucket_name = _require_assets_bucket_name()
    s3_client = get_s3_client()
    s3_client.delete_object(Bucket=bucket_name, Key=s3_key)


def head_s3_object(*, s3_key: str) -> dict[str, Any]:
    """Return S3 head_object response metadata for the given key."""
    bucket_name = _require_assets_bucket_name()
    s3_client = get_s3_client()
    return s3_client.head_object(Bucket=bucket_name, Key=s3_key)


def parse_init_asset_content_replace_payload(
    event: Mapping[str, Any],
) -> dict[str, Any]:
    """Parse body for POST .../assets/{id}/content/init (replace file, step 1)."""
    body = parse_body(event)
    file_name = _required_text(
        body, "file_name", "fileName", max_length=_MAX_FILE_NAME_LENGTH
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
        body, "file_name", "fileName", max_length=_MAX_FILE_NAME_LENGTH
    )
    content_type = _optional_text(
        body, "content_type", "contentType", max_length=_MAX_MIME_TYPE_LENGTH
    )
    return {
        "pending_s3_key": pending_key,
        "file_name": file_name,
        "content_type": content_type,
    }


def _serialize_asset_tags_if_loaded(asset: Asset) -> list[dict[str, Any]]:
    """Include tags only when the relationship is preloaded (avoids N+1 queries)."""
    state = inspect(asset)
    if state.transient:
        return []
    if "asset_tags" in state.unloaded:
        return []
    rows: list[dict[str, Any]] = []
    for link in asset.asset_tags:
        tag = link.tag
        if tag is None:
            continue
        rows.append(
            {
                "id": str(tag.id),
                "name": tag.name,
                "color": tag.color,
            }
        )
    return sorted(rows, key=lambda item: item["name"].lower())


def serialize_asset(asset: Asset) -> dict[str, Any]:
    """Serialize Asset model to API payload."""
    return {
        "id": str(asset.id),
        "title": asset.title,
        "description": asset.description,
        "asset_type": asset.asset_type.value,
        "s3_key": asset.s3_key,
        "file_name": asset.file_name,
        "resource_key": asset.resource_key,
        "content_type": asset.content_type,
        "content_language": asset.content_language,
        "visibility": asset.visibility.value,
        "created_by": asset.created_by,
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
        "tags": _serialize_asset_tags_if_loaded(asset),
    }


def serialize_public_free_asset(asset: Asset) -> dict[str, Any]:
    """Serialize a public free-website asset for GET /v1/assets/free."""
    return {
        "title": asset.title,
        "description": asset.description,
        "asset_type": asset.asset_type.value,
        "resource_key": asset.resource_key,
        "content_language": asset.content_language,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
    }


def serialize_grant(grant: AssetAccessGrant) -> dict[str, Any]:
    """Serialize AssetAccessGrant model to API payload."""
    return {
        "id": str(grant.id),
        "asset_id": str(grant.asset_id),
        "grant_type": grant.grant_type.value,
        "grantee_id": grant.grantee_id,
        "granted_by": grant.granted_by,
        "created_at": grant.created_at.isoformat() if grant.created_at else None,
    }


def _require_assets_bucket_name() -> str:
    return require_env("ASSETS_BUCKET_NAME")


def _presign_ttl_seconds() -> int:
    raw = os.getenv(
        "ASSET_PRESIGN_TTL_SECONDS", f"{_DEFAULT_PRESIGN_TTL_SECONDS}"
    ).strip()
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise RuntimeError("ASSET_PRESIGN_TTL_SECONDS must be an integer") from exc
    return max(_MIN_PRESIGN_TTL_SECONDS, min(_MAX_PRESIGN_TTL_SECONDS, parsed))


def _download_link_expiry_days() -> int:
    raw = os.getenv(
        "ASSET_DOWNLOAD_LINK_EXPIRY_DAYS", f"{_DEFAULT_DOWNLOAD_LINK_EXPIRY_DAYS}"
    ).strip()
    try:
        parsed_days = int(raw)
    except ValueError as exc:
        raise RuntimeError(
            "ASSET_DOWNLOAD_LINK_EXPIRY_DAYS must be an integer"
        ) from exc
    return max(
        _MIN_DOWNLOAD_LINK_EXPIRY_DAYS,
        min(_MAX_DOWNLOAD_LINK_EXPIRY_DAYS, parsed_days),
    )


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
