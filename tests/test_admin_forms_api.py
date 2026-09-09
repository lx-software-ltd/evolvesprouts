"""Tests for admin form response management routes."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.api import admin_forms
from app.exceptions import AuthorizationError, ValidationError
from app.services import form_responses_store as store


@pytest.fixture(autouse=True)
def reset_form_store() -> None:
    store.reset_table_for_tests()
    yield
    store.reset_table_for_tests()


def _identity_event(
    api_gateway_event: Any, *, method: str, path: str
) -> dict[str, Any]:
    return api_gateway_event(
        method=method,
        path=path,
        headers={"authorization": "Bearer test-token"},
    )


def test_list_forms_requires_auth(api_gateway_event: Any) -> None:
    with pytest.raises(AuthorizationError, match="Authenticated user is required"):
        admin_forms.handle_admin_forms_request(
            api_gateway_event(method="GET", path="/v1/admin/forms"),
            "GET",
            "/v1/admin/forms",
        )


def test_list_forms_returns_summaries(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.scan.return_value = {
        "Items": [
            {
                "pk": "FORM#workshop-feedback",
                "formSlug": "workshop-feedback",
                "sk": "SESSION#550e8400-e29b-41d4-a716-446655440000#Q#name",
            },
            {
                "pk": "FORM#workshop-feedback",
                "formSlug": "workshop-feedback",
                "sk": "SESSION#550e8400-e29b-41d4-a716-446655440000#Q#email",
            },
        ]
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_forms,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_forms.handle_admin_forms_request(
        _identity_event(api_gateway_event, method="GET", path="/v1/admin/forms"),
        "GET",
        "/v1/admin/forms",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"] == [{"formSlug": "workshop-feedback", "answerCount": 2}]


def test_list_form_answers_paginates_with_cursor(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
    admin_identity: dict[str, str],
) -> None:
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "pk": "FORM#workshop-feedback",
                "sk": "SESSION#s-1#Q#name",
                "formSlug": "workshop-feedback",
                "sessionId": "s-1",
                "questionId": "name",
                "questionType": "text",
                "freeText": "Ada",
                "contactId": "11111111-1111-4111-8111-111111111111",
                "createdAt": "2026-01-01T10:00:00Z",
                "updatedAt": "2026-01-02T10:00:00Z",
            },
            {
                "pk": "FORM#workshop-feedback",
                "sk": "SESSION#s-2#Q#name",
                "formSlug": "workshop-feedback",
                "sessionId": "s-2",
                "questionId": "name",
                "questionType": "text",
                "freeText": "Ben",
                "createdAt": "2026-01-01T09:00:00Z",
                "updatedAt": "2026-01-01T10:00:00Z",
            },
        ]
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_forms,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    first = admin_forms.handle_admin_forms_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/forms/workshop-feedback/answers",
            query_params={"limit": "1"},
            authorizer_context=admin_identity,
            headers={"authorization": "Bearer test-token"},
        ),
        "GET",
        "/v1/admin/forms/workshop-feedback/answers",
    )
    first_body = json.loads(first["body"])
    assert len(first_body["items"]) == 1
    assert first_body["items"][0]["sessionId"] == "s-1"
    assert first_body["items"][0]["contactId"] == "11111111-1111-4111-8111-111111111111"
    assert first_body["next_cursor"]
    assert first_body["respondentContactIds"] == [
        "11111111-1111-4111-8111-111111111111"
    ]

    second = admin_forms.handle_admin_forms_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/forms/workshop-feedback/answers",
            query_params={"limit": "1", "cursor": first_body["next_cursor"]},
            authorizer_context=admin_identity,
            headers={"authorization": "Bearer test-token"},
        ),
        "GET",
        "/v1/admin/forms/workshop-feedback/answers",
    )
    second_body = json.loads(second["body"])
    assert [row["sessionId"] for row in second_body["items"]] == ["s-2"]
    assert second_body["next_cursor"] is None
    assert second_body["respondentContactIds"] == [
        "11111111-1111-4111-8111-111111111111"
    ]


def test_list_form_answers_filters_by_contact_id(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
    admin_identity: dict[str, str],
) -> None:
    contact_a = "11111111-1111-4111-8111-111111111111"
    contact_b = "22222222-2222-4222-8222-222222222222"
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "pk": "FORM#family-check-in",
                "sk": "SESSION#s-1#Q#name",
                "formSlug": "family-check-in",
                "sessionId": "s-1",
                "questionId": "name",
                "questionType": "text",
                "freeText": "Ada",
                "contactId": contact_a,
                "createdAt": "2026-01-01T10:00:00Z",
                "updatedAt": "2026-01-02T10:00:00Z",
            },
            {
                "pk": "FORM#family-check-in",
                "sk": "SESSION#s-2#Q#name",
                "formSlug": "family-check-in",
                "sessionId": "s-2",
                "questionId": "name",
                "questionType": "text",
                "freeText": "Ben",
                "contactId": contact_b,
                "createdAt": "2026-01-01T09:00:00Z",
                "updatedAt": "2026-01-01T10:00:00Z",
            },
        ]
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_forms,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_forms.handle_admin_forms_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/forms/family-check-in/answers",
            query_params={"contact_id": contact_b, "limit": "25"},
            authorizer_context=admin_identity,
            headers={"authorization": "Bearer test-token"},
        ),
        "GET",
        "/v1/admin/forms/family-check-in/answers",
    )
    body = json.loads(response["body"])
    assert [row["sessionId"] for row in body["items"]] == ["s-2"]
    assert body["next_cursor"] is None
    assert body["respondentContactIds"] == [contact_a, contact_b]


def test_list_form_answers_rejects_invalid_contact_id(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
    admin_identity: dict[str, str],
) -> None:
    table = MagicMock()
    table.query.return_value = {"Items": []}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_forms,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    with pytest.raises(ValidationError, match="contact_id must be a UUID"):
        admin_forms.handle_admin_forms_request(
            api_gateway_event(
                method="GET",
                path="/v1/admin/forms/family-check-in/answers",
                query_params={"contact_id": "not-a-uuid"},
                authorizer_context=admin_identity,
                headers={"authorization": "Bearer test-token"},
            ),
            "GET",
            "/v1/admin/forms/family-check-in/answers",
        )
