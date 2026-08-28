from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.api.public import meta_conversations as pmeta
from app.db.models.enums import MetaChannel, MetaMessageDirection
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


def test_public_meta_requires_token(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/public/meta/conversations")
    with pytest.raises(AuthenticationError):
        pmeta.handle_public_meta_request(
            event, "GET", "/v1/public/meta/conversations"
        )


def test_public_meta_user_cannot_write(api_gateway_event: Any) -> None:
    event = _token_event(
        api_gateway_event,
        "/v1/public/meta/conversations",
        scope="user",
        method="POST",
    )
    with pytest.raises(AuthorizationError):
        pmeta.handle_public_meta_request(
            event, "POST", "/v1/public/meta/conversations"
        )


def test_public_conversation_name_never_uses_scoped_id() -> None:
    conversation = SimpleNamespace(
        channel=MetaChannel.INSTAGRAM,
        platform_user_id="igsid-123456",
        profile_name="igsid-123456",
        contact=SimpleNamespace(first_name="Instagram 3456", last_name=None),
    )
    assert pmeta.public_conversation_name(conversation) == "Instagram contact"

    named = SimpleNamespace(
        channel=MetaChannel.FACEBOOK,
        platform_user_id="psid-123456",
        profile_name="Kitie Wong",
        contact=None,
    )
    assert pmeta.public_conversation_name(named) == "Kitie Wong"


def test_public_meta_lists_without_scoped_ids(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    row = SimpleNamespace(
        id=conversation_id,
        channel=MetaChannel.INSTAGRAM,
        platform_user_id="igsid-secret",
        page_id="page-secret",
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
            assert kwargs.get("search_platform_user_id") is False
            assert kwargs.get("channel") is MetaChannel.INSTAGRAM
            return [row]

    monkeypatch.setattr(pmeta, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(pmeta, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pmeta, "get_engine", lambda: object())

    response = pmeta.handle_public_meta_request(
        _token_event(
            api_gateway_event,
            "/v1/public/meta/conversations",
            query_params={"channel": "instagram"},
        ),
        "GET",
        "/v1/public/meta/conversations",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    item = body["items"][0]
    assert item["name"] == "Kitie"
    assert item["channel"] == "instagram"
    assert item["id"] == str(conversation_id)
    assert "platform_user_id" not in item
    assert "page_id" not in item
    assert "igsid-secret" not in json.dumps(body)
    assert "page-secret" not in json.dumps(body)


def test_public_meta_messages_omit_platform_ids(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    conversation = SimpleNamespace(
        id=conversation_id,
        channel=MetaChannel.FACEBOOK,
        platform_user_id="psid-secret",
        page_id="page-secret",
        profile_name="Kitie",
        contact=None,
        first_inbound_at=datetime(2026, 8, 1, tzinfo=UTC),
        last_message_at=datetime(2026, 8, 2, tzinfo=UTC),
        created_at=datetime(2026, 8, 1, tzinfo=UTC),
    )
    message = SimpleNamespace(
        id=uuid4(),
        platform_message_id="m_secret",
        direction=MetaMessageDirection.INBOUND,
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

    monkeypatch.setattr(pmeta, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(pmeta, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pmeta, "get_engine", lambda: object())

    path = f"/v1/public/meta/conversations/{conversation_id}/messages"
    response = pmeta.handle_public_meta_request(
        _token_event(api_gateway_event, path, scope="admin"),
        "GET",
        path,
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"][0]["body"] == "How much?"
    assert "platform_message_id" not in body["items"][0]
    assert "platform_user_id" not in body["conversation"]
    assert "m_secret" not in json.dumps(body)
    assert "psid-secret" not in json.dumps(body)
