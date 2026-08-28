from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.api import admin_api_keys as aak
from app.exceptions import ValidationError
from app.services.api_keys import generate_api_key


def _identity_event(
    api_gateway_event: Any, path: str, method: str = "GET", **kwargs: object
) -> dict[str, Any]:
    return api_gateway_event(
        method=method,
        path=path,
        authorizer_context={"userSub": "admin-user"},
        **kwargs,
    )


class _FakeSessionCM:
    def __enter__(self) -> object:
        return object()

    def __exit__(self, *_a: object) -> bool:
        return False


def test_admin_api_keys_requires_auth(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/admin/api-keys")
    with pytest.raises(ValidationError):
        aak.handle_admin_api_keys_request(event, "GET", "/v1/admin/api-keys")


def test_admin_api_keys_lists_metadata_without_hash(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key_id = uuid4()
    row = SimpleNamespace(
        id=key_id,
        name="Integration",
        key_prefix="esk_abc123xyz",
        scope="user",
        created_by="admin-user",
        created_at=datetime(2026, 8, 1, tzinfo=UTC),
        expires_at=None,
        revoked_at=None,
        last_used_at=None,
    )

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def list_newest(self, **_k: object) -> list[object]:
            return [row]

    monkeypatch.setattr(aak, "ApiKeyRepository", _FakeRepo)
    monkeypatch.setattr(aak, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(aak, "get_engine", lambda: object())

    response = aak.handle_admin_api_keys_request(
        _identity_event(api_gateway_event, "/v1/admin/api-keys"),
        "GET",
        "/v1/admin/api-keys",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"][0]["name"] == "Integration"
    assert body["items"][0]["status"] == "active"
    assert "key_hash" not in body["items"][0]
    assert "api_token" not in body["items"][0]


def test_admin_api_keys_create_returns_plaintext_once(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    generated = generate_api_key()
    created = SimpleNamespace(
        id=uuid4(),
        name="Partner",
        key_prefix=generated.prefix,
        scope="admin",
        created_by="admin-user",
        created_at=datetime.now(UTC),
        expires_at=None,
        revoked_at=None,
        last_used_at=None,
    )

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create(self, entity: object) -> object:
            return entity

    class _Session:
        def __enter__(self) -> "_Session":
            return self

        def __exit__(self, *_a: object) -> bool:
            return False

        def commit(self) -> None:
            return None

        def refresh(self, entity: Any) -> None:
            entity.id = created.id
            entity.created_at = created.created_at

    monkeypatch.setattr(aak, "ApiKeyRepository", _FakeRepo)
    monkeypatch.setattr(aak, "Session", lambda _e: _Session())
    monkeypatch.setattr(aak, "get_engine", lambda: object())
    monkeypatch.setattr(aak, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(aak, "generate_api_key", lambda: generated)

    event = _identity_event(
        api_gateway_event,
        "/v1/admin/api-keys",
        method="POST",
        body=json.dumps({"name": "Partner", "scope": "admin"}),
    )
    response = aak.handle_admin_api_keys_request(
        event, "POST", "/v1/admin/api-keys"
    )
    assert response["statusCode"] == 201
    body = json.loads(response["body"])
    assert body["api_token"] == generated.plaintext
    assert body["scope"] == "admin"


def test_admin_api_keys_rejects_past_expiry(api_gateway_event: Any) -> None:
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    event = _identity_event(
        api_gateway_event,
        "/v1/admin/api-keys",
        method="POST",
        body=json.dumps({"name": "Old", "scope": "user", "expires_at": past}),
    )
    with pytest.raises(ValidationError):
        aak.handle_admin_api_keys_request(event, "POST", "/v1/admin/api-keys")
