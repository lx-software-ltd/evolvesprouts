from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.auth.authorizer_utils import extract_bearer_token
from app.api.assets import share_assets
from app.api.assets.assets_storage import signed_link_no_cache_headers
from app.api.assets.admin_share_links import (
    ensure_default_share_link_for_public_asset,
)
from app.api.assets.share_links import (
    extract_request_source_domain,
    build_configured_email_download_url,
    build_configured_share_asset_url,
    build_share_link_url,
    generate_share_token,
    is_valid_share_token,
    normalize_allowed_domains,
    resolve_default_allowed_domains,
)
from app.exceptions import ValidationError


def test_generate_share_token_is_url_safe() -> None:
    token = generate_share_token()
    assert is_valid_share_token(token) is True


def test_is_valid_share_token_rejects_invalid_values() -> None:
    assert is_valid_share_token("short-token") is False
    assert is_valid_share_token("invalid token with spaces") is False
    assert is_valid_share_token("x" * 129) is False


def test_build_share_link_url_prefers_configured_base(monkeypatch: Any) -> None:
    monkeypatch.setenv("ASSET_SHARE_LINK_BASE_URL", "https://share.example.com/")
    url = build_share_link_url(event={}, token="A" * 24)
    assert url == "https://share.example.com/v1/assets/share/" + ("A" * 24)


def test_build_configured_share_asset_url_matches_configured_base(
    monkeypatch: Any,
) -> None:
    monkeypatch.setenv("ASSET_SHARE_LINK_BASE_URL", "https://media.example.com")
    url = build_configured_share_asset_url(share_token="C" * 24)
    assert url == "https://media.example.com/v1/assets/share/" + ("C" * 24)


def test_build_configured_share_asset_url_returns_none_without_base(
    monkeypatch: Any,
) -> None:
    monkeypatch.delenv("ASSET_SHARE_LINK_BASE_URL", raising=False)
    assert build_configured_share_asset_url(share_token="D" * 24) is None


def test_build_configured_email_download_url_matches_configured_base(
    monkeypatch: Any,
) -> None:
    monkeypatch.setenv("ASSET_SHARE_LINK_BASE_URL", "https://media.example.com")
    url = build_configured_email_download_url(share_token="X" * 24)
    assert url == "https://media.example.com/v1/assets/email-download/" + ("X" * 24)


def test_build_configured_email_download_url_returns_none_without_base(
    monkeypatch: Any,
) -> None:
    monkeypatch.delenv("ASSET_SHARE_LINK_BASE_URL", raising=False)
    assert build_configured_email_download_url(share_token="Y" * 24) is None


def test_build_share_link_url_derives_stage_prefix(monkeypatch: Any) -> None:
    monkeypatch.delenv("ASSET_SHARE_LINK_BASE_URL", raising=False)
    event = {
        "headers": {
            "Host": "abc123.execute-api.ap-southeast-1.amazonaws.com",
            "X-Forwarded-Proto": "https",
        },
        "path": "/v1/admin/assets/9f0b/share-link",
        "requestContext": {
            "path": "/prod/v1/admin/assets/9f0b/share-link",
        },
    }
    url = build_share_link_url(event=event, token="B" * 24)
    assert (
        url
        == "https://abc123.execute-api.ap-southeast-1.amazonaws.com/prod/v1/assets/share/"
        + ("B" * 24)
    )


def test_signed_link_no_cache_headers_are_strict() -> None:
    headers = signed_link_no_cache_headers()
    assert headers["Cache-Control"] == (
        "no-store, no-cache, must-revalidate, private, max-age=0"
    )
    assert headers["Pragma"] == "no-cache"
    assert headers["Expires"] == "0"


def test_resolve_default_allowed_domains_reads_required_env(monkeypatch: Any) -> None:
    monkeypatch.setenv(
        "ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS",
        "www.example.com,www-staging.example.com",
    )
    assert resolve_default_allowed_domains() == [
        "www.example.com",
        "www-staging.example.com",
    ]


def test_resolve_default_allowed_domains_requires_env(monkeypatch: Any) -> None:
    monkeypatch.delenv("ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS", raising=False)
    with pytest.raises(
        RuntimeError,
        match="Missing required environment variable: "
        "ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS",
    ):
        resolve_default_allowed_domains()


def test_resolve_default_allowed_domains_rejects_invalid_env(monkeypatch: Any) -> None:
    monkeypatch.setenv("ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS", "not a domain")
    with pytest.raises(
        RuntimeError,
        match=(
            "ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS "
            "must contain one or more valid hostnames"
        ),
    ):
        resolve_default_allowed_domains()


def test_normalize_allowed_domains_accepts_urls_and_deduplicates() -> None:
    allowed_domains = normalize_allowed_domains(
        [
            "https://www.example.com/page",
            "WWW.EXAMPLE.COM",
            "www-staging.example.com",
        ]
    )
    assert allowed_domains == [
        "www.example.com",
        "www-staging.example.com",
    ]


