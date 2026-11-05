"""Eventbrite venue body from an instance location."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.db.models import ServiceDeliveryMode
from app.utils.logging import get_logger

logger = get_logger(__name__)


def eventbrite_venue_body(instance: Any) -> dict[str, Any] | None:
    """Venue object for Eventbrite, or None when the listing stays unlocated.

    Online events and locations without an ISO country code are skipped.
    A missing venue does not fail the sync.
    """
    if _is_online(instance):
        return None
    location = _primary_location(instance)
    if location is None:
        return None
    name = _text(getattr(location, "name", None))
    street = _text(getattr(location, "address", None))
    address_1 = street or name
    if not name:
        name = address_1
    if not name or not address_1:
        return None

    chain = _area_chain(getattr(location, "area", None))
    country = _country_code(chain)
    if not country:
        logger.warning(
            "Eventbrite venue skipped because the location has no country code",
            extra={"instance_id": str(getattr(instance, "id", "") or "")},
        )
        return None
    city = _area_name(chain, "city") or _area_name(chain, "region") or name
    address: dict[str, str] = {
        "address_1": address_1,
        "city": city,
        "country": country,
    }
    region = _area_name(chain, "region")
    if region and region != city:
        address["region"] = region
    latitude = getattr(location, "lat", None)
    longitude = getattr(location, "lng", None)
    if latitude is not None and longitude is not None:
        address["latitude"] = str(latitude)
        address["longitude"] = str(longitude)
    return {"name": name, "address": address}


def attach_eventbrite_venue(
    instance: Any,
    *,
    venue_id: str | None,
    organization_id: str,
    call: Callable[..., dict[str, Any]],
    missing_id_error: type[Exception],
) -> str | None:
    """Create or update the Eventbrite venue and return its id."""
    body = eventbrite_venue_body(instance)
    if body is None:
        return None
    wrapped = {"venue": body}
    if venue_id:
        call(method="POST", path=f"/venues/{venue_id}/", payload=wrapped)
        return venue_id
    created = call(
        method="POST",
        path=f"/organizations/{organization_id}/venues/",
        payload=wrapped,
    )
    created_id = str(created.get("id") or "").strip()
    if not created_id:
        raise missing_id_error("Eventbrite venue create response missing id")
    return created_id


def _is_online(instance: Any) -> bool:
    service = getattr(instance, "service", None)
    mode = getattr(instance, "delivery_mode", None) or getattr(
        service, "delivery_mode", None
    )
    return mode == ServiceDeliveryMode.ONLINE


def _primary_location(instance: Any) -> Any | None:
    slots = sorted(
        getattr(instance, "session_slots", None) or [],
        key=lambda slot: (
            getattr(slot, "sort_order", 0),
            str(getattr(slot, "starts_at", "")),
        ),
    )
    if slots and getattr(slots[0], "location", None) is not None:
        return slots[0].location
    return getattr(instance, "location", None)


def _area_chain(area: Any) -> list[Any]:
    chain: list[Any] = []
    seen: set[int] = set()
    current = area
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        current = getattr(current, "parent", None)
    return chain


def _area_name(chain: list[Any], level: str) -> str:
    for area in chain:
        if _text(getattr(area, "level", None)) == level:
            name = _text(getattr(area, "name", None))
            if name:
                return name
    return ""


def _country_code(chain: list[Any]) -> str:
    for area in chain:
        if _text(getattr(area, "level", None)) != "country":
            continue
        code = _text(getattr(area, "code", None)).upper()
        if len(code) == 2 and code.isalpha():
            return code
    return ""


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()
