"""Per-type detail helpers for admin service instances.

Builds and applies training details and event ticket tiers.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.db.models import (
    EventCategory,
    EventTicketTier,
    Service,
    ServiceInstance,
    ServiceType,
    TrainingFormat,
    TrainingInstanceDetails,
)
from app.exceptions import ValidationError


def _event_category_name(service: Service) -> str:
    if service.event_details is not None:
        return service.event_details.event_category.value
    return EventCategory.WORKSHOP.value


def resolve_event_ticket_tiers_for_persist(
    service: Service, parsed_tiers: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Fill missing tier currency from service event defaults; default name from category.

    Missing ``price`` uses the service-level ``default_price`` when set; otherwise
    callers must supply an explicit price (no silent zero).
    """
    if not parsed_tiers:
        parsed_tiers = [{}]
    event_details = service.event_details
    default_price = event_details.default_price if event_details is not None else None
    default_currency = (
        event_details.default_currency if event_details is not None else "HKD"
    )
    category_name = _event_category_name(service)
    resolved: list[dict[str, Any]] = []
    for idx, tier in enumerate(parsed_tiers):
        price = tier.get("price")
        if price is None:
            if default_price is not None:
                price = default_price
            else:
                raise ValidationError(
                    "Each event_ticket_tiers entry must include price, or the service "
                    "must define event_details.default_price",
                    field="event_ticket_tiers",
                )
        currency = tier.get("currency") or default_currency
        name = tier.get("name") or category_name
        resolved.append(
            {
                "name": name,
                "description": tier.get("description"),
                "price": price,
                "currency": currency,
                "max_quantity": tier.get("max_quantity"),
                "sort_order": tier.get("sort_order")
                if tier.get("sort_order") is not None
                else idx,
            }
        )
    return resolved


def merge_event_ticket_tiers_with_existing(
    service: Service,
    instance: ServiceInstance | None,
    resolved_tiers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Preserve multi-tier rows and non-category tier metadata when the UI sends one tier.

    When the instance already has ticket tiers and the client sends a single tier
    object (admin Row D), merge price/currency into the tier whose ``name`` matches
    the service event category, or the sole tier, and keep other tiers unchanged.
    When the client sends N tiers for an instance with N tiers, zip-merge by
    ``sort_order`` and preserve each existing tier's name, description, max_quantity,
    and sort_order while applying payload price/currency per row.
    """
    if instance is None or not instance.ticket_tiers:
        return resolved_tiers
    existing = sorted(
        instance.ticket_tiers,
        key=lambda row: (row.sort_order, str(getattr(row, "id", ""))),
    )
    category_name = _event_category_name(service)

    if len(resolved_tiers) == 1:
        patch = resolved_tiers[0]
        if len(existing) == 1:
            t = existing[0]
            return [
                {
                    **patch,
                    "name": t.name,
                    "description": t.description,
                    "max_quantity": t.max_quantity,
                    "sort_order": t.sort_order,
                }
            ]
        match_index = next(
            (i for i, t in enumerate(existing) if t.name == category_name), None
        )
        if match_index is None:
            raise ValidationError(
                "This instance has multiple ticket tiers; none matches the service "
                f"event category ({category_name!r}). Send a full event_ticket_tiers "
                "array with one entry per tier to update prices.",
                field="event_ticket_tiers",
            )
        merged: list[dict[str, Any]] = []
        for t in existing:
            if t.name == category_name:
                merged.append(
                    {
                        **patch,
                        "name": t.name,
                        "description": t.description,
                        "max_quantity": t.max_quantity,
                        "sort_order": t.sort_order,
                    }
                )
            else:
                merged.append(
                    {
                        "name": t.name,
                        "description": t.description,
                        "price": t.price,
                        "currency": t.currency,
                        "max_quantity": t.max_quantity,
                        "sort_order": t.sort_order,
                    }
                )
        return merged

    if len(resolved_tiers) != len(existing):
        raise ValidationError(
            "event_ticket_tiers length must match the number of existing tiers "
            f"({len(existing)}); send {len(existing)} tier objects or a single tier "
            "for category-scoped price updates.",
            field="event_ticket_tiers",
        )
    res_sorted = sorted(
        resolved_tiers,
        key=lambda row: row.get("sort_order", 0),
    )
    out: list[dict[str, Any]] = []
    for t, p in zip(existing, res_sorted, strict=True):
        out.append(
            {
                "name": t.name,
                "description": t.description,
                "price": p["price"],
                "currency": p.get("currency") or t.currency,
                "max_quantity": t.max_quantity,
                "sort_order": t.sort_order,
            }
        )
    return out


def build_instance_type_details(
    service_type: ServiceType, parsed: Mapping[str, Any]
) -> Any:
    if service_type == ServiceType.TRAINING_COURSE:
        return TrainingInstanceDetails(
            training_format=TrainingFormat(parsed["training_format"].value),
            price=parsed["price"],
            currency=parsed["currency"],
            pricing_unit=parsed["pricing_unit"],
        )
    if service_type == ServiceType.EVENT:
        return [
            EventTicketTier(
                name=tier["name"],
                description=tier["description"],
                price=tier["price"],
                currency=tier["currency"],
                max_quantity=tier["max_quantity"],
                sort_order=tier["sort_order"],
            )
            for tier in parsed["event_ticket_tiers"]
        ]
    return None


def apply_instance_type_details(
    *,
    instance: ServiceInstance,
    service_type: ServiceType,
    parsed_details: Mapping[str, Any],
) -> None:
    if service_type == ServiceType.EVENT:
        raw_tiers = parsed_details.get("event_ticket_tiers")
        if not isinstance(raw_tiers, list):
            raise ValidationError(
                "event_ticket_tiers must be an array", field="event_ticket_tiers"
            )
        tiers_data: list[dict[str, Any]] = list(raw_tiers)
        tiers_sorted = sorted(tiers_data, key=lambda d: d["sort_order"])
        existing_sorted = sorted(
            instance.ticket_tiers,
            key=lambda t: (t.sort_order, str(t.id)),
        )
        if existing_sorted and len(tiers_sorted) == len(existing_sorted):
            for tier_row, data in zip(existing_sorted, tiers_sorted, strict=True):
                tier_row.name = data["name"]
                tier_row.description = data.get("description")
                tier_row.price = data["price"]
                tier_row.currency = data["currency"]
                tier_row.max_quantity = data.get("max_quantity")
                tier_row.sort_order = data["sort_order"]
        else:
            instance.ticket_tiers.clear()
            for data in tiers_sorted:
                instance.ticket_tiers.append(
                    EventTicketTier(
                        name=data["name"],
                        description=data.get("description"),
                        price=data["price"],
                        currency=data["currency"],
                        max_quantity=data.get("max_quantity"),
                        sort_order=data["sort_order"],
                    )
                )
        instance.training_details = None
        return

    if service_type == ServiceType.TRAINING_COURSE:
        details = build_instance_type_details(service_type, parsed_details)
        instance.training_details = details
        instance.ticket_tiers.clear()
        return

    instance.training_details = None
    instance.ticket_tiers.clear()
