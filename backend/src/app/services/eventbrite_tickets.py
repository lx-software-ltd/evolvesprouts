"""Eventbrite ticket class payloads."""

from __future__ import annotations

from decimal import Decimal
from typing import Any


def build_ticket_class_payload(tier: Any) -> dict[str, Any]:
    is_free = _is_zero_or_less(tier.price)
    payload: dict[str, Any] = {
        "name": tier.name,
        "description": tier.description,
        "free": is_free,
        "quantity_total": int(tier.max_quantity)
        if tier.max_quantity is not None
        else None,
    }
    payload = {key: value for key, value in payload.items() if value is not None}
    if not is_free:
        amount = _decimal_to_minor_units(tier.price)
        payload["cost"] = f"{tier.currency.upper()},{amount}"
    return payload


def _decimal_to_minor_units(value: Decimal) -> int:
    return int((value * Decimal(100)).quantize(Decimal(1)))


def _is_zero_or_less(value: Decimal) -> bool:
    return value <= Decimal(0)
