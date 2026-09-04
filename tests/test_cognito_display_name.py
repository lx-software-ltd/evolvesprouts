"""Tests for insight display-name resolution."""

from __future__ import annotations

from types import SimpleNamespace

from app.db.audit import SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID
from app.services.cognito_display_name import (
    SCHEDULED_DISPLAY_NAME,
    display_name_from_cognito_attributes,
    resolve_insight_generated_by_name,
)


def test_display_name_prefers_name_then_given_then_email_local() -> None:
    assert (
        display_name_from_cognito_attributes(
            [
                {"Name": "name", "Value": "Ida"},
                {"Name": "given_name", "Value": "I"},
                {"Name": "email", "Value": "ida@example.com"},
            ]
        )
        == "Ida"
    )
    assert (
        display_name_from_cognito_attributes(
            [
                {"Name": "given_name", "Value": "Luca"},
                {"Name": "email", "Value": "luca@example.com"},
            ]
        )
        == "Luca"
    )
    assert (
        display_name_from_cognito_attributes([{"Name": "email", "Value": "ops@example.com"}])
        == "ops"
    )
    assert display_name_from_cognito_attributes([]) is None


def test_scheduled_run_uses_default_assignee_name(monkeypatch: object) -> None:
    monkeypatch.setattr(
        "app.services.cognito_display_name.read_sales_settings_values",
        lambda _session: ("assignee-sub", False),
    )
    monkeypatch.setattr(
        "app.services.cognito_display_name.cognito_display_name_for_sub",
        lambda sub: "Ida" if sub == "assignee-sub" else None,
    )
    name = resolve_insight_generated_by_name(
        SimpleNamespace(),
        actor_sub=SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID,
    )
    assert name == "Ida"


def test_scheduled_run_falls_back_when_assignee_missing(monkeypatch: object) -> None:
    monkeypatch.setattr(
        "app.services.cognito_display_name.read_sales_settings_values",
        lambda _session: (None, False),
    )
    monkeypatch.setattr(
        "app.services.cognito_display_name.cognito_display_name_for_sub",
        lambda _sub: None,
    )
    name = resolve_insight_generated_by_name(
        SimpleNamespace(),
        actor_sub=SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID,
    )
    assert name == SCHEDULED_DISPLAY_NAME


def test_manual_run_uses_logged_in_user_name(monkeypatch: object) -> None:
    monkeypatch.setattr(
        "app.services.cognito_display_name.cognito_display_name_for_sub",
        lambda sub: "Luca" if sub == "user-sub" else None,
    )
    name = resolve_insight_generated_by_name(SimpleNamespace(), actor_sub="user-sub")
    assert name == "Luca"
