from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest

from app.exceptions import AppError, ValidationError
from app.services import nominatim_geocode


def test_geocode_success_with_multiple_country_codes(monkeypatch: Any) -> None:
    monkeypatch.setenv("NOMINATIM_USER_AGENT", "TestAgent/1.0")
    monkeypatch.setenv("NOMINATIM_REFERER", "https://example.com")

    def fake_http_invoke(
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        body: str | None = None,
        timeout: int = 10,
    ) -> dict[str, Any]:
        assert method == "GET"
        assert "nominatim.openstreetmap.org/search" in url
        assert headers is not None
        assert headers.get("User-Agent") == "TestAgent/1.0"
        assert headers.get("Referer") == "https://example.com"
        codes = parse_qs(urlparse(url).query).get("countrycodes", [""])[0]
        assert codes.lower() == "hk,cn"
        q = parse_qs(urlparse(url).query).get("q", [""])[0]
        assert q == "123 Main St"
        payload = '[{"lat":"1.5","lon":"2.5","display_name":"Somewhere"}]'
        return {"status": 200, "body": payload}

    monkeypatch.setattr(nominatim_geocode, "http_invoke", fake_http_invoke)

    lat, lng, name = nominatim_geocode.geocode_address_with_context(
        address="123 Main St",
        country_iso_codes=["HK", "CN"],
    )
    assert lat == 1.5
    assert lng == 2.5
    assert name == "Somewhere"


def test_geocode_strips_address_through_floor_segment(monkeypatch: Any) -> None:
    monkeypatch.setenv("NOMINATIM_USER_AGENT", "TestAgent/1.0")
    monkeypatch.setenv("NOMINATIM_REFERER", "https://example.com")

    seen: list[str] = []

    def capture_url(
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        body: str | None = None,
        timeout: int = 10,
    ) -> dict[str, Any]:
        seen.append(url)
        return {"status": 200, "body": '[{"lat":"0","lon":"0","display_name":"x"}]'}

    monkeypatch.setattr(nominatim_geocode, "http_invoke", capture_url)

    addr = "1, 1/F, Example Tower, 1 Sample Street, Hong Kong"
    nominatim_geocode.geocode_address_with_context(address=addr, country_iso_codes=None)
    q = parse_qs(urlparse(seen[0]).query).get("q", [""])[0]
    assert q == "Example Tower, 1 Sample Street, Hong Kong"


def test_geocode_strips_g_floor_segment(monkeypatch: Any) -> None:
    monkeypatch.setenv("NOMINATIM_USER_AGENT", "TestAgent/1.0")
    monkeypatch.setenv("NOMINATIM_REFERER", "https://example.com")

    seen: list[str] = []

    def capture_url(
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        body: str | None = None,
        timeout: int = 10,
    ) -> dict[str, Any]:
        seen.append(url)
        return {"status": 200, "body": '[{"lat":"0","lon":"0","display_name":"x"}]'}

    monkeypatch.setattr(nominatim_geocode, "http_invoke", capture_url)

    nominatim_geocode.geocode_address_with_context(
        address="Shop 3, G/F, 10 Sample Road",
        country_iso_codes=None,
    )
    q = parse_qs(urlparse(seen[0]).query).get("q", [""])[0]
    assert q == "10 Sample Road"


def test_geocode_strips_floor_segment_with_spaces(monkeypatch: Any) -> None:
    monkeypatch.setenv("NOMINATIM_USER_AGENT", "TestAgent/1.0")
    monkeypatch.setenv("NOMINATIM_REFERER", "https://example.com")

    seen: list[str] = []

    def capture_url(
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        body: str | None = None,
        timeout: int = 10,
    ) -> dict[str, Any]:
        seen.append(url)
        return {"status": 200, "body": '[{"lat":"0","lon":"0","display_name":"x"}]'}

    monkeypatch.setattr(nominatim_geocode, "http_invoke", capture_url)

    nominatim_geocode.geocode_address_with_context(
        address="A, 12 / f, B Street",
        country_iso_codes=None,
    )
    q = parse_qs(urlparse(seen[0]).query).get("q", [""])[0]
    assert q == "B Street"


def test_geocode_countrycodes_order_and_dedupe(monkeypatch: Any) -> None:
    monkeypatch.setenv("NOMINATIM_USER_AGENT", "TestAgent/1.0")
    monkeypatch.setenv("NOMINATIM_REFERER", "https://example.com")

    seen: list[str] = []

    def capture_url(
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        body: str | None = None,
        timeout: int = 10,
    ) -> dict[str, Any]:
        seen.append(url)
        return {"status": 200, "body": '[{"lat":"0","lon":"0","display_name":"x"}]'}

    monkeypatch.setattr(nominatim_geocode, "http_invoke", capture_url)

    for codes, expect in (
        (["MO", "CN"], "mo,cn"),
        (["mo", "cn"], "mo,cn"),
        (["TW", " cn "], "tw,cn"),
        (["SG"], "sg"),
        (["HK", "CN", "hk"], "hk,cn"),
    ):
        seen.clear()
        nominatim_geocode.geocode_address_with_context(
            address="1 Test St",
            country_iso_codes=codes,
        )
        got = parse_qs(urlparse(seen[0]).query).get("countrycodes", [""])[0]
        assert got.lower() == expect


def test_geocode_rejects_empty_address() -> None:
    with pytest.raises(ValidationError):
        nominatim_geocode.geocode_address_with_context(
            address="   ",
            country_iso_codes=None,
        )


def test_geocode_proxy_error(monkeypatch: Any) -> None:
    monkeypatch.setenv("NOMINATIM_USER_AGENT", "TestAgent/1.0")
    monkeypatch.setenv("NOMINATIM_REFERER", "https://example.com")

    from app.services.aws_proxy import AwsProxyError

    def raise_proxy(*_a: Any, **_k: Any) -> None:
        raise AwsProxyError("Upstream", "boom")

    monkeypatch.setattr(nominatim_geocode, "http_invoke", raise_proxy)

    with pytest.raises(AppError) as exc:
        nominatim_geocode.geocode_address_with_context(
            address="x",
            country_iso_codes=None,
        )
    assert exc.value.status_code == 502


def test_geocode_no_results(monkeypatch: Any) -> None:
    monkeypatch.setenv("NOMINATIM_USER_AGENT", "TestAgent/1.0")
    monkeypatch.setenv("NOMINATIM_REFERER", "https://example.com")

    monkeypatch.setattr(
        nominatim_geocode,
        "http_invoke",
        lambda *_a, **_k: {"status": 200, "body": "[]"},
    )

    with pytest.raises(ValidationError):
        nominatim_geocode.geocode_address_with_context(
            address="nowhere",
            country_iso_codes=None,
        )
