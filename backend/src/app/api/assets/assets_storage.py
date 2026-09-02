"""S3 and CloudFront storage helpers for asset uploads, downloads, and deletes."""

from __future__ import annotations

import os
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from app.exceptions import ValidationError
from app.services.aws_clients import get_s3_client
from app.services.cloudfront_signing import generate_signed_download_url
from app.utils import require_env

MAX_FILE_NAME_LENGTH = 255
# Admin presigned PUT uploads (create + replace): reject completes larger than this (bytes).


_MAX_ASSET_PRESIGNED_UPLOAD_BYTES = 52_428_800  # 50 MiB


_ADMIN_ASSET_REPLACE_CONTENT_TYPE = "application/pdf"


_UUID_OBJECT_NAME_PREFIX_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-",
    re.IGNORECASE,
)


_DEFAULT_PRESIGN_TTL_SECONDS = 900


_MIN_PRESIGN_TTL_SECONDS = 60


_MAX_PRESIGN_TTL_SECONDS = 3600


_DEFAULT_DOWNLOAD_LINK_EXPIRY_DAYS = 9999


_MIN_DOWNLOAD_LINK_EXPIRY_DAYS = 1


_MAX_DOWNLOAD_LINK_EXPIRY_DAYS = 36500


_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


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
    return cleaned[:MAX_FILE_NAME_LENGTH] if cleaned else "asset"


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
