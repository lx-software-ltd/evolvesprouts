from __future__ import annotations

from typing import Any

from app.api import admin_geographic_areas


def test_handle_admin_geographic_areas_dispatches_list_route(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(
        admin_geographic_areas, "_list_geographic_areas", lambda _: marker
    )

    response = admin_geographic_areas.handle_admin_geographic_areas_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/geographic-areas",
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/geographic-areas",
    )

    assert response is marker


def test_handle_admin_geographic_areas_rejects_non_get(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    response = admin_geographic_areas.handle_admin_geographic_areas_request(
        api_gateway_event(
            method="POST",
            path="/v1/admin/geographic-areas",
            authorizer_context=admin_identity,
        ),
        "POST",
        "/v1/admin/geographic-areas",
    )

    assert response["statusCode"] == 405
