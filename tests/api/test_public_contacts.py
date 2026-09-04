from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.api.admin_contacts_related import empty_related_flags
from app.api.public import contacts as pcontacts
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


class _FakeSessionCM:
    def __enter__(self) -> object:
        return object()

    def __exit__(self, *_a: object) -> bool:
        return False


def _empty_related_flags(
    _session: object, contact_ids: list[object]
) -> dict[object, object]:
    return {contact_id: empty_related_flags() for contact_id in contact_ids}


def test_public_contacts_requires_token(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/public/contacts")
    with pytest.raises(AuthenticationError):
        pcontacts.handle_public_contacts_request(event, "GET", "/v1/public/contacts")


@pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE"])
def test_public_contacts_user_cannot_write(api_gateway_event: Any, method: str) -> None:
    contact_id = uuid4()
    path = (
        "/v1/public/contacts"
        if method == "POST"
        else f"/v1/public/contacts/{contact_id}"
    )
    event = _token_event(api_gateway_event, path, scope="user", method=method)
    with pytest.raises(AuthorizationError, match="Read-only API token"):
        pcontacts.handle_public_contacts_request(event, method, path)


def test_public_contacts_lists_with_admin_payload(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contact_id = uuid4()
    row = SimpleNamespace(id=contact_id)

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def list_for_admin(self, **kwargs: object) -> list[object]:
            assert kwargs.get("query") == "kitie"
            assert kwargs.get("active") is True
            return [row]

        def count_for_admin(self, **_k: object) -> int:
            return 1

        def count_standalone_notes_for_contacts(
            self, _ids: list[object]
        ) -> dict[object, int]:
            return {contact_id: 2}

    monkeypatch.setattr(pcontacts, "ContactRepository", _FakeRepo)
    monkeypatch.setattr(pcontacts, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pcontacts, "get_engine", lambda: object())
    monkeypatch.setattr(
        pcontacts,
        "contact_ids_with_issued_certificates",
        lambda _s, _ids: {contact_id},
    )
    monkeypatch.setattr(pcontacts, "related_flags_for_contacts", _empty_related_flags)
    monkeypatch.setattr(
        pcontacts,
        "serialize_contact_summary",
        lambda r, **kwargs: {
            "id": str(r.id),
            "first_name": "Kitie",
            "email": "kitie@example.com",
            "phone_e164": "+85294479843",
            "standalone_note_count": kwargs["standalone_note_count"],
            "has_completion_certificate": kwargs["has_completion_certificate"],
        },
    )

    response = pcontacts.handle_public_contacts_request(
        _token_event(
            api_gateway_event,
            "/v1/public/contacts",
            query_params={"query": "kitie", "active": "true"},
        ),
        "GET",
        "/v1/public/contacts",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["total_count"] == 1
    assert body["items"][0]["email"] == "kitie@example.com"
    assert body["items"][0]["phone_e164"] == "+85294479843"
    assert body["items"][0]["standalone_note_count"] == 2
    assert body["items"][0]["has_completion_certificate"] is True


def test_public_contacts_get_returns_contact(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contact_id = uuid4()
    row = SimpleNamespace(id=contact_id)

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id_for_admin(self, requested_id: object) -> object:
            assert requested_id == contact_id
            return row

        def count_standalone_notes_for_contacts(
            self, _ids: list[object]
        ) -> dict[object, int]:
            return {}

    monkeypatch.setattr(pcontacts, "ContactRepository", _FakeRepo)
    monkeypatch.setattr(pcontacts, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pcontacts, "get_engine", lambda: object())
    monkeypatch.setattr(
        pcontacts, "contact_ids_with_issued_certificates", lambda _s, _ids: set()
    )
    monkeypatch.setattr(pcontacts, "related_flags_for_contacts", _empty_related_flags)
    monkeypatch.setattr(
        pcontacts,
        "serialize_contact_summary",
        lambda r, **_k: {"id": str(r.id), "first_name": "Kitie"},
    )

    path = f"/v1/public/contacts/{contact_id}"
    response = pcontacts.handle_public_contacts_request(
        _token_event(api_gateway_event, path),
        "GET",
        path,
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["contact"]["id"] == str(contact_id)
    assert body["contact"]["first_name"] == "Kitie"


def test_public_contacts_get_not_found(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contact_id = uuid4()

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id_for_admin(self, _id: object) -> None:
            return None

    monkeypatch.setattr(pcontacts, "ContactRepository", _FakeRepo)
    monkeypatch.setattr(pcontacts, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pcontacts, "get_engine", lambda: object())

    path = f"/v1/public/contacts/{contact_id}"
    with pytest.raises(NotFoundError):
        pcontacts.handle_public_contacts_request(
            _token_event(api_gateway_event, path),
            "GET",
            path,
        )


def test_public_contacts_admin_create_uses_token_actor(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    captured: dict[str, str] = {}

    def _create(event: object, *, actor_sub: str) -> dict[str, Any]:
        captured["actor_sub"] = actor_sub
        return {"statusCode": 201, "body": "{}"}

    monkeypatch.setattr(pcontacts, "create_contact", _create)
    event = _token_event(
        api_gateway_event,
        "/v1/public/contacts",
        scope="admin",
        method="POST",
        api_key_id=api_key_id,
    )
    response = pcontacts.handle_public_contacts_request(
        event, "POST", "/v1/public/contacts"
    )
    assert response["statusCode"] == 201
    assert captured["actor_sub"] == f"api-key:{api_key_id}"


def test_public_contacts_admin_update_and_delete_use_token_actor(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    contact_id = uuid4()
    captured: dict[str, str] = {}

    def _update(event: object, *, contact_id: object, actor_sub: str) -> dict[str, Any]:
        captured["update_actor"] = actor_sub
        captured["update_id"] = str(contact_id)
        return {"statusCode": 200, "body": "{}"}

    def _delete(event: object, *, contact_id: object, actor_sub: str) -> dict[str, Any]:
        captured["delete_actor"] = actor_sub
        captured["delete_id"] = str(contact_id)
        return {"statusCode": 204, "body": "{}"}

    monkeypatch.setattr(pcontacts, "update_contact", _update)
    monkeypatch.setattr(pcontacts, "delete_contact", _delete)
    path = f"/v1/public/contacts/{contact_id}"

    update_response = pcontacts.handle_public_contacts_request(
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
    delete_response = pcontacts.handle_public_contacts_request(
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
    assert captured["update_id"] == str(contact_id)
    assert captured["delete_id"] == str(contact_id)


def test_public_contacts_rejects_unknown_methods(
    api_gateway_event: Any,
) -> None:
    put_response = pcontacts.handle_public_contacts_request(
        _token_event(
            api_gateway_event,
            "/v1/public/contacts",
            scope="admin",
            method="PUT",
        ),
        "PUT",
        "/v1/public/contacts",
    )
    assert put_response["statusCode"] == 405


def test_public_contact_notes_user_cannot_write(api_gateway_event: Any) -> None:
    contact_id = uuid4()
    path = f"/v1/public/contacts/{contact_id}/notes"
    event = _token_event(api_gateway_event, path, scope="user", method="POST")
    with pytest.raises(AuthorizationError, match="Read-only API token"):
        pcontacts.handle_public_contacts_request(event, "POST", path)


def test_public_contact_notes_admin_create_uses_token_actor(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_key_id = str(uuid4())
    contact_id = uuid4()
    captured: dict[str, str] = {}

    def _create(event: object, *, contact_id: object, actor_sub: str) -> dict[str, Any]:
        captured["actor_sub"] = actor_sub
        captured["contact_id"] = str(contact_id)
        return {"statusCode": 201, "body": "{}"}

    monkeypatch.setattr(pcontacts, "create_contact_note", _create)
    path = f"/v1/public/contacts/{contact_id}/notes"
    response = pcontacts.handle_public_contacts_request(
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
    assert captured["contact_id"] == str(contact_id)
