"""Tests for admin CRM map-pin selection and routing."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from app.api import admin_contacts
from app.api.admin_contacts_map import (
    build_map_pin_items,
    contact_ids_suppressed_by_mapped_families,
    is_confirmed_map_location,
)
from app.db.models.enums import ContactType, OrganizationType


def _location(
    *,
    address: str | None = "12 Queen's Road Central",
    lat: float | None = 22.2819,
    lng: float | None = 114.1582,
    area_name: str = "Central",
) -> SimpleNamespace:
    return SimpleNamespace(
        address=address,
        lat=lat,
        lng=lng,
        area=SimpleNamespace(name=area_name),
    )


def test_confirmed_location_requires_coords_and_address_text() -> None:
    assert is_confirmed_map_location(_location()) is True
    assert is_confirmed_map_location(None) is False
    assert is_confirmed_map_location(_location(lat=None)) is False
    assert is_confirmed_map_location(_location(lng=None)) is False
    assert is_confirmed_map_location(_location(address=None)) is False
    assert is_confirmed_map_location(_location(address="   ")) is False


def test_build_map_pin_items_hides_contacts_in_mapped_families() -> None:
    family_id = uuid4()
    member_id = uuid4()
    standalone_id = uuid4()
    org_id = uuid4()

    family_location = _location(address="1 Family Street")
    member_own_location = _location(address="99 Other Street", lat=22.3, lng=114.2)
    standalone_location = _location(address="8 Solo Street", lat=22.4, lng=114.1)
    org_location = _location(address="3 Org Road", lat=22.31, lng=114.17)

    member = SimpleNamespace(
        id=member_id,
        first_name="Ada",
        last_name="Chan",
        email=None,
        contact_type=ContactType.PARENT,
        location=member_own_location,
        family_members=[],
    )
    family_member = SimpleNamespace(contact_id=member_id, contact=member)
    family = SimpleNamespace(
        id=family_id,
        family_name="Chan family",
        location=family_location,
        family_members=[family_member],
    )

    standalone = SimpleNamespace(
        id=standalone_id,
        first_name="Lee",
        last_name="Wong",
        email=None,
        contact_type=ContactType.PROFESSIONAL,
        location=standalone_location,
        family_members=[],
    )
    organization = SimpleNamespace(
        id=org_id,
        name="Harbour School",
        organization_type=OrganizationType.SCHOOL,
        location=org_location,
        organization_members=[
            SimpleNamespace(
                contact=SimpleNamespace(
                    first_name="Pat",
                    last_name="Ho",
                    email=None,
                )
            )
        ],
    )
    items = build_map_pin_items(
        families=[family],
        organizations=[organization],
        contacts=[member, standalone],
    )
    ids = {item["id"] for item in items}
    types = {item["id"]: item["entity_type"] for item in items}

    assert str(family_id) in ids
    assert types[str(family_id)] == "family"
    assert str(org_id) in ids
    assert types[str(org_id)] == "organization"
    assert str(standalone_id) in ids
    assert types[str(standalone_id)] == "contact"
    assert str(member_id) not in ids

    family_pin = next(item for item in items if item["id"] == str(family_id))
    assert family_pin["address"] == "1 Family Street"
    assert family_pin["member_labels"] == ["Ada Chan"]
    assert family_pin["lat"] == 22.2819
    assert family_pin["lng"] == 114.1582

    org_pin = next(item for item in items if item["id"] == str(org_id))
    assert org_pin["organization_type"] == "school"
    assert org_pin["member_labels"] == ["Pat Ho"]

    contact_pin = next(item for item in items if item["id"] == str(standalone_id))
    assert contact_pin["contact_type"] == "professional"
    assert "member_labels" not in contact_pin


def test_unmapped_family_does_not_suppress_member_contact() -> None:
    family_id = uuid4()
    member_id = uuid4()
    incomplete_location = _location(address="No coords yet", lat=None, lng=None)
    member_location = _location(address="Member home")
    member = SimpleNamespace(
        id=member_id,
        first_name="Bo",
        last_name="Lam",
        email=None,
        contact_type=ContactType.CHILD,
        location=member_location,
    )
    family = SimpleNamespace(
        id=family_id,
        family_name="Lam family",
        location=incomplete_location,
        family_members=[SimpleNamespace(contact_id=member_id, contact=member)],
    )

    assert contact_ids_suppressed_by_mapped_families([family]) == set()
    items = build_map_pin_items(
        families=[family],
        organizations=[],
        contacts=[member],
    )
    assert [item["id"] for item in items] == [str(member_id)]


def test_archived_or_blank_address_rows_are_omitted() -> None:
    items = build_map_pin_items(
        families=[
            SimpleNamespace(
                id=uuid4(),
                family_name="Blank address",
                location=_location(address="   "),
                family_members=[],
            )
        ],
        organizations=[],
        contacts=[
            SimpleNamespace(
                id=uuid4(),
                first_name="No",
                last_name="Geo",
                email=None,
                contact_type=ContactType.OTHER,
                location=_location(lat=None),
            )
        ],
    )
    assert items == []


def test_handle_admin_contacts_map_pins_get(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(admin_contacts, "list_contact_map_pins", lambda _: marker)
    monkeypatch.setattr(
        admin_contacts,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_contacts.handle_admin_contacts_request(
        api_gateway_event(method="GET", path="/v1/admin/contacts/map-pins"),
        "GET",
        "/v1/admin/contacts/map-pins",
    )

    assert response is marker


def test_handle_admin_contacts_map_pins_rejects_post(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    monkeypatch.setattr(
        admin_contacts,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_contacts.handle_admin_contacts_request(
        api_gateway_event(method="POST", path="/v1/admin/contacts/map-pins"),
        "POST",
        "/v1/admin/contacts/map-pins",
    )

    assert response["statusCode"] == 405
