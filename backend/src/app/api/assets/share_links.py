"""Helpers for stable asset share-link tokens and URLs."""

from __future__ import annotations

from collections.abc import Sequence
import os
import re
import secrets
from urllib.parse import urlparse
from typing import Any
from collections.abc import Mapping

from app.exceptions import ValidationError

_SHARE_TOKEN_BYTES = 24
_SHARE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{24,128}$")
SHARE_ASSET_PATH_PREFIX = "/v1/assets/share"
EMAIL_DOWNLOAD_PATH_PREFIX = "/v1/assets/email-download"
_SHARE_PATH_PREFIX = SHARE_ASSET_PATH_PREFIX
_MAX_ALLOWED_DOMAINS = 20
_DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$"
)


def generate_share_token() -> str:
    """Generate a URL-safe bearer token for asset sharing."""
    return secrets.token_urlsafe(_SHARE_TOKEN_BYTES)


def is_valid_share_token(token: str) -> bool:
    """Return whether a token matches the accepted share-token format."""
    return bool(_SHARE_TOKEN_RE.fullmatch(token))


def build_configured_share_asset_url(*, share_token: str) -> str | None:
    """Build share URL when ``ASSET_SHARE_LINK_BASE_URL`` is set (no request context)."""
    configured_base = os.getenv("ASSET_SHARE_LINK_BASE_URL", "").strip().rstrip("/")
    if not configured_base:
        return None
    return f"{configured_base}{SHARE_ASSET_PATH_PREFIX}/{share_token}"


def build_configured_email_download_url(*, share_token: str) -> str | None:
    """Build email-download URL when ``ASSET_SHARE_LINK_BASE_URL`` is set."""
    configured_base = os.getenv("ASSET_SHARE_LINK_BASE_URL", "").strip().rstrip("/")
    if not configured_base:
        return None
    return f"{configured_base}{EMAIL_DOWNLOAD_PATH_PREFIX}/{share_token}"


def build_share_link_url(event: Mapping[str, Any], token: str) -> str:
    """Build the stable public share URL for a token."""
    configured_base = os.getenv("ASSET_SHARE_LINK_BASE_URL", "").strip().rstrip("/")
    if configured_base:
        return f"{configured_base}{_SHARE_PATH_PREFIX}/{token}"

    request_base = _derive_request_base_url(event).rstrip("/")
    return f"{request_base}{_SHARE_PATH_PREFIX}/{token}"


def resolve_default_allowed_domains() -> list[str]:
    """Resolve default allowed source domains for newly-created share links."""
    configured = os.getenv("ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS", "").strip()
    if not configured:
        raise RuntimeError(
            "Missing required environment variable: "
            "ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS"
        )

    raw_domains = [part.strip() for part in configured.split(",") if part.strip()]
    try:
        return normalize_allowed_domains(raw_domains)
    except ValidationError as exc:
        raise RuntimeError(
            "ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS must contain one or more "
            "valid hostnames"
        ) from exc


def normalize_allowed_domains(raw_domains: Sequence[str]) -> list[str]:
    """Validate and normalize share-link source domain allowlist input."""
    if len(raw_domains) == 0:
        raise ValidationError(
            "allowed_domains must include at least one domain",
            field="allowed_domains",
        )
    if len(raw_domains) > _MAX_ALLOWED_DOMAINS:
        raise ValidationError(
            f"allowed_domains supports up to {_MAX_ALLOWED_DOMAINS} entries",
            field="allowed_domains",
        )

    normalized: list[str] = []
    seen: set[str] = set()
    for raw_domain in raw_domains:
        domain = _normalize_domain(raw_domain)
        if domain not in seen:
            seen.add(domain)
            normalized.append(domain)

    if not normalized:
        raise ValidationError(
            "allowed_domains must include at least one valid domain",
            field="allowed_domains",
        )
    return normalized


def extract_request_source_domain(event: Mapping[str, Any]) -> str | None:
    """Return the source domain inferred from Referer/Origin request headers."""
    headers = event.get("headers")
    if not isinstance(headers, Mapping):
        return None

    for header_name in ("referer", "referrer", "origin"):
        raw_value = _header_value(headers, header_name)
        domain = _extract_domain_from_url(raw_value)
        if domain:
            return domain
    return None


def _derive_request_base_url(event: Mapping[str, Any]) -> str:
    headers = event.get("headers")
    if not isinstance(headers, Mapping):
        raise RuntimeError("Request headers are required to build share links")

    host = _to_non_empty_string(headers.get("host") or headers.get("Host"))
    if not host:
        raise RuntimeError("Host header is required to build share links")

    scheme = (
        _to_non_empty_string(headers.get("x-forwarded-proto"))
        or _to_non_empty_string(headers.get("X-Forwarded-Proto"))
        or "https"
    )

    event_path = _to_non_empty_string(event.get("path")) or ""
    request_context = event.get("requestContext")
    request_context_path = ""
    if isinstance(request_context, Mapping):
        request_context_path = _to_non_empty_string(request_context.get("path")) or ""

    base_path = ""
    if (
        request_context_path
        and event_path
        and request_context_path.endswith(event_path)
    ):
        base_path = request_context_path[: -len(event_path)]
    if not base_path:
        # Custom-domain events can report requestContext.path without the
        # base path. The stage is that prefix on both hosts.
        base_path = _stage_prefix(request_context)

    return f"{scheme}://{host}{base_path}"


def _stage_prefix(request_context: Any) -> str:
    if not isinstance(request_context, Mapping):
        return ""
    stage = request_context.get("stage")
    if not isinstance(stage, str):
        return ""
    stage = stage.strip()
    if not stage or "/" in stage or stage in {".", ".."} or stage.startswith("$"):
        return ""
    return f"/{stage}"


def _normalize_domain(value: Any) -> str:
    if not isinstance(value, str):
        raise ValidationError(
            "allowed_domains must contain strings",
            field="allowed_domains",
        )

    domain = _extract_domain_from_url(value)
    if not domain:
        raise ValidationError(
            "allowed_domains entries must be valid hostnames",
            field="allowed_domains",
        )
    return domain


def _extract_domain_from_url(value: Any) -> str | None:
    normalized_value = _to_non_empty_string(value)
    if not normalized_value:
        return None

    parsed = urlparse(normalized_value)
    hostname = parsed.hostname
    if not hostname and "://" not in normalized_value:
        parsed = urlparse(f"https://{normalized_value}")
        hostname = parsed.hostname
    if not hostname:
        return None

    normalized_host = hostname.strip().lower().rstrip(".")
    if normalized_host == "localhost":
        return normalized_host
    if not _DOMAIN_RE.fullmatch(normalized_host):
        return None
    return normalized_host


def _header_value(headers: Mapping[str, Any], target_key: str) -> str | None:
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == target_key.lower():
            return _to_non_empty_string(value)
    return None


def _to_non_empty_string(value: Any) -> str | None:
    if isinstance(value, str):
        normalized = value.strip()
        return normalized if normalized else None
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized if normalized else None
