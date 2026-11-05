"""Eventbrite header image from a prebuilt landing-page banner."""

from __future__ import annotations

import os
import re
from hashlib import sha256
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.services.aws_proxy import AwsProxyError, http_invoke
from app.services.eventbrite_client import EventbriteApiError, eventbrite_request
from app.utils.logging import get_logger
from app.utils.public_slug import PUBLIC_INSTANCE_SLUG_PATTERN

logger = get_logger(__name__)

_ENV_BANNERS_DIR = "EVENTBRITE_BANNERS_DIR"
_ENV_MEDIA_UPLOAD_URL = "EVENTBRITE_MEDIA_UPLOAD_URL"
_MAX_BANNER_BYTES = 2 * 1024 * 1024
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_FILE_FIELD_NAME = re.compile(r"^[A-Za-z0-9_-]+$")


def eventbrite_banner_sha256(instance: Any) -> str | None:
    """Checksum of the banner that would be uploaded, if one is usable."""
    banner = _usable_banner(instance)
    if banner is None:
        return None
    return sha256(banner).hexdigest()


class _ImageUploadError(ValueError):
    """S3 rejected the banner. ``status_code`` is safe to log."""

    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        super().__init__("image upload status")


def upload_event_logo(
    *,
    instance: Any,
    token: str,
    api_base_url: str,
    payload_hash: str,
    hash_without_banner: str,
) -> tuple[str | None, str]:
    """Upload the banner and return its image id plus the hash to store.

    A missing banner returns the full hash. A usable banner that was not
    uploaded returns the hash without the banner checksum, so the next
    save retries. Neither case fails the sync.
    """
    banner = _usable_banner(instance)
    if banner is None:
        return None, payload_hash
    try:
        logo_id = _upload_banner(
            instance,
            banner,
            token=token,
            api_base_url=api_base_url,
        )
    except (
        EventbriteApiError,
        AwsProxyError,
        OSError,
        RuntimeError,
        ValueError,
    ) as exc:
        extra: dict[str, Any] = {
            "instance_id": str(getattr(instance, "id", "") or ""),
            "error_type": type(exc).__name__,
        }
        status_code = getattr(exc, "status_code", None)
        if isinstance(status_code, int):
            extra["status"] = status_code
        logger.warning("Eventbrite header image was not uploaded", extra=extra)
        return None, hash_without_banner
    if not logo_id:
        return None, hash_without_banner
    return logo_id, payload_hash


def _upload_banner(
    instance: Any,
    banner: bytes,
    *,
    token: str,
    api_base_url: str,
) -> str | None:
    expected_url = os.getenv(_ENV_MEDIA_UPLOAD_URL, "").strip()
    if not expected_url:
        logger.warning(
            "Eventbrite header image skipped because the upload URL is unset",
            extra={"instance_id": str(getattr(instance, "id", "") or "")},
        )
        return None
    width, height = _png_size(banner) or (0, 0)
    instructions = eventbrite_request(
        method="GET",
        base_url=api_base_url,
        path="/media/upload/?type=image-event-logo",
        token=token,
    )
    upload_url = str(instructions.get("upload_url") or "").strip()
    if upload_url != expected_url:
        logger.warning(
            "Eventbrite header image skipped because the upload URL is not allowed",
            extra={"instance_id": str(getattr(instance, "id", "") or "")},
        )
        return None
    if str(instructions.get("upload_method") or "").upper() != "POST":
        raise ValueError("Eventbrite image upload method is not POST")
    upload_token = _single_line(instructions.get("upload_token"))
    fields = _upload_fields(instructions.get("upload_data"))
    file_field = str(instructions.get("file_parameter_name") or "").strip()
    if not _FILE_FIELD_NAME.fullmatch(file_field):
        raise ValueError("Eventbrite image file field name is not allowed")
    slug = str(getattr(instance, "slug", "") or "").strip()
    body, content_type = _multipart_body(
        fields,
        file_field=file_field,
        filename=f"{slug}.png",
        file_bytes=banner,
    )
    response = http_invoke(
        method="POST",
        url=upload_url,
        headers={"Content-Type": content_type},
        body_bytes=body,
        timeout=30,
    )
    status = int(response.get("status") or 0)
    if status < 200 or status >= 300:
        raise _ImageUploadError(status)
    created = eventbrite_request(
        method="POST",
        base_url=api_base_url,
        path="/media/upload/",
        token=token,
        payload={
            "upload_token": upload_token,
            # The banner is already 2:1, so the crop is the whole image.
            # An inset origin would no longer be exactly twice as wide.
            "crop_mask": {
                "top_left": {"x": 0, "y": 0},
                "width": width,
                "height": height,
            },
        },
    )
    logo_id = str(created.get("id") or "").strip()
    if not logo_id:
        raise ValueError("Eventbrite image upload response missing id")
    return logo_id