def test_normalize_allowed_domains_rejects_invalid_input() -> None:
    with pytest.raises(ValidationError):
        normalize_allowed_domains(["not a domain"])


def test_ensure_default_share_link_creates_public_allowlist(monkeypatch: Any) -> None:
    from app.db.models import AssetVisibility

    monkeypatch.setenv(
        "ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS",
        "www.example.com,www-staging.example.com",
    )
    created: dict[str, Any] = {}

    class _Repo:
        def get_share_link(self, *, asset_id: Any) -> None:
            return None

        def create_share_link(self, **kwargs: Any) -> None:
            created.update(kwargs)

    asset_id = uuid4()
    ensure_default_share_link_for_public_asset(
        _Repo(),  # type: ignore[arg-type]
        asset_id=asset_id,
        visibility=AssetVisibility.PUBLIC,
        created_by="admin-sub",
    )

    assert created["asset_id"] == asset_id
    assert created["allowed_domains"] == [
        "www.example.com",
        "www-staging.example.com",
    ]
    assert created["created_by"] == "admin-sub"
    assert created["share_token"]


def test_ensure_default_share_link_skips_restricted_assets() -> None:
    from app.db.models import AssetVisibility

    class _Repo:
        def get_share_link(self, *, asset_id: Any) -> None:
            raise AssertionError("restricted assets must not look up share links")

        def create_share_link(self, **kwargs: Any) -> None:
            raise AssertionError("restricted assets must not create share links")

    ensure_default_share_link_for_public_asset(
        _Repo(),  # type: ignore[arg-type]
        asset_id=uuid4(),
        visibility=AssetVisibility.RESTRICTED,
        created_by="admin-sub",
    )


def test_ensure_default_share_link_skips_existing_link(monkeypatch: Any) -> None:
    from types import SimpleNamespace

    from app.db.models import AssetVisibility

    monkeypatch.setenv("ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS", "www.example.com")

    class _Repo:
        def get_share_link(self, *, asset_id: Any) -> object:
            return SimpleNamespace(asset_id=asset_id)

        def create_share_link(self, **kwargs: Any) -> None:
            raise AssertionError("existing share links must not be replaced")

    ensure_default_share_link_for_public_asset(
        _Repo(),  # type: ignore[arg-type]
        asset_id=uuid4(),
        visibility=AssetVisibility.PUBLIC,
        created_by="admin-sub",
    )


def test_ensure_default_share_link_skips_when_defaults_missing(
    monkeypatch: Any,
) -> None:
    from app.db.models import AssetVisibility

    monkeypatch.delenv("ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS", raising=False)

    class _Repo:
        def get_share_link(self, *, asset_id: Any) -> None:
            return None

        def create_share_link(self, **kwargs: Any) -> None:
            raise AssertionError("missing defaults must not create a share link")

    ensure_default_share_link_for_public_asset(
        _Repo(),  # type: ignore[arg-type]
        asset_id=uuid4(),
        visibility=AssetVisibility.PUBLIC,
        created_by="admin-sub",
    )


def test_extract_request_source_domain_prefers_referer() -> None:
    event = {
        "headers": {
            "Referer": "https://www.example.com/articles/downloads",
            "Origin": "https://ignored.example.com",
        }
    }
    assert extract_request_source_domain(event) == "www.example.com"


def test_extract_request_source_domain_uses_origin_fallback() -> None:
    event = {"headers": {"Origin": "https://www.example.com"}}
    assert extract_request_source_domain(event) == "www.example.com"


def test_extract_request_source_domain_returns_none_for_invalid_header() -> None:
    event = {"headers": {"Referer": "bad value"}}
    assert extract_request_source_domain(event) is None


def test_extract_bearer_token_reads_authorization_header() -> None:
    headers = {"Authorization": "Bearer abc.def.ghi"}
    assert extract_bearer_token(headers) == "abc.def.ghi"


def test_extract_bearer_token_accepts_non_bearer_value() -> None:
    headers = {"authorization": "raw-token"}
    assert extract_bearer_token(headers) == "raw-token"


def test_restricted_share_authentication_accepts_valid_token(monkeypatch: Any) -> None:
    class Claims:
        sub = "user-sub-123"

    monkeypatch.setattr(
        share_assets,
        "decode_and_verify_token",
        lambda token: Claims(),  # noqa: ARG005
    )
    event = {"headers": {"Authorization": "Bearer valid.jwt.token"}}
    assert share_assets._is_restricted_share_request_authenticated(event) is True


def test_restricted_share_authentication_rejects_invalid_token(
    monkeypatch: Any,
) -> None:
    def _raise_invalid_token(token: str) -> Any:  # noqa: ARG001
        raise share_assets.JWTValidationError("invalid token")

    monkeypatch.setattr(share_assets, "decode_and_verify_token", _raise_invalid_token)
    event = {"headers": {"Authorization": "Bearer invalid.jwt.token"}}
    assert share_assets._is_restricted_share_request_authenticated(event) is False
