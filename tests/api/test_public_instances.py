from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.api.public import instances as pinstances
from app.exceptions import (
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ValidationError,
)


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


class _FakeSessionCM:
    def __init__(self, session: object | None = None) -> None:
        self._session = session or object()

    def __enter__(self) -> object:
        return self._session

    def __exit__(self, *_a: object) -> bool:
        return False


def test_public_instances_requires_token(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/public/instances")
    with pytest.raises(AuthenticationError):
        pinstances.handle_public_instances_request(event, "GET", "/v1/public/instances")


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE"])
def test_public_instances_user_cannot_write(
    api_gateway_event: Any, method: str
) -> None:
    instance_id = uuid4()
    path = (
        "/v1/public/instances"
        if method == "POST"
        else f"/v1/public/instances/{instance_id}"
    )
    event = _token_event(api_gateway_event, path, scope="user", method=method)
    with pytest.raises(AuthorizationError, match="Read-only API token"):
        pinstances.handle_public_instances_request(event, method, path)


def test_public_instances_lists_global(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _list(event: object) -> dict[str, Any]:
        return {
            "statusCode": 200,
            "body": json.dumps({"items": [{"id": "inst-1"}], "total_count": 1}),
        }

    monkeypatch.setattr(pinstances, "list_instances_global", _list)
    response = pinstances.handle_public_instances_request(
        _token_event(api_gateway_event, "/v1/public/instances"),
        "GET",
        "/v1/public/instances",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["total_count"] == 1
    assert body["items"][0]["id"] == "inst-1"


def test_public_instances_get_returns_instance(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    instance_id = uuid4()

    def _get(
        event: object,
        *,
        instance_id: object,
        service_id: object = None,
    ) -> dict[str, Any]:
        assert service_id is None
        return {
            "statusCode": 200,
            "body": json.dumps({"instance": {"id": str(instance_id)}}),
        }

    monkeypatch.setattr(pinstances, "_get_instance", _get)
    path = f"/v1/public/instances/{instance_id}"
    response = pinstances.handle_public_instances_request(
        _token_event(api_gateway_event, path),
        "GET",
        path,
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["instance"]["id"] == str(instance_id)


def test_public_instances_admin_create_uses_token_actor(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    service_id = uuid4()
    captured: dict[str, str] = {}

    def _create(event: object, *, service_id: object, actor_sub: str) -> dict[str, Any]:
        captured["actor_sub"] = actor_sub
        captured["service_id"] = str(service_id)
        return {"statusCode": 201, "body": "{}"}

    monkeypatch.setattr(pinstances, "_create_instance", _create)
    response = pinstances.handle_public_instances_request(
        _token_event(
            api_gateway_event,
            "/v1/public/instances",
            scope="admin",
            method="POST",
            api_key_id=api_key_id,
            body=json.dumps({"service_id": str(service_id), "slug": "spring-workshop"}),
        ),
        "POST",
        "/v1/public/instances",
    )
    assert response["statusCode"] == 201
    assert captured["actor_sub"] == f"api-key:{api_key_id}"
    assert captured["service_id"] == str(service_id)


def test_public_instances_admin_create_requires_service_id(
    api_gateway_event: Any,
) -> None:
    event = _token_event(
        api_gateway_event,
        "/v1/public/instances",
        scope="admin",
        method="POST",
        body=json.dumps({"slug": "spring-workshop"}),
    )
    with pytest.raises(ValidationError, match="service_id is required"):
        pinstances.handle_public_instances_request(
            event, "POST", "/v1/public/instances"
        )


def test_public_instances_admin_update_and_delete_use_token_actor(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    instance_id = uuid4()
    service_id = uuid4()
    captured: dict[str, str] = {}

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id(self, requested_id: object) -> object:
            assert requested_id == instance_id
            return SimpleNamespace(id=instance_id, service_id=service_id)

    def _update(
        event: object,
        *,
        service_id: object,
        instance_id: object,
        actor_sub: str,
    ) -> dict[str, Any]:
        captured["update_actor"] = actor_sub
        captured["update_id"] = str(instance_id)
        captured["update_service"] = str(service_id)
        return {"statusCode": 200, "body": "{}"}

    def _delete(
        event: object,
        *,
        service_id: object,
        instance_id: object,
        actor_sub: str,
    ) -> dict[str, Any]:
        captured["delete_actor"] = actor_sub
        captured["delete_id"] = str(instance_id)
        captured["delete_service"] = str(service_id)
        return {"statusCode": 204, "body": "{}"}

    monkeypatch.setattr(pinstances, "ServiceInstanceRepository", _FakeRepo)
    monkeypatch.setattr(pinstances, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pinstances, "get_engine", lambda: object())
    monkeypatch.setattr(pinstances, "_update_instance", _update)
    monkeypatch.setattr(pinstances, "_delete_instance", _delete)
    path = f"/v1/public/instances/{instance_id}"

    update_response = pinstances.handle_public_instances_request(
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
    delete_response = pinstances.handle_public_instances_request(
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
    assert update_response["statusCode"] == 200
    assert delete_response["statusCode"] == 204
    assert captured["update_actor"] == f"api-key:{api_key_id}"
    assert captured["delete_actor"] == f"api-key:{api_key_id}"
    assert captured["update_id"] == str(instance_id)
    assert captured["delete_id"] == str(instance_id)
    assert captured["update_service"] == str(service_id)
    assert captured["delete_service"] == str(service_id)


def test_public_instances_update_missing_raises(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    instance_id = uuid4()

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id(self, _id: object) -> None:
            return None

    monkeypatch.setattr(pinstances, "ServiceInstanceRepository", _FakeRepo)
    monkeypatch.setattr(pinstances, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pinstances, "get_engine", lambda: object())
    path = f"/v1/public/instances/{instance_id}"
    with pytest.raises(NotFoundError):
        pinstances.handle_public_instances_request(
            _token_event(api_gateway_event, path, scope="admin", method="PUT"),
            "PUT",
            path,
        )


def test_public_instances_rejects_unknown_methods(api_gateway_event: Any) -> None:
    patch_list = pinstances.handle_public_instances_request(
        _token_event(
            api_gateway_event,
            "/v1/public/instances",
            scope="admin",
            method="PATCH",
        ),
        "PATCH",
        "/v1/public/instances",
    )
    assert patch_list["statusCode"] == 405

    instance_id = uuid4()
    path = f"/v1/public/instances/{instance_id}"
    patch_one = pinstances.handle_public_instances_request(
        _token_event(api_gateway_event, path, scope="admin", method="PATCH"),
        "PATCH",
        path,
    )
    assert patch_one["statusCode"] == 405


def test_public_instances_does_not_expose_enrollments(
    api_gateway_event: Any,
) -> None:
    instance_id = uuid4()
    path = f"/v1/public/instances/{instance_id}/enrollments"
    response = pinstances.handle_public_instances_request(
        _token_event(api_gateway_event, path, scope="admin"),
        "GET",
        path,
    )
    assert response["statusCode"] == 404
