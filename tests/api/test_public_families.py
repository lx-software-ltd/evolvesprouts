from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.api.public import families as pfamilies
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


def test_public_families_requires_token(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/public/families")
    with pytest.raises(AuthenticationError):
        pfamilies.handle_public_families_request(event, "GET", "/v1/public/families")


@pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE"])
def test_public_families_user_cannot_write(
    api_gateway_event: Any, method: str
) -> None:
    family_id = uuid4()
    path = (
        "/v1/public/families"
        if method == "POST"
        else f"/v1/public/families/{family_id}"
    )
    event = _token_event(api_gateway_event, path, scope="user", method=method)
    with pytest.raises(AuthorizationError, match="Read-only API token"):
        pfamilies.handle_public_families_request(event, method, path)


def test_public_families_admin_create_uses_token_actor(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    captured: dict[str, str] = {}

    def _create(event: object, *, actor_sub: str) -> dict[str, Any]:
        captured["actor_sub"] = actor_sub
        return {"statusCode": 201, "body": "{}"}

    monkeypatch.setattr(pfamilies, "create_family", _create)
    response = pfamilies.handle_public_families_request(
        _token_event(
            api_gateway_event,
            "/v1/public/families",
            scope="admin",
            method="POST",
            api_key_id=api_key_id,
        ),
        "POST",
        "/v1/public/families",
    )
    assert response["statusCode"] == 201
    assert captured["actor_sub"] == f"api-key:{api_key_id}"


def test_public_families_get_missing_raises(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    family_id = uuid4()

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id_for_admin(self, _id: object) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(pfamilies, "FamilyRepository", _FakeRepo)
    monkeypatch.setattr(pfamilies, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pfamilies, "get_engine", lambda: object())
    path = f"/v1/public/families/{family_id}"
    with pytest.raises(NotFoundError):
        pfamilies.handle_public_families_request(
            _token_event(api_gateway_event, path), "GET", path
        )


def test_public_family_member_add_uses_token_actor(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    family_id = uuid4()
    captured: dict[str, str] = {}

    def _add(event: object, *, family_id: object, actor_sub: str) -> dict[str, Any]:
        captured["actor_sub"] = actor_sub
        captured["family_id"] = str(family_id)
        return {"statusCode": 201, "body": "{}"}

    monkeypatch.setattr(pfamilies, "add_family_member", _add)
    path = f"/v1/public/families/{family_id}/members"
    response = pfamilies.handle_public_families_request(
        _token_event(
            api_gateway_event,
            path,
            scope="admin",
            method="POST",
            api_key_id=api_key_id,
        ),
        "POST",
        path,
    )
    assert response["statusCode"] == 201
    assert captured["actor_sub"] == f"api-key:{api_key_id}"
    assert captured["family_id"] == str(family_id)
