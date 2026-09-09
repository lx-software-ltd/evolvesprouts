"""Tests for PUT /v1/forms/{form_slug}/answers."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.api import public_forms as pf
from app.services import form_responses_store as store


@pytest.fixture(autouse=True)
def reset_form_store() -> None:
    store.reset_table_for_tests()
    yield
    store.reset_table_for_tests()


def _event(api_gateway_event: Any, *, body: dict[str, Any]) -> dict[str, Any]:
    return api_gateway_event(
        method="PUT",
        path="/www/v1/forms/workshop-feedback/answers",
        body=json.dumps(body),
        headers={"content-type": "application/json"},
    )


def test_put_form_answer_persists_select(api_gateway_event: Any, mock_env: Any) -> None:
    table = MagicMock()
    table.get_item.return_value = {"Item": None}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "rating",
        "questionType": "select",
        "selectedOption": "Excellent",
    }
    resp = pf.handle_public_forms_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/www/v1/forms/workshop-feedback/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["selectedOption"] == "Excellent"
    assert item["pk"] == "FORM#workshop-feedback"


def test_put_form_answer_persists_text(api_gateway_event: Any, mock_env: Any) -> None:
    table = MagicMock()
    table.get_item.return_value = {"Item": None}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "comments",
        "questionType": "text",
        "freeText": "Great workshop",
    }
    resp = pf.handle_public_forms_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/www/v1/forms/workshop-feedback/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["freeText"] == "Great workshop"


def test_put_form_answer_persists_rating(api_gateway_event: Any, mock_env: Any) -> None:
    table = MagicMock()
    table.get_item.return_value = {"Item": None}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "usefulness",
        "questionType": "rating",
        "ratingValue": 4,
    }
    resp = pf.handle_public_forms_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/www/v1/forms/workshop-exit-feedback/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["ratingValue"] == 4


def test_put_form_answer_persists_multiselect(
    api_gateway_event: Any, mock_env: Any
) -> None:
    table = MagicMock()
    table.get_item.return_value = {"Item": None}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "most-useful",
        "questionType": "multiselect",
        "selectedOptions": ["Mealtime scripts", "Practical tips"],
    }
    resp = pf.handle_public_forms_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/www/v1/forms/workshop-exit-feedback/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["selectedOptions"] == ["Mealtime scripts", "Practical tips"]


def test_put_form_answer_persists_consent(
    api_gateway_event: Any, mock_env: Any
) -> None:
    table = MagicMock()
    table.get_item.return_value = {"Item": None}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "share-consent",
        "questionType": "consent",
        "booleanAnswer": True,
        "freeText": "Year 3",
    }
    resp = pf.handle_public_forms_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/www/v1/forms/workshop-exit-feedback/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["booleanAnswer"] is True
    assert item["freeText"] == "Year 3"


def test_put_form_answer_rejects_truefalse(
    api_gateway_event: Any, mock_env: Any
) -> None:
    table = MagicMock()
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "rating",
        "questionType": "truefalse",
        "booleanAnswer": True,
    }
    resp = pf.handle_public_forms_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/www/v1/forms/workshop-feedback/answers",
    )
    assert resp["statusCode"] == 400


def test_put_form_answer_persists_contact_id(
    api_gateway_event: Any, mock_env: Any
) -> None:
    table = MagicMock()
    table.get_item.return_value = {"Item": None}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    contact_id = "11111111-1111-4111-8111-111111111111"

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "comments",
        "questionType": "text",
        "freeText": "Great workshop",
        "contactId": contact_id,
    }
    resp = pf.handle_public_forms_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/www/v1/forms/workshop-feedback/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["contactId"] == contact_id


def test_put_form_answer_preserves_existing_contact_id(
    api_gateway_event: Any, mock_env: Any
) -> None:
    table = MagicMock()
    table.get_item.return_value = {
        "Item": {
            "createdAt": "2026-01-01T00:00:00Z",
            "contactId": "11111111-1111-4111-8111-111111111111",
        }
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")

    body = {
        "sessionId": "550e8400-e29b-41d4-a716-446655440000",
        "questionId": "comments",
        "questionType": "text",
        "freeText": "Updated",
    }
    resp = pf.handle_public_forms_request(
        _event(api_gateway_event, body=body),
        "PUT",
        "/www/v1/forms/workshop-feedback/answers",
    )
    assert resp["statusCode"] == 200
    item = table.put_item.call_args.kwargs["Item"]
    assert item["contactId"] == "11111111-1111-4111-8111-111111111111"


def test_get_contact_context_requires_contact_id(
    api_gateway_event: Any,
) -> None:
    event = api_gateway_event(
        method="GET",
        path="/www/v1/forms/workshop-feedback/contact-context",
        query_params={},
        headers={"content-type": "application/json"},
    )
    resp = pf.handle_public_forms_request(
        event,
        "GET",
        "/www/v1/forms/workshop-feedback/contact-context",
    )
    assert resp["statusCode"] == 400
    assert "no-store" in resp["headers"]["Cache-Control"]


def test_get_contact_context_returns_placeholders(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    contact_id = "11111111-1111-4111-8111-111111111111"
    monkeypatch.setattr(
        "app.api.public_forms_contact.get_engine",
        lambda: object(),
    )

    class _FakeSession:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(
        "app.api.public_forms_contact.Session", lambda _engine: _FakeSession()
    )
    monkeypatch.setattr(
        "app.api.public_forms_contact.build_form_contact_placeholders",
        lambda **_kwargs: {
            "contactName": "Jane Doe",
            "contactFirstName": "Jane",
            "familyName": "The Does",
            "children.firstName": "Mia",
            "helpers.firstName": "your helper",
        },
    )
    event = api_gateway_event(
        method="GET",
        path="/www/v1/forms/workshop-feedback/contact-context",
        query_params={"contactId": contact_id},
        headers={"content-type": "application/json"},
    )
    resp = pf.handle_public_forms_request(
        event,
        "GET",
        "/www/v1/forms/workshop-feedback/contact-context",
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["contactId"] == contact_id
    assert body["placeholders"]["contactName"] == "Jane Doe"
    assert "no-store" in resp["headers"]["Cache-Control"]


def test_get_contact_context_returns_404_when_contact_missing(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    monkeypatch.setattr(
        "app.api.public_forms_contact.get_engine",
        lambda: object(),
    )

    class _FakeSession:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(
        "app.api.public_forms_contact.Session", lambda _engine: _FakeSession()
    )
    monkeypatch.setattr(
        "app.api.public_forms_contact.build_form_contact_placeholders",
        lambda **_kwargs: None,
    )
    event = api_gateway_event(
        method="GET",
        path="/www/v1/forms/workshop-feedback/contact-context",
        query_params={"contactId": "11111111-1111-4111-8111-111111111111"},
        headers={"content-type": "application/json"},
    )
    resp = pf.handle_public_forms_request(
        event,
        "GET",
        "/www/v1/forms/workshop-feedback/contact-context",
    )
    assert resp["statusCode"] == 404
    assert "no-store" in resp["headers"]["Cache-Control"]