def _upload_fields(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        raise ValueError("Eventbrite image upload fields are missing")
    fields: dict[str, str] = {}
    for key, item in value.items():
        name = str(key)
        if not _FILE_FIELD_NAME.fullmatch(name):
            raise ValueError("Eventbrite image upload field name is not allowed")
        fields[name] = _single_line(item)
    return fields


def _single_line(value: Any) -> str:
    if not isinstance(value, str) or not value or "\r" in value or "\n" in value:
        raise ValueError("Eventbrite image upload field is not a single line")
    return value


def _multipart_body(
    fields: dict[str, str],
    *,
    file_field: str,
    filename: str,
    file_bytes: bytes,
) -> tuple[bytes, str]:
    """Signed fields first, then the file. S3 rejects any other order."""
    boundary = f"EvolveSprouts{uuid4().hex}"
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                f"{value}\r\n"
            ).encode()
        )
    chunks.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{file_field}"; '
            f'filename="{filename}"\r\n'
            "Content-Type: image/png\r\n\r\n"
        ).encode()
        + file_bytes
        + b"\r\n"
    )
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _usable_banner(instance: Any) -> bytes | None:
    path = _banner_path(instance)
    if path is None:
        return None
    try:
        data = path.read_bytes()
    except OSError:
        logger.warning(
            "Eventbrite banner could not be read",
            extra={"slug": str(getattr(instance, "slug", "") or "")},
        )
        return None
    if len(data) > _MAX_BANNER_BYTES or _png_size(data) is None:
        logger.warning(
            "Eventbrite banner is not a 2:1 PNG under the size cap",
            extra={"slug": str(getattr(instance, "slug", "") or "")},
        )
        return None
    return data


def _banner_path(instance: Any) -> Path | None:
    slug = str(getattr(instance, "slug", "") or "").strip()
    directory = _banners_dir()
    if directory is None or not PUBLIC_INSTANCE_SLUG_PATTERN.fullmatch(slug):
        return None
    root = directory.resolve()
    candidate = (root / f"{slug}.png").resolve()
    if candidate.parent != root or not candidate.is_file():
        return None
    return candidate


def _banners_dir() -> Path | None:
    override = os.getenv(_ENV_BANNERS_DIR, "").strip()
    if override:
        path = Path(override)
        if path.is_dir():
            return path
        logger.warning(
            "Eventbrite banner directory is missing",
            extra={"env": _ENV_BANNERS_DIR},
        )
        return None

    module_path = Path(__file__).resolve()
    candidates = []
    if len(module_path.parents) > 3:
        candidates.append(module_path.parents[3] / "content" / "eventbrite-banners")
    if len(module_path.parents) > 4:
        candidates.append(
            module_path.parents[4]
            / "apps"
            / "public_www"
            / "src"
            / "content"
            / "eventbrite-banners"
        )
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return None


def _png_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or not data.startswith(_PNG_SIGNATURE):
        return None
    if data[12:16] != b"IHDR":
        return None
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    if width <= 0 or height <= 0 or width != height * 2:
        return None
    return width, height
