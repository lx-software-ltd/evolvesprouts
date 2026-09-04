from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.api.public import geographic_areas as pgeo
from app.api.public import locations as plocations
from app.exceptions import AuthenticationError, AuthorizationError, NotFoundError


def _token_event(
    api_gateway_event: Any,
    path: str,
    *,
    scope: str = "user",
    method: str = "GET",
    api_key_id: str | None = None,
    **kwargs: object,
) -> dict[str, Any]:
    key_id = api_key_id or str(uuid4())
    return api_gateway_event(
        method=method,
        path=path,
        authorizer_context={
            "apiKeyId": key_id,
            "scope": scope,
            "userSub": f"api-key:{key_id}",
        },
        **kwargs,
    )


def test_public_locations_requires_token(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/public/locations")
    with pytest.raises(AuthenticationError):
        plocations.handle_public_locations_request(event, "GET", "/v1/public/locations")


def test_public_locations_user_cannot_write(api_gateway_event: Any) -> None:
    event = _token_event(
        api_gateway_event, "/v1/public/locations", scope="user", method="POST"
    )
    with pytest.raises(AuthorizationError, match="Read-only API token"):
        plocations.handle_public_locations_request(
            event, "POST", "/v1/public/locations"
        )


def test_public_locations_admin_create_delegates(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _create(event: object) -> dict[str, Any]:
        return {"statusCode": 201, "body": "{}"}

    monkeypatch.setattr(plocations, "create_location", _create)
    response = plocations.handle_public_locations_request(
        _token_event(
            api_gateway_event,
            "/v1/public/locations",
            scope="admin",
            method="POST",
        ),
        "POST",
        "/v1/public/locations",
    )
    assert response["statusCode"] == 201


def test_public_locations_get_missing_raises(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    location_id = uuid4()

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id(self, _id: object) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(plocations, "LocationRepository", _FakeRepo)
    monkeypatch.setattr(plocations, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(plocations, "get_engine", lambda: object())
    path = f"/v1/public/locations/{location_id}"
    with pytest.raises(NotFoundError):
        plocations.handle_public_locations_request(
            _token_event(api_gateway_event, path), "GET", path
        )


def test_public_geographic_areas_requires_token(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/public/geographic-areas")
    with pytest.raises(AuthenticationError):
        pgeo.handle_public_geographic_areas_request(
            event, "GET", "/v1/public/geographic-areas"
        )


def test_public_geographic_areas_rejects_write(api_gateway_event: Any) -> None:
    event = _token_event(
        api_gateway_event,
        "/v1/public/geographic-areas",
        scope="admin",
        method="POST",
    )
    response = pgeo.handle_public_geographic_areas_request(
        event, "POST", "/v1/public/geographic-areas"
    )
    assert response["statusCode"] == 405
