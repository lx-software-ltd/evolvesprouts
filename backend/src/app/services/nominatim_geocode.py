"""Geocode addresses via OpenStreetMap Nominatim (through AwsApiProxy)."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any
from urllib.parse import urlencode

from app.exceptions import AppError, ValidationError
from app.services.aws_proxy import AwsProxyError, http_invoke
from app.utils import require_env

_NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search"
# Floor markers such as ``G/F``, ``5/F``, ``LG/F``, ``Level 20``.
_FLOOR_SEGMENT = re.compile(
    r"(?i)/\s*f\b|\b(?:g|lg|ug|m)\s*/\s*f\b|\b(?:level|lvl|floor|fl)\s*\d+"
)
_UNIT_SEGMENT = re.compile(
    r"(?i)\b(?:flat|unit|apt|apartment|suite|room|rm|shop|studio)\b"
)
_STRUCTURE_SEGMENT = re.compile(r"(?i)\b(?:block|blk|tower|twr|court|wing|phase|ph)\b")
_ESTATE_SEGMENT = re.compile(
    r"(?i)\b(?:estate|villas?|buildings?|bldg|mansion|range|"
    r"residenc(?:e|y)|apartments?|centre|center|plaza|mall)\b"
)
_STREET_TYPE = re.compile(
    r"(?i)\b(?:"
    r"streets?|st|roads?|rd|avenues?|ave|lanes?|ln|"
    r"drives?|dr|crescents?|cres|terraces?|ter|"
    r"paths?|ways?|highways?|hwy|boulevards?|blvd|"
    r"places?|pl|closes?|circles?|circu(?:it|s)|"
    r"rows?|parades?|quays?|promenades?|walks?|"
    r"rises?|hills?|gaps?|alleys?"
    r")\b"
)
# Leading house number or range, e.g. ``9``, ``1A``, ``36-44``.
_HOUSE_NUMBER = re.compile(r"^\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\b", re.IGNORECASE)
# Building-style ``Name 50`` (words then a trailing number, no street type).
_TRAILING_BUILDING_NUMBER = re.compile(r"(?i)^(?=.*[a-z]).+\s+\d+[a-z]?$")


def _classify_geocode_segment(part: str) -> str:
    """Return ``street``, ``place``, or ``drop`` for one comma-separated part."""
    if (
        _FLOOR_SEGMENT.search(part)
        or _UNIT_SEGMENT.search(part)
        or _STRUCTURE_SEGMENT.search(part)
    ):
        return "drop"
    if _ESTATE_SEGMENT.search(part) and _STREET_TYPE.search(part) is None:
        return "drop"
    if _STREET_TYPE.search(part):
        return "street"
    if _HOUSE_NUMBER.match(part) and re.search(r"[A-Za-z]", part):
        return "street"
    if _TRAILING_BUILDING_NUMBER.match(part):
        return "drop"
    return "place"


def _geocode_query_text(address: str) -> str:
    """Free-text query: street number/road plus neighbourhood, not unit or estate."""
    raw = address.strip()
    if not raw:
        return ""
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if not parts:
        return ""

    kinds = [_classify_geocode_segment(part) for part in parts]
    street_indexes = [i for i, kind in enumerate(kinds) if kind == "street"]
    if street_indexes:
        start = street_indexes[0]
        kept = [
            parts[i]
            for i in range(start, len(parts))
            if kinds[i] in ("street", "place")
        ]
    else:
        kept = [parts[i] for i, kind in enumerate(kinds) if kind == "place"]
    return ", ".join(kept) if kept else raw


def _countrycodes_param(country_iso_codes: Sequence[str] | None) -> str | None:
    """Build ``countrycodes`` query value from DB-derived ISO codes."""
    if not country_iso_codes:
        return None
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in country_iso_codes:
        if not raw:
            continue
        cc = str(raw).strip().lower()
        if len(cc) != 2 or not cc.isalpha() or cc in seen:
            continue
        seen.add(cc)
        ordered.append(cc)
    return ",".join(ordered) if ordered else None


def geocode_address_with_context(
    *,
    address: str,
    country_iso_codes: Sequence[str] | None = None,
) -> tuple[float, float, str | None]:
    """Return (lat, lng, display_name) for a free-text address.

    Args:
        address: Street or venue address. The geocoder query keeps the street
            number, street/road, and neighbourhood portions. Unit, floor,
            block, tower, and estate/building segments are dropped.
        country_iso_codes: Optional ISO 3166-1 alpha-2 values (e.g. from
            ``geographic_areas`` and ``sovereign_country_id``) for the
            ``countrycodes`` query parameter (comma-separated OR filter).

    Raises:
        ValidationError: When input is empty or the provider returns no results.
        AppError: On proxy failures, bad HTTP status, or invalid response payload.
    """
    q = _geocode_query_text(address)
    if not q:
        raise ValidationError("address is required", field="address")

    params: dict[str, str | int] = {
        "format": "json",
        "limit": 1,
        "q": q,
    }
    codes = _countrycodes_param(country_iso_codes)
    if codes:
        params["countrycodes"] = codes

    url = f"{_NOMINATIM_SEARCH}?{urlencode(params)}"
    user_agent = require_env("NOMINATIM_USER_AGENT").strip()
    referer = require_env("NOMINATIM_REFERER").strip()
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/json",
        "Accept-Language": "en",
    }
    if referer:
        headers["Referer"] = referer

    try:
        raw = http_invoke("GET", url, headers=headers, timeout=15)
    except AwsProxyError as exc:
        raise AppError(
            "Geocoding service unavailable",
            status_code=502,
            detail=exc.message,
        ) from exc
    except RuntimeError as exc:
        raise AppError(
            "Geocoding is not configured",
            status_code=503,
            detail=str(exc),
        ) from exc

    status = int(raw.get("status", 0))
    body = raw.get("body")
    if not isinstance(body, str):
        raise AppError("Invalid geocoding response", status_code=502)
    if status != 200:
        raise AppError(
            "Geocoding provider returned an error",
            status_code=502,
            detail=f"HTTP {status}",
        )

    try:
        parsed: Any = json.loads(body)
    except json.JSONDecodeError as exc:
        raise AppError("Invalid geocoding response", status_code=502) from exc

    if not isinstance(parsed, list) or not parsed:
        raise ValidationError(
            "No geocoding results for this address",
            field="address",
        )

    first = parsed[0]
    if not isinstance(first, dict):
        raise AppError("Invalid geocoding response", status_code=502)

    lat_raw = first.get("lat")
    lon_raw = first.get("lon")
    if not isinstance(lat_raw, (str, int, float)) or not isinstance(
        lon_raw, (str, int, float)
    ):
        raise AppError("Invalid geocoding response", status_code=502)
    try:
        lat = float(lat_raw)
        lng = float(lon_raw)
    except (TypeError, ValueError) as exc:
        raise AppError("Invalid geocoding response", status_code=502) from exc

    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        raise AppError("Invalid coordinates from geocoding provider", status_code=502)

    display = first.get("display_name")
    display_name = display.strip() if isinstance(display, str) else None

    return lat, lng, display_name
