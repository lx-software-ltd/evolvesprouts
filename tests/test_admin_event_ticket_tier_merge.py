from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api import admin_service_instances_details
from app.api.admin_services_payload_utils import parse_uuid_list
from app.api.admin_services_payloads import parse_update_instance_payload
from app.db.models import EventCategory, ServiceType
from app.exceptions import ValidationError


def test_parse_uuid_list_reject_empty_members() -> None:
    with pytest.raises(ValidationError):
        parse_uuid_list(["", str(uuid4())], "ids", reject_empty_members=True)


def test_merge_single_tier_patch_preserves_extra_tier_rows() -> None:
    """Row D sends one tier; instance has two tiers — non-category tier unchanged."""
    service = SimpleNamespace(
        event_details=SimpleNamespace(
            event_category=EventCategory.WORKSHOP,
            default_price=Decimal("10.00"),
            default_currency="HKD",
        )
    )
    tier_cat = SimpleNamespace(
        name="workshop",
        description="d1",
        price=Decimal("5.00"),
        currency="HKD",
        max_quantity=10,
        sort_order=0,
    )
    tier_other = SimpleNamespace(
        name="vip",
        description="d2",
        price=Decimal("99.00"),
        currency="USD",
        max_quantity=2,
        sort_order=1,
    )
    instance = SimpleNamespace(ticket_tiers=[tier_cat, tier_other])
    resolved = [{"name": "workshop", "price": Decimal("25.00"), "currency": "EUR"}]
    merged = admin_service_instances_details.merge_event_ticket_tiers_with_existing(
        service,
        instance,
        resolved,  # type: ignore[arg-type]
    )
    assert len(merged) == 2
    by_name = {m["name"]: m for m in merged}
    assert by_name["workshop"]["price"] == Decimal("25.00")
    assert by_name["workshop"]["currency"] == "EUR"
    assert by_name["vip"]["price"] == Decimal("99.00")
    assert by_name["vip"]["currency"] == "USD"


def test_merge_multi_tier_requires_category_match() -> None:
    service = SimpleNamespace(
        event_details=SimpleNamespace(
            event_category=EventCategory.WORKSHOP,
            default_price=None,
            default_currency="HKD",
        )
    )
    instance = SimpleNamespace(
        ticket_tiers=[
            SimpleNamespace(
                name="alpha",
                description=None,
                price=Decimal("1"),
                currency="HKD",
                max_quantity=None,
                sort_order=0,
            ),
            SimpleNamespace(
                name="beta",
                description=None,
                price=Decimal("2"),
                currency="HKD",
                max_quantity=None,
                sort_order=1,
            ),
        ]
    )
    with pytest.raises(ValidationError) as exc:
        admin_service_instances_details.merge_event_ticket_tiers_with_existing(
            service, instance, [{"name": "workshop", "price": Decimal("5")}]
        )
    assert "event_ticket_tiers" in (exc.value.field or "")


def test_parse_update_event_instance_requires_tiers_with_other_fields() -> None:
    service = SimpleNamespace(service_type=ServiceType.EVENT)
    body = {"status": "scheduled", "title": "Updated title only"}
    with pytest.raises(ValidationError) as exc:
        parse_update_instance_payload(body, service)  # type: ignore[arg-type]
    assert exc.value.field == "event_ticket_tiers"
