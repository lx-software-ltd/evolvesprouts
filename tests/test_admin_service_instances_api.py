from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from app.api import admin_service_instances
from app.api import admin_service_instances_list
from app.api.admin_request import RequestIdentity


def _admin_request_identity() -> RequestIdentity:
    return RequestIdentity(
        user_sub="test-admin-sub-12345",
        groups={"admin"},
        organization_ids={"org-1"},
    )


def test_handle_admin_service_instances_rejects_patch(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    monkeypatch.setattr(
        admin_service_instances,
        "extract_identity",
        lambda _event: _admin_request_identity(),
    )

    service_id = uuid4()
    instance_id = uuid4()
    path = f"/v1/admin/services/{service_id}/instances/{instance_id}"
    response = admin_service_instances.handle_admin_service_instances_request(
        api_gateway_event(method="PATCH", path=path),
        "PATCH",
        path,
        service_id,
    )

    assert response["statusCode"] == 405


def test_list_instances_returns_repository_total_count(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    service_id = uuid4()
    row = SimpleNamespace(id=uuid4())
    captured: dict[str, Any] = {}

    class _FakeSession:
        pass

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            self._session = _FakeSession()

        def __enter__(self) -> _FakeSession:
            return self._session

        def __exit__(self, *_args: Any) -> bool:
            return False

    class _FakeServiceRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id(self, _service_id: Any) -> object:
            return object()

    class _FakeInstanceRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def list_instances(self, **kwargs: Any) -> list[Any]:
            captured["list_kwargs"] = kwargs
            return [row, row]

        def count_instances(self, **kwargs: Any) -> int:
            captured["count_kwargs"] = kwargs
            return 42

    monkeypatch.setattr(
        admin_service_instances,
        "parse_instance_filters",
        lambda _event: {
            "limit": 1,
            "status": None,
            "cursor_created_at": None,
            "cursor_id": None,
        },
    )
    monkeypatch.setattr(admin_service_instances, "Session", _SessionCtx)
    monkeypatch.setattr(admin_service_instances, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_service_instances,
        "ServiceRepository",
        _FakeServiceRepository,
    )
    monkeypatch.setattr(
        admin_service_instances,
        "ServiceInstanceRepository",
        _FakeInstanceRepository,
    )
    monkeypatch.setattr(
        admin_service_instances,
        "serialize_instance",
        lambda _item, **_kwargs: {"id": "instance-1"},
    )
    monkeypatch.setattr(
        admin_service_instances,
        "encode_instance_cursor",
        lambda _item: "next-cursor",
    )

    response = admin_service_instances._list_instances(
        api_gateway_event(
            method="GET", path=f"/v1/admin/services/{service_id}/instances"
        ),
        service_id=service_id,
    )

    body = json.loads(response["body"])
    assert body["total_count"] == 42
    assert captured["list_kwargs"]["limit"] == 2
    assert "include_bookings" not in captured["list_kwargs"]
    assert captured["count_kwargs"]["service_id"] == service_id


def test_handle_admin_all_service_instances_lists_global(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    row = SimpleNamespace(id=uuid4())
    captured: dict[str, Any] = {}

    class _FakeSession:
        pass

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            self._session = _FakeSession()

        def __enter__(self) -> _FakeSession:
            return self._session

        def __exit__(self, *_args: Any) -> bool:
            return False

    class _FakeInstanceRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def list_instances_global(self, **kwargs: Any) -> list[Any]:
            captured["list_kwargs"] = kwargs
            return [row, row]

        def count_instances_global(self, **kwargs: Any) -> int:
            captured["count_kwargs"] = kwargs
            return 7

    monkeypatch.setattr(
        admin_service_instances_list,
        "parse_global_instance_list_filters",
        lambda _event: {
            "limit": 1,
            "status": None,
            "cursor_created_at": None,
            "cursor_id": None,
            "service_id": None,
            "service_type": None,
            "contact_id": None,
            "family_id": None,
            "organization_id": None,
        },
    )
    monkeypatch.setattr(admin_service_instances_list, "Session", _SessionCtx)
    monkeypatch.setattr(admin_service_instances_list, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_service_instances_list,
        "ServiceInstanceRepository",
        _FakeInstanceRepository,
    )
    monkeypatch.setattr(
        admin_service_instances_list,
        "serialize_instance",
        lambda _item, **_kwargs: {"id": "instance-1"},
    )
    monkeypatch.setattr(
        admin_service_instances_list,
        "encode_instance_cursor",
        lambda _item: "next-cursor",
    )
    monkeypatch.setattr(
        admin_service_instances_list,
        "require_admin_identity",
        lambda _event: _admin_request_identity(),
    )

    path = "/v1/admin/services/instances"
    response = admin_service_instances_list.handle_admin_all_service_instances_request(
        api_gateway_event(method="GET", path=path),
        "GET",
        path,
    )

    body = json.loads(response["body"])
    assert response["statusCode"] == 200
    assert body["total_count"] == 7
    assert captured["list_kwargs"]["limit"] == 2
    assert "include_bookings" not in captured["list_kwargs"]
    assert captured["count_kwargs"]["service_id"] is None
