from __future__ import annotations

import json
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.api import admin_locations
from app.exceptions import ValidationError


def test_handle_admin_locations_dispatches_geocode_post(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(admin_locations, "_geocode_location", lambda _: marker)

    response = admin_locations.handle_admin_locations_request(
        api_gateway_event(
            method="POST",
            path="/v1/admin/locations/geocode",
            authorizer_context=admin_identity,
        ),
        "POST",
        "/v1/admin/locations/geocode",
    )

    assert response is marker


def test_handle_admin_locations_dispatches_collection_get(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(admin_locations, "_list_locations", lambda _: marker)

    response = admin_locations.handle_admin_locations_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/locations",
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/locations",
    )

    assert response is marker


def test_handle_admin_locations_dispatches_resource_patch(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    captured: dict[str, Any] = {}

    def _fake_update(
        _event: Any, _location_id: Any, *, partial: bool
    ) -> dict[str, Any]:
        captured["partial"] = partial
        return marker

    monkeypatch.setattr(admin_locations, "_update_location", _fake_update)
    location_id = str(uuid4())

    response = admin_locations.handle_admin_locations_request(
        api_gateway_event(
            method="PATCH",
            path=f"/v1/admin/locations/{location_id}",
            authorizer_context=admin_identity,
        ),
        "PATCH",
        f"/v1/admin/locations/{location_id}",
    )

    assert response is marker
    assert captured["partial"] is True


def test_handle_admin_locations_rejects_collection_patch(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    response = admin_locations.handle_admin_locations_request(
        api_gateway_event(
            method="PATCH",
            path="/v1/admin/locations",
            authorizer_context=admin_identity,
        ),
        "PATCH",
        "/v1/admin/locations",
    )
    assert response["statusCode"] == 405


def test_serialize_location_emits_float_coordinates_for_json() -> None:
    """Decimals must become JSON numbers so clients are not forced to parse strings."""
    loc_id = uuid4()
    area_id = uuid4()
    location = SimpleNamespace(
        id=loc_id,
        name="Studio",
        area_id=area_id,
        address="1 Main St",
        lat=Decimal("22.319300"),
        lng=Decimal("114.169400"),
        created_at=None,
        updated_at=None,
    )
    payload = admin_locations._serialize_location(location)  # type: ignore[arg-type]
    assert payload["locked_from_partner_org"] is False
    assert payload["partner_organization_labels"] == []
    assert payload["partner_organization_ids"] == []
    assert payload["lat"] == 22.3193
    assert payload["lng"] == 114.1694
    assert isinstance(payload["lat"], float)
    assert isinstance(payload["lng"], float)
    encoded = json.dumps({"lat": payload["lat"], "lng": payload["lng"]})
    roundtrip = json.loads(encoded)
    assert roundtrip["lat"] == pytest.approx(22.3193)
    assert roundtrip["lng"] == pytest.approx(114.1694)


def test_parse_query_bool_defaults_and_accepts_aliases() -> None:
    assert admin_locations._parse_query_bool(None, field="f", default=False) is False
    assert admin_locations._parse_query_bool("", field="f", default=True) is True
    assert admin_locations._parse_query_bool("true", field="f", default=False) is True
    assert admin_locations._parse_query_bool("1", field="f", default=False) is True
    assert admin_locations._parse_query_bool("FALSE", field="f", default=True) is False


def test_parse_query_bool_rejects_invalid() -> None:
    with pytest.raises(ValidationError) as exc:
        admin_locations._parse_query_bool(
            "maybe", field="exclude_addresses", default=False
        )
    assert exc.value.field == "exclude_addresses"


def test_serialize_location_partner_metadata() -> None:
    loc_id = uuid4()
    area_id = uuid4()
    location = SimpleNamespace(
        id=loc_id,
        name="Venue",
        area_id=area_id,
        address="1 St",
        lat=None,
        lng=None,
        created_at=None,
        updated_at=None,
    )
    org_a = uuid4()
    org_b = uuid4()
    payload = admin_locations._serialize_location(
        location,
        partner_organization_id_label_pairs=[
            (org_a, "Alpha Partners"),
            (org_b, "Beta Co"),
        ],
    )
    assert payload["locked_from_partner_org"] is True
    assert payload["partner_organization_labels"] == ["Alpha Partners", "Beta Co"]
    assert payload["partner_organization_ids"] == [str(org_a), str(org_b)]
