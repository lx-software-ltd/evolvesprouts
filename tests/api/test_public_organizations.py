from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.api.public import organizations as porgs
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


def test_public_organizations_requires_token(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/public/organizations")
    with pytest.raises(AuthenticationError):
        porgs.handle_public_organizations_request(
            event, "GET", "/v1/public/organizations"
        )


@pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE"])
def test_public_organizations_user_cannot_write(
    api_gateway_event: Any, method: str
) -> None:
    org_id = uuid4()
    path = (
        "/v1/public/organizations"
        if method == "POST"
        else f"/v1/public/organizations/{org_id}"
    )
    event = _token_event(api_gateway_event, path, scope="user", method=method)
    with pytest.raises(AuthorizationError, match="Read-only API token"):
        porgs.handle_public_organizations_request(event, method, path)


def test_public_organizations_admin_create_uses_token_actor(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    captured: dict[str, str] = {}

    def _create(event: object, *, actor_sub: str) -> dict[str, Any]:
        captured["actor_sub"] = actor_sub
        return {"statusCode": 201, "body": "{}"}

    monkeypatch.setattr(porgs, "create_organization", _create)
    response = porgs.handle_public_organizations_request(
        _token_event(
            api_gateway_event,
            "/v1/public/organizations",
            scope="admin",
            method="POST",
            api_key_id=api_key_id,
        ),
        "POST",
        "/v1/public/organizations",
    )
    assert response["statusCode"] == 201
    assert captured["actor_sub"] == f"api-key:{api_key_id}"


def test_public_organizations_get_missing_raises(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    org_id = uuid4()

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_organization_by_id(self, _id: object) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(porgs, "OrganizationRepository", _FakeRepo)
    monkeypatch.setattr(porgs, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(porgs, "get_engine", lambda: object())
    path = f"/v1/public/organizations/{org_id}"
    with pytest.raises(NotFoundError):
        porgs.handle_public_organizations_request(
            _token_event(api_gateway_event, path), "GET", path
        )
