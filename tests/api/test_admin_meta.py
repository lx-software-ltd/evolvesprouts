"""Tests for admin Messenger and Instagram conversation read APIs."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.api import admin_meta as am
from app.db.models.enums import MetaChannel, MetaMessageDirection
from app.exceptions import AuthorizationError, ValidationError


def _identity_event(
    api_gateway_event: Any, path: str, **kwargs: object
) -> dict[str, Any]:
    return api_gateway_event(
        method="GET",
        path=path,
        authorizer_context={"userSub": "admin-user"},
        **kwargs,
    )


def test_admin_meta_requires_auth(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/admin/meta/conversations")
    with pytest.raises(AuthorizationError, match="Authenticated user is required"):
        am.handle_admin_meta_request(event, "GET", "/v1/admin/meta/conversations")


def test_admin_meta_unknown_route(api_gateway_event: Any) -> None:
    event = _identity_event(api_gateway_event, "/v1/admin/meta")
    response = am.handle_admin_meta_request(event, "GET", "/v1/admin/meta")
    assert response["statusCode"] == 404


def test_admin_meta_lists_conversations(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    row = SimpleNamespace(
        id=conversation_id,
        channel=MetaChannel.INSTAGRAM,
        platform_user_id="igsid-1",
        page_id="ig-page-1",
        profile_name="Kitie",
        contact_id=None,
        contact=None,
        lead_id=None,
        first_inbound_at=datetime(2026, 8, 1, tzinfo=UTC),
        last_message_at=datetime(2026, 8, 2, tzinfo=UTC),
        inbound_count=2,
        outbound_count=1,
        created_at=datetime(2026, 8, 1, tzinfo=UTC),
    )

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def list_conversations(self, **kwargs: object) -> list[object]:
            assert kwargs.get("channel") is MetaChannel.INSTAGRAM
            return [row]

        def count_conversations(self, **_k: object) -> int:
            return 1

    class _FakeSessionCM:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(am, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(am, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(am, "get_engine", lambda: object())

    event = _identity_event(
        api_gateway_event,
        "/v1/admin/meta/conversations",
        query_params={"channel": "instagram"},
    )
    response = am.handle_admin_meta_request(
        event, "GET", "/v1/admin/meta/conversations"
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["total_count"] == 1
    assert body["items"][0]["platform_user_id"] == "igsid-1"
    assert body["items"][0]["channel"] == "instagram"
    assert body["items"][0]["profile_name"] == "Kitie"


def test_admin_meta_lists_messages(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    conversation = SimpleNamespace(
        id=conversation_id,
        channel=MetaChannel.FACEBOOK,
        platform_user_id="psid-1",
        page_id="page-1",
        profile_name="Kitie",
        contact_id=None,
        contact=None,
        lead_id=None,
        first_inbound_at=None,
        last_message_at=None,
        inbound_count=1,
        outbound_count=0,
        created_at=datetime(2026, 8, 1, tzinfo=UTC),
    )
    message = SimpleNamespace(
        id=uuid4(),
        platform_message_id="m_1",
        direction=MetaMessageDirection.INBOUND,
        message_type="text",
        body="Hello",
        sent_at=datetime(2026, 8, 1, tzinfo=UTC),
    )

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_conversation_by_id(self, _cid: object) -> object:
            return conversation

        def list_messages(self, **_k: object) -> list[object]:
            return [message]

    class _FakeSessionCM:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(am, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(am, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(am, "get_engine", lambda: object())

    path = f"/v1/admin/meta/conversations/{conversation_id}/messages"
    event = _identity_event(api_gateway_event, path)
    response = am.handle_admin_meta_request(event, "GET", path)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["conversation"]["id"] == str(conversation_id)
    assert body["items"][0]["body"] == "Hello"
    assert body["items"][0]["direction"] == "inbound"
    assert body["items"][0]["platform_message_id"] == "m_1"
