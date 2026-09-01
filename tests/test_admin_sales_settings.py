from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from app.api import admin_sales_settings as settings_api
from app.api.admin_leads_common import parse_create_lead_payload
from app.exceptions import ValidationError


def test_parse_sales_settings_payload_accepts_partial() -> None:
    payload = settings_api.parse_sales_settings_payload(
        {"notify_assignee_on_assignment": True}
    )
    assert payload == {"notify_assignee_on_assignment": True}


def test_parse_sales_settings_payload_clears_default() -> None:
    payload = settings_api.parse_sales_settings_payload({"default_assigned_to": None})
    assert payload == {"default_assigned_to": None}


def test_parse_sales_settings_payload_rejects_empty() -> None:
    with pytest.raises(ValidationError, match="At least one field"):
        settings_api.parse_sales_settings_payload({})


def test_parse_sales_settings_payload_rejects_non_bool() -> None:
    with pytest.raises(ValidationError, match="boolean"):
        settings_api.parse_sales_settings_payload(
            {"notify_assignee_on_assignment": "true"}
        )


def test_parse_sales_settings_payload_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError, match="Unsupported field"):
        settings_api.parse_sales_settings_payload({"foo": 1})


def test_parse_create_lead_marks_assigned_to_omitted() -> None:
    payload = parse_create_lead_payload(
        {
            "first_name": "Ada",
            "source": "manual",
            "lead_type": "consultation",
        }
    )
    assert payload["assigned_to"] is None
    assert payload["assigned_to_provided"] is False


def test_parse_create_lead_marks_assigned_to_explicit_null() -> None:
    payload = parse_create_lead_payload(
        {
            "first_name": "Ada",
            "source": "manual",
            "lead_type": "consultation",
            "assigned_to": None,
        }
    )
    assert payload["assigned_to"] is None
    assert payload["assigned_to_provided"] is True


def test_handle_sales_settings_get(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    row = MagicMock()
    row.default_assigned_to = "user-1"
    row.notify_assignee_on_assignment = True
    row.updated_at = None
    row.updated_by = "admin-1"
    repo = MagicMock()
    repo.get_or_create.return_value = row

    class _Session:
        def __enter__(self) -> MagicMock:
            return MagicMock()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(settings_api, "get_engine", lambda: object())
    monkeypatch.setattr(settings_api, "Session", lambda _engine: _Session())
    monkeypatch.setattr(settings_api, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(settings_api, "SalesSettingsRepository", lambda _s: repo)

    response = settings_api.handle_sales_settings_request(
        api_gateway_event(method="GET", path="/v1/admin/leads/settings"),
        "GET",
        actor_sub="admin-1",
    )
    assert response["statusCode"] == 200
    repo.get_or_create.assert_called_once()


def test_handle_sales_settings_rejects_method(api_gateway_event: Any) -> None:
    response = settings_api.handle_sales_settings_request(
        api_gateway_event(method="POST", path="/v1/admin/leads/settings"),
        "POST",
        actor_sub="admin-1",
    )
    assert response["statusCode"] == 405
