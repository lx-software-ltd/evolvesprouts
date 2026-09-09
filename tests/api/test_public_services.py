from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.api.public import services as pservices
from app.exceptions import AuthenticationError, AuthorizationError


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


def test_public_services_requires_token(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/public/services")
    with pytest.raises(AuthenticationError):
        pservices.handle_public_services_request(event, "GET", "/v1/public/services")


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_public_services_user_cannot_write(api_gateway_event: Any, method: str) -> None:
    service_id = uuid4()
    path = (
        "/v1/public/services"
        if method == "POST"
        else f"/v1/public/services/{service_id}"
    )
    event = _token_event(api_gateway_event, path, scope="user", method=method)
    with pytest.raises(AuthorizationError, match="Read-only API token"):
        pservices.handle_public_services_request(event, method, path)


def test_public_services_lists(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        pservices, "list_services", lambda _event: {"statusCode": 200, "body": "{}"}
    )
    response = pservices.handle_public_services_request(
        _token_event(api_gateway_event, "/v1/public/services"),
        "GET",
        "/v1/public/services",
    )
    assert response["statusCode"] == 200


def test_public_services_admin_create_uses_token_actor(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    captured: dict[str, str] = {}

    def _create(event: object, *, actor_sub: str) -> dict[str, Any]:
        captured["actor_sub"] = actor_sub
        return {"statusCode": 201, "body": "{}"}

    monkeypatch.setattr(pservices, "create_service", _create)
    response = pservices.handle_public_services_request(
        _token_event(
            api_gateway_event,
            "/v1/public/services",
            scope="admin",
            method="POST",
            api_key_id=api_key_id,
        ),
        "POST",
        "/v1/public/services",
    )
    assert response["statusCode"] == 201
    assert captured["actor_sub"] == f"api-key:{api_key_id}"


def test_public_services_get_put_patch_delete_delegate(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    service_id = uuid4()
    captured: dict[str, str] = {}

    def _get(event: object, *, service_id: object) -> dict[str, Any]:
        captured["get_id"] = str(service_id)
        return {"statusCode": 200, "body": "{}"}

    def _update(
        event: object, *, service_id: object, actor_sub: str, partial: bool
    ) -> dict[str, Any]:
        captured["update_id"] = str(service_id)
        captured["update_actor"] = actor_sub
        captured[f"partial_{'patch' if partial else 'put'}"] = str(partial)
        return {"statusCode": 200, "body": "{}"}

    def _delete(event: object, *, service_id: object, actor_sub: str) -> dict[str, Any]:
        captured["delete_id"] = str(service_id)
        captured["delete_actor"] = actor_sub
        return {"statusCode": 204, "body": "{}"}

    monkeypatch.setattr(pservices, "get_service", _get)
    monkeypatch.setattr(pservices, "update_service", _update)
    monkeypatch.setattr(pservices, "delete_service", _delete)
    path = f"/v1/public/services/{service_id}"

    get_response = pservices.handle_public_services_request(
        _token_event(api_gateway_event, path), "GET", path
    )
    put_response = pservices.handle_public_services_request(
        _token_event(
            api_gateway_event,
            path,
            scope="admin",
            method="PUT",
            api_key_id=api_key_id,
        ),
        "PUT",
        path,
    )
    patch_response = pservices.handle_public_services_request(
        _token_event(
            api_gateway_event,
            path,
            scope="admin",
            method="PATCH",
            api_key_id=api_key_id,
        ),
        "PATCH",
        path,
    )
    delete_response = pservices.handle_public_services_request(
        _token_event(
            api_gateway_event,
            path,
            scope="admin",
            method="DELETE",
            api_key_id=api_key_id,
        ),
        "DELETE",
        path,
    )
    assert get_response["statusCode"] == 200
    assert put_response["statusCode"] == 200
    assert patch_response["statusCode"] == 200
    assert delete_response["statusCode"] == 204
    assert captured["get_id"] == str(service_id)
    assert captured["update_id"] == str(service_id)
    assert captured["delete_id"] == str(service_id)
    assert captured["update_actor"] == f"api-key:{api_key_id}"
    assert captured["delete_actor"] == f"api-key:{api_key_id}"
    assert captured["partial_put"] == "False"
    assert captured["partial_patch"] == "True"


def test_public_services_global_instances_list(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        pservices,
        "list_instances_global",
        lambda _event: {"statusCode": 200, "body": "{}"},
    )
    path = "/v1/public/services/instances"
    response = pservices.handle_public_services_request(
        _token_event(api_gateway_event, path), "GET", path
    )
    assert response["statusCode"] == 200


def test_public_services_rejects_cover_image_and_discount_summary(
    api_gateway_event: Any,
) -> None:
    service_id = uuid4()
    cover = pservices.handle_public_services_request(
        _token_event(
            api_gateway_event,
            f"/v1/public/services/{service_id}/cover-image",
            scope="admin",
            method="POST",
        ),
        "POST",
        f"/v1/public/services/{service_id}/cover-image",
    )
    assert cover["statusCode"] == 404
    summary = pservices.handle_public_services_request(
        _token_event(
            api_gateway_event,
            f"/v1/public/services/{service_id}/discount-code-usage-summary",
        ),
        "GET",
        f"/v1/public/services/{service_id}/discount-code-usage-summary",
    )
    assert summary["statusCode"] == 404
