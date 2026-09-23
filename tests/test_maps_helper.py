"""Tests for Google Maps directions URL helper."""

from __future__ import annotations

from decimal import Decimal
from urllib.parse import quote_plus

from app.utils.maps import _BASE, build_google_maps_directions_url


def test_coord_preferred_over_address() -> None:
    url = build_google_maps_directions_url(
        address="123 Main St",
        lat=Decimal("22.319300"),
        lng=Decimal("114.169400"),
    )
    assert url is not None
    assert url.startswith(_BASE)
    assert "22.3193%2C114.1694" in url


def test_coord_strips_trailing_zeros() -> None:
    url = build_google_maps_directions_url(
        address=None,
        lat=Decimal("1.000000"),
        lng=Decimal("2.000000"),
    )
    assert url == f"{_BASE}{quote_plus('1,2')}"


def test_partial_coords_falls_back_to_address() -> None:
    url = build_google_maps_directions_url(
        address="Foo Bar",
        lat=Decimal("1"),
        lng=None,
    )
    assert url == f"{_BASE}{quote_plus('Foo Bar')}"


def test_address_apostrophe_and_space_byte_shape() -> None:
    addr = "Sample Street"
    url = build_google_maps_directions_url(address=addr, lat=None, lng=None)
    assert url == f"{_BASE}{quote_plus(addr)}"


def test_empty_address_no_coords_returns_none() -> None:
    assert build_google_maps_directions_url(address="   ", lat=None, lng=None) is None
    assert build_google_maps_directions_url(address=None, lat=None, lng=None) is None


def test_high_precision_decimal_quantized_to_six_places() -> None:
    url = build_google_maps_directions_url(
        address=None,
        lat=Decimal("1.234567891234"),
        lng=Decimal("5"),
    )
    assert url == f"{_BASE}{quote_plus('1.234568,5')}"


def test_unicode_address_uses_quote_plus() -> None:
    addr = "中環"
    url = build_google_maps_directions_url(address=addr, lat=None, lng=None)
    assert url == f"{_BASE}{quote_plus(addr)}"
