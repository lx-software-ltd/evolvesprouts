"""Tests for GET/POST /v1/whatsapp/webhook."""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

import pytest

from app.api import public_whatsapp_webhook as wh


def _sign(body: bytes, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def test_whatsapp_webhook_rejects_unsupported_method(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="PUT", path="/v1/whatsapp/webhook")
    response = wh.handle_whatsapp_webhook(event, "PUT")
    assert response["statusCode"] == 405


def test_whatsapp_webhook_get_requires_token(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", raising=False)
    event = api_gateway_event(method="GET", path="/v1/whatsapp/webhook")
    response = wh.handle_whatsapp_webhook(event, "GET")
    assert response["statusCode"] == 500


def test_whatsapp_webhook_get_rejects_wrong_token(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "expected")
    event = api_gateway_event(
        method="GET",
        path="/v1/whatsapp/webhook",
        query_params={
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong",
            "hub.challenge": "12345",
        },
    )
    response = wh.handle_whatsapp_webhook(event, "GET")
    assert response["statusCode"] == 403


def test_whatsapp_webhook_get_returns_challenge(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "expected")
    event = api_gateway_event(
        method="GET",
        path="/v1/whatsapp/webhook",
        query_params={
            "hub.mode": "subscribe",
            "hub.verify_token": "expected",
            "hub.challenge": "12345",
        },
    )
    response = wh.handle_whatsapp_webhook(event, "GET")
    assert response["statusCode"] == 200
    assert response["body"] == "12345"
    assert "text/plain" in response["headers"]["Content-Type"]


def test_whatsapp_webhook_post_rejects_bad_signature(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_APP_SECRET", "app-secret")
    body = json.dumps({"object": "whatsapp_business_account", "entry": []})
    event = api_gateway_event(
        method="POST",
        path="/v1/whatsapp/webhook",
        headers={
            "Content-Type": "application/json",
            "X-Hub-Signature-256": "sha256=deadbeef",
        },
        body=body,
    )
    response = wh.handle_whatsapp_webhook(event, "POST")
    assert response["statusCode"] == 401


def test_whatsapp_webhook_post_ingests_payload(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_APP_SECRET", "app-secret")
    payload = {"object": "whatsapp_business_account", "entry": []}
    raw = json.dumps(payload).encode("utf-8")

    class _FakeSession:
        def commit(self) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    audit_calls: list[dict[str, str | None]] = []

    def _capture_audit(
        _session: object,
        user_id: str | None = None,
        request_id: str | None = None,
    ) -> None:
        audit_calls.append({"user_id": user_id, "request_id": request_id})

    monkeypatch.setattr(wh, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(wh, "get_engine", lambda: object())
    monkeypatch.setattr(wh, "set_audit_context", _capture_audit)
    monkeypatch.setattr(
        wh,
        "ingest_webhook_payload",
        lambda *_a, **_k: {
            "stored": 1,
            "duplicates": 0,
            "skipped": 0,
            "leads_created": 1,
        },
    )
    event = api_gateway_event(
        method="POST",
        path="/v1/whatsapp/webhook",
        headers={
            "Content-Type": "application/json",
            "X-Hub-Signature-256": _sign(raw, "app-secret"),
        },
        body=raw.decode("utf-8"),
    )
    response = wh.handle_whatsapp_webhook(event, "POST")
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["stored"] == 1
    assert body["leads_created"] == 1
    assert audit_calls == [
        {"user_id": "webhook:whatsapp", "request_id": "test-request-id"}
    ]
