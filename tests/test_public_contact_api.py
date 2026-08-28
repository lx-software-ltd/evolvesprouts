"""Tests for native POST /v1/contact-us handler."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.api import public_contact as pc


def _post_event(
    api_gateway_event: Any,
    *,
    body: dict[str, Any],
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    merged = {"X-Turnstile-Token": "tok", **(headers or {})}
    return api_gateway_event(
        method="POST",
        path="/v1/contact-us",
        body=json.dumps(body),
        headers=merged,
    )


def test_handle_public_contact_us_rejects_without_turnstile_header(
    api_gateway_event: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/contact-us",
        body=json.dumps({"signup_intent": "contact_inquiry"}),
        headers={},
    )
    resp = pc.handle_public_contact_us(event, "POST")
    assert resp["statusCode"] == 400


def test_handle_public_contact_us_rejects_failed_turnstile(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pc, "verify_turnstile_token", lambda *_a, **_k: False)
    event = _post_event(
        api_gateway_event,
        body={
            "first_name": "Ada",
            "email_address": "ada@example.com",
            "signup_intent": "contact_inquiry",
        },
    )
    resp = pc.handle_public_contact_us(event, "POST")
    assert resp["statusCode"] == 403


def test_handle_public_contact_us_rejects_non_post(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/contact-us")
    resp = pc.handle_public_contact_us(event, "GET")
    assert resp["statusCode"] == 405


def test_handle_public_contact_us_validation_errors(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pc, "verify_turnstile_token", lambda *_a, **_k: True)
    event = _post_event(
        api_gateway_event,
        body={
            "first_name": "Ada",
            "email_address": "ada@example.com",
            # missing signup_intent
        },
    )
    resp = pc.handle_public_contact_us(event, "POST")
    assert resp["statusCode"] == 400


def test_handle_public_contact_us_persists_and_runs_hooks(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pc, "verify_turnstile_token", lambda *_a, **_k: True)
    hook = MagicMock()
    monkeypatch.setattr(pc, "run_contact_us_post_success", hook)

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(pc, "SalesLead", _FakeSalesLead)

    contact_id = uuid4()

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_open_by_contact(self, *_a: object, **_k: object) -> None:
            return None

        def create_with_event(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSession:
        def commit(self) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(pc, "ContactRepository", _FakeContactRepo)
    monkeypatch.setattr(pc, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(pc, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pc, "get_engine", lambda: object())

    event = _post_event(
        api_gateway_event,
        body={
            "first_name": "Ada",
            "email_address": "ada@example.com",
            "signup_intent": "contact_inquiry",
            "message": "Hello",
            "locale": "en",
        },
    )
    resp = pc.handle_public_contact_us(event, "POST")
    assert resp["statusCode"] == 202
    hook.assert_called_once()
    _call_kw = hook.call_args.kwargs
    assert _call_kw["event"] is event
    payload = _call_kw["payload"]
    assert payload["email_address"] == "ada@example.com"
    assert payload["signup_intent"] == "contact_inquiry"
    assert payload["message"] == "Hello"


def test_handle_public_contact_us_newsletter_creates_sales_lead(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pc, "verify_turnstile_token", lambda *_a, **_k: True)
    monkeypatch.setattr(pc, "run_contact_us_post_success", MagicMock())

    lead_create = MagicMock()

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            self.lead_type = kwargs.get("lead_type")

    monkeypatch.setattr(pc, "SalesLead", _FakeSalesLead)

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = uuid4()
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_open_by_contact(self, *_a: object, **_k: object) -> None:
            return None

        def create_with_event(self, *a: object, **k: object) -> None:
            lead_create(*a, **k)

    class _FakeSession:
        def commit(self) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(pc, "ContactRepository", _FakeContactRepo)
    monkeypatch.setattr(pc, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(pc, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pc, "get_engine", lambda: object())

    event = _post_event(
        api_gateway_event,
        body={
            "first_name": "Ada",
            "email_address": "ada@example.com",
            "signup_intent": "community_newsletter",
        },
    )
    resp = pc.handle_public_contact_us(event, "POST")
    assert resp["statusCode"] == 202
    lead_create.assert_called_once()
    created_lead = lead_create.call_args.args[0]
    assert created_lead.lead_type == pc.LeadType.OTHER


def test_handle_public_contact_us_hook_failure_still_returns_202(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pc, "verify_turnstile_token", lambda *_a, **_k: True)

    def _boom(**_k: object) -> None:
        raise RuntimeError("hook failed")

    monkeypatch.setattr(pc, "run_contact_us_post_success", _boom)

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(pc, "SalesLead", _FakeSalesLead)

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = uuid4()
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_open_by_contact(self, *_a: object, **_k: object) -> None:
            return None

        def create_with_event(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSession:
        def commit(self) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(pc, "ContactRepository", _FakeContactRepo)
    monkeypatch.setattr(pc, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(pc, "Session", lambda _e: _FakeSessionCM())
    monkeypatch.setattr(pc, "get_engine", lambda: object())

    event = _post_event(
        api_gateway_event,
        body={
            "first_name": "Ada",
            "email_address": "ada@example.com",
            "signup_intent": "contact_inquiry",
        },
    )
    resp = pc.handle_public_contact_us(event, "POST")
    assert resp["statusCode"] == 202
