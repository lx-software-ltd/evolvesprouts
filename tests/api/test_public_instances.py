from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.api.public import instances as pinstances
from app.api.public import services as pservices
from app.exceptions import AuthorizationError


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


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE"])
def test_public_nested_instances_user_cannot_write(
    api_gateway_event: Any, method: str
) -> None:
    service_id = uuid4()
    instance_id = uuid4()
    path = (
        f"/v1/public/services/{service_id}/instances"
        if method == "POST"
        else f"/v1/public/services/{service_id}/instances/{instance_id}"
    )
    event = _token_event(api_gateway_event, path, scope="user", method=method)
    with pytest.raises(AuthorizationError, match="Read-only API token"):
        pservices.handle_public_services_request(event, method, path)


def test_public_nested_instances_list_and_create(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    service_id = uuid4()
    captured: dict[str, str] = {}

    def _list(event: object, *, service_id: object) -> dict[str, Any]:
        captured["list_service"] = str(service_id)
        return {"statusCode": 200, "body": "{}"}

    def _create(event: object, *, service_id: object, actor_sub: str) -> dict[str, Any]:
        captured["create_service"] = str(service_id)
        captured["create_actor"] = actor_sub
        return {"statusCode": 201, "body": "{}"}

    monkeypatch.setattr(pinstances, "_list_instances", _list)
    monkeypatch.setattr(pinstances, "_create_instance", _create)
    path = f"/v1/public/services/{service_id}/instances"

    list_response = pservices.handle_public_services_request(
        _token_event(api_gateway_event, path), "GET", path
    )
    create_response = pservices.handle_public_services_request(
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
    assert list_response["statusCode"] == 200
    assert create_response["statusCode"] == 201
    assert captured["list_service"] == str(service_id)
    assert captured["create_service"] == str(service_id)
    assert captured["create_actor"] == f"api-key:{api_key_id}"


def test_public_nested_instances_get_put_delete(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    service_id = uuid4()
    instance_id = uuid4()
    captured: dict[str, str] = {}

    def _get(
        event: object, *, instance_id: object, service_id: object = None
    ) -> dict[str, Any]:
        captured["get_instance"] = str(instance_id)
        captured["get_service"] = str(service_id)
        return {"statusCode": 200, "body": "{}"}

    def _update(
        event: object,
        *,
        service_id: object,
        instance_id: object,
        actor_sub: str,
    ) -> dict[str, Any]:
        captured["update_instance"] = str(instance_id)
        captured["update_service"] = str(service_id)
        captured["update_actor"] = actor_sub
        return {"statusCode": 200, "body": "{}"}

    def _delete(
        event: object,
        *,
        service_id: object,
        instance_id: object,
        actor_sub: str,
    ) -> dict[str, Any]:
        captured["delete_instance"] = str(instance_id)
        captured["delete_service"] = str(service_id)
        captured["delete_actor"] = actor_sub
        return {"statusCode": 204, "body": "{}"}

    monkeypatch.setattr(pinstances, "_get_instance", _get)
    monkeypatch.setattr(pinstances, "_update_instance", _update)
    monkeypatch.setattr(pinstances, "_delete_instance", _delete)
    path = f"/v1/public/services/{service_id}/instances/{instance_id}"

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
    assert delete_response["statusCode"] == 204
    assert captured["get_instance"] == str(instance_id)
    assert captured["get_service"] == str(service_id)
    assert captured["update_service"] == str(service_id)
    assert captured["delete_service"] == str(service_id)
    assert captured["update_actor"] == f"api-key:{api_key_id}"
    assert captured["delete_actor"] == f"api-key:{api_key_id}"


def test_public_nested_instances_does_not_expose_enrollments(
    api_gateway_event: Any,
) -> None:
    service_id = uuid4()
    instance_id = uuid4()
    path = f"/v1/public/services/{service_id}/instances/{instance_id}/enrollments"
    response = pservices.handle_public_services_request(
        _token_event(api_gateway_event, path, scope="admin"),
        "GET",
        path,
    )
    assert response["statusCode"] == 404
