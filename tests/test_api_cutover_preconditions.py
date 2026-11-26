"""String checks for the read-only API cutover script. No network."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "check_api_cutover_preconditions.py"
)
_spec = importlib.util.spec_from_file_location(
    "check_api_cutover_preconditions", _SCRIPT
)
assert _spec is not None and _spec.loader is not None
_checks = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_checks)


def test_custom_domain_responds() -> None:
    assert _checks.custom_domain_responds(200) is None
    assert _checks.custom_domain_responds(302) == "custom domain status 302"
    assert _checks.custom_domain_responds(503) == "custom domain status 503"


def test_execute_api_is_not_required() -> None:
    assert (
        _checks.execute_api_not_required(
            "https://api.example.com/health", '{"status":"ok"}'
        )
        is None
    )
    assert (
        _checks.execute_api_not_required(
            "https://abc.execute-api.ap-southeast-1.amazonaws.com/prod/health",
            "",
        )
        == "execute-api is still required"
    )
    assert (
        _checks.execute_api_not_required("https://api.example.com", "use execute-api")
        == "execute-api is still required"
    )


def test_site_bundle_has_no_old_public_prefix() -> None:
    assert _checks.site_bundle_has_no_www_v1('fetch("/api/v1/public/calendar")') is None
    assert (
        _checks.site_bundle_has_no_www_v1('fetch("/www/v1/calendar/public")')
        == "site bundle still contains /www/v1"
    )


def test_legacy_header_is_not_required() -> None:
    assert _checks.legacy_header_not_required("Authorization: Bearer") is None
    assert (
        _checks.legacy_header_not_required("send X-Api-Token")
        == "legacy token header is still required"
    )


def test_read_refuses_a_non_https_url() -> None:
    with pytest.raises(ValueError, match="not https"):
        _checks._read("file:///etc/passwd")


def test_redirect_to_http_is_refused() -> None:
    handler = _checks.HttpsOnlyRedirectHandler()
    request = _checks.Request("https://api.example.com/start")
    with pytest.raises(ValueError, match="not https"):
        handler.redirect_request(
            request,
            None,
            302,
            "Found",
            {},
            "http://api.example.com/next",
        )


def test_bundle_status_outside_success_is_a_finding() -> None:
    assert _checks.site_bundle_responds(200) is None
    assert _checks.site_bundle_responds(302) == "site bundle status 302"
    assert _checks.site_bundle_responds(404) == "site bundle status 404"


def test_main_reports_a_refused_url(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv(_checks.CUSTOM_DOMAIN_URL_ENV, "file:///etc/passwd")
    monkeypatch.setenv(_checks.SITE_BUNDLE_URL_ENV, "https://example.com/bundle.js")
    assert _checks.main() == 1
    assert "not https" in capsys.readouterr().out


def test_skips_when_url_env_is_unset(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv(_checks.CUSTOM_DOMAIN_URL_ENV, raising=False)
    monkeypatch.delenv(_checks.SITE_BUNDLE_URL_ENV, raising=False)
    assert _checks.main() == 0
    assert capsys.readouterr().out.strip() == "skipped"
