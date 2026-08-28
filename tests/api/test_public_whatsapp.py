from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.api.public import whatsapp_conversations as pwa
from app.db.models.enums import WhatsAppMessageDirection
from app.exceptions import AuthenticationError, AuthorizationError


def _token_event(
    api_gateway_event: Any,
    path: str,
    *,
    scope: str = "user",
    method: str = "GET",
    **kwargs: object,
) -> dict[str, Any]:
    return api_gateway_event(
        method=method,
        path=path,
        authorizer_context={
            "apiKeyId": str(uuid4()),
            "scope": scope,
            "userSub": "api-key:test",
        },
        **kwargs,
    )


class _FakeSessionCM:
    def __enter__(self) -> object:
        return object()

    def __exit__(self, *_a: object) -> bool:
        return False


def test_public_whatsapp_requires_token(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/public/whatsapp/conversations")
    with pytest.raises(AuthenticationError):
        pwa.handle_public_whatsapp_request(
            event, "GET", "/v1/public/whatsapp/conversations"
        )


def test_public_whatsapp_user_cannot_write(api_gateway_event: Any) -> None:
    event = _token_event(
        api_gateway_event,
        "/v1/public/whatsapp/conversations",
        scope="user",
        method="POST",
    )
    with pytest.raises(AuthorizationError):
        pwa.handle_public_whatsapp_request(
            event, "POST", "/v1/public/whatsapp/conversations"
        )


def test_public_conversation_name_never_uses_phone_or_fallback() -> None:
    conversation = SimpleNamespace(
        wa_id="85294479843",
        profile_name="WhatsApp 9843",
        contact=SimpleNamespace(first_name="WhatsApp 9843", last_name=None),
    )
    assert pwa.public_conversation_name(conversation) == "WhatsApp contact"

    named = SimpleNamespace(
        wa_id="85294479843",
        profile_name="Kitie Wong",
        contact=None,
    )
    assert pwa.public_conversation_name(named) == "Kitie Wong"


def test_public_whatsapp_lists_without_phone_fields(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    row = SimpleNamespace(
        id=conversation_id,
        wa_id="85294479843",
        profile_name="Kitie",
        contact=None,
        first_inbound_at=datetime(2026, 8, 1, tzinfo=UTC),
        last_message_at=datetime(2026, 8, 2, tzinfo=UTC),
        created_at=datetime(2026, 8, 1, tzinfo=UTC),
    )

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def list_conversations(self, **kwargs: object) -> list[object]:
            assert kwargs.get("search_wa_id") is False
            return [row]

    monkeypatch.setattr(pwa, "WhatsAppRepository", _FakeRepo)
    monkeypatch.setattr(pwa, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pwa, "get_engine", lambda: object())

    response = pwa.handle_public_whatsapp_request(
        _token_event(api_gateway_event, "/v1/public/whatsapp/conversations"),
        "GET",
        "/v1/public/whatsapp/conversations",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    item = body["items"][0]
    assert item["name"] == "Kitie"
    assert item["id"] == str(conversation_id)
    assert "wa_id" not in item
    assert "85294479843" not in json.dumps(body)


def test_public_whatsapp_messages_omit_wa_ids(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    conversation = SimpleNamespace(
        id=conversation_id,
        wa_id="85294479843",
        profile_name="Kitie",
        contact=None,
        first_inbound_at=datetime(2026, 8, 1, tzinfo=UTC),
        last_message_at=datetime(2026, 8, 2, tzinfo=UTC),
        created_at=datetime(2026, 8, 1, tzinfo=UTC),
    )
    message = SimpleNamespace(
        id=uuid4(),
        wa_message_id="wamid.secret",
        direction=WhatsAppMessageDirection.INBOUND,
        body="How much?",
        sent_at=datetime(2026, 8, 2, tzinfo=UTC),
    )

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_conversation_by_id(self, _id: object) -> object:
            return conversation

        def list_messages(self, **_k: object) -> list[object]:
            return [message]

    monkeypatch.setattr(pwa, "WhatsAppRepository", _FakeRepo)
    monkeypatch.setattr(pwa, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pwa, "get_engine", lambda: object())

    path = f"/v1/public/whatsapp/conversations/{conversation_id}/messages"
    response = pwa.handle_public_whatsapp_request(
        _token_event(api_gateway_event, path, scope="admin"),
        "GET",
        path,
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"][0]["body"] == "How much?"
    assert "wa_message_id" not in body["items"][0]
    assert "wa_id" not in body["conversation"]
    assert "wamid.secret" not in json.dumps(body)
    assert "85294479843" not in json.dumps(body)
