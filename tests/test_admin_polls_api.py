"""Tests for admin poll response management routes."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.api import admin_polls
from app.exceptions import AuthorizationError
from app.services import poll_responses_store as store


@pytest.fixture(autouse=True)
def reset_poll_store() -> None:
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


def test_list_polls_requires_auth(api_gateway_event: Any) -> None:
    with pytest.raises(AuthorizationError, match="Authenticated user is required"):
        admin_polls.handle_admin_polls_request(
            api_gateway_event(method="GET", path="/v1/admin/polls"),
            "GET",
            "/v1/admin/polls",
        )


def test_list_polls_returns_summaries(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.scan.return_value = {
        "Items": [
            {"pk": "POLL#workshop-food-jun-26", "pollSlug": "workshop-food-jun-26"},
            {"pk": "POLL#workshop-food-jun-26", "pollSlug": "workshop-food-jun-26"},
        ]
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_polls,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_polls.handle_admin_polls_request(
        _identity_event(api_gateway_event, method="GET", path="/v1/admin/polls"),
        "GET",
        "/v1/admin/polls",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"] == [{"pollSlug": "workshop-food-jun-26", "answerCount": 2}]


def test_list_poll_answers_excludes_control_row(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "pk": "POLL#workshop-food-jun-26",
                "sk": "CONTROL",
                "pollSlug": "workshop-food-jun-26",
            },
            {
                "pk": "POLL#workshop-food-jun-26",
                "sk": "SESSION#550e8400-e29b-41d4-a716-446655440000#Q#role",
                "pollSlug": "workshop-food-jun-26",
                "sessionId": "550e8400-e29b-41d4-a716-446655440000",
                "questionId": "role",
                "questionType": "select",
                "selectedOption": "Parent",
                "createdAt": "2026-06-26T10:00:00Z",
                "updatedAt": "2026-06-26T10:00:00Z",
            },
        ]
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_polls,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_polls.handle_admin_polls_request(
        _identity_event(
            api_gateway_event,
            method="GET",
            path="/v1/admin/polls/workshop-food-jun-26/answers",
        ),
        "GET",
        "/v1/admin/polls/workshop-food-jun-26/answers",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body["items"]) == 1
    assert body["items"][0]["questionId"] == "role"


def test_list_poll_answers_returns_rows(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "pk": "POLL#workshop-food-jun-26",
                "sk": "SESSION#550e8400-e29b-41d4-a716-446655440000#Q#role",
                "pollSlug": "workshop-food-jun-26",
                "sessionId": "550e8400-e29b-41d4-a716-446655440000",
                "questionId": "role",
                "questionType": "select",
                "selectedOption": "Parent",
                "createdAt": "2026-06-26T10:00:00Z",
                "updatedAt": "2026-06-26T10:00:00Z",
            }
        ]
    }
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_polls,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_polls.handle_admin_polls_request(
        _identity_event(
            api_gateway_event,
            method="GET",
            path="/v1/admin/polls/workshop-food-jun-26/answers",
        ),
        "GET",
        "/v1/admin/polls/workshop-food-jun-26/answers",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body["items"]) == 1
    assert body["items"][0]["selectedOption"] == "Parent"


def test_clear_poll_answers_preserves_control_row(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "pk": "POLL#workshop-food-jun-26",
                "sk": "CONTROL",
            },
            {
                "pk": "POLL#workshop-food-jun-26",
                "sk": "SESSION#550e8400-e29b-41d4-a716-446655440000#Q#role",
            },
        ]
    }
    batch = MagicMock()
    batch.__enter__ = MagicMock(return_value=batch)
    batch.__exit__ = MagicMock(return_value=False)
    table.batch_writer.return_value = batch
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_polls,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_polls.handle_admin_polls_request(
        _identity_event(
            api_gateway_event,
            method="DELETE",
            path="/v1/admin/polls/workshop-food-jun-26/answers",
        ),
        "DELETE",
        "/v1/admin/polls/workshop-food-jun-26/answers",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["deletedCount"] == 1
    batch.delete_item.assert_called_once()
    assert batch.delete_item.call_args.kwargs["Key"]["sk"] != "CONTROL"


def test_clear_poll_answers_deletes_rows(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {
                "pk": "POLL#workshop-food-jun-26",
                "sk": "SESSION#550e8400-e29b-41d4-a716-446655440000#Q#role",
            }
        ]
    }
    batch = MagicMock()
    batch.__enter__ = MagicMock(return_value=batch)
    batch.__exit__ = MagicMock(return_value=False)
    table.batch_writer.return_value = batch
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_polls,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_polls.handle_admin_polls_request(
        _identity_event(
            api_gateway_event,
            method="DELETE",
            path="/v1/admin/polls/workshop-food-jun-26/answers",
        ),
        "DELETE",
        "/v1/admin/polls/workshop-food-jun-26/answers",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body == {"pollSlug": "workshop-food-jun-26", "deletedCount": 1}
    batch.delete_item.assert_called_once()


def test_export_poll_answers_returns_csv(
    monkeypatch: Any,
    api_gateway_event: Any,
    mock_env: Any,
) -> None:
    table = MagicMock()
    table.query.return_value = {"Items": []}
    store.configure_table_for_tests(table)
    mock_env(POLL_RESPONSES_TABLE_NAME="evolvesprouts-poll-responses")
    monkeypatch.setattr(
        admin_polls,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_polls.handle_admin_polls_request(
        _identity_event(
            api_gateway_event,
            method="GET",
            path="/v1/admin/polls/workshop-food-jun-26/answers/export",
        ),
        "GET",
        "/v1/admin/polls/workshop-food-jun-26/answers/export",
    )
    assert response["statusCode"] == 200
    assert response["headers"]["Content-Type"] == "text/csv; charset=utf-8"
    assert "Poll Slug" in response["body"]
