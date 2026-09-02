"""Tests for admin form response management routes."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.api import admin_forms
from app.exceptions import AuthorizationError
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
