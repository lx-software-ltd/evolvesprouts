from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.api import admin_leads
from app.api.admin_leads_common import parse_lead_filters
from app.api.assets.assets_common import RequestIdentity
from app.exceptions import ValidationError


def _build_admin_identity(admin_identity: dict[str, str]) -> RequestIdentity:
    return RequestIdentity(
        user_sub=admin_identity.get("userSub"),
        groups=set(admin_identity.get("groups", "").split(",")),
        organization_ids=set(admin_identity.get("organizationIds", "").split(",")),
    )


def test_handle_admin_leads_dispatches_collection_get(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(
        admin_leads,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    monkeypatch.setattr(admin_leads, "_list_leads", lambda _: marker)

    response = admin_leads.handle_admin_leads_request(
        api_gateway_event(method="GET", path="/v1/admin/leads"),
        "GET",
        "/v1/admin/leads",
    )

    assert response is marker


def test_handle_admin_leads_dispatches_settings(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        admin_leads,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )

    def _fake_settings(event: Any, method: str, *, actor_sub: str) -> dict[str, Any]:
        captured["method"] = method
        captured["actor_sub"] = actor_sub
        captured["event"] = event
        return marker

    monkeypatch.setattr(admin_leads, "handle_sales_settings_request", _fake_settings)

    response = admin_leads.handle_admin_leads_request(
        api_gateway_event(method="PATCH", path="/v1/admin/leads/settings"),
        "PATCH",
        "/v1/admin/leads/settings",
    )

    assert response is marker
    assert captured["method"] == "PATCH"
    assert captured["actor_sub"] == admin_identity["userSub"]


def test_handle_admin_leads_dispatches_analytics_before_uuid_parsing(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(
        admin_leads,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    monkeypatch.setattr(admin_leads, "_get_analytics", lambda _: marker)

    response = admin_leads.handle_admin_leads_request(
        api_gateway_event(method="GET", path="/v1/admin/leads/analytics"),
        "GET",
        "/v1/admin/leads/analytics",
    )

    assert response is marker


def test_handle_admin_leads_dispatches_resource_patch(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        admin_leads,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )

    def _fake_update(_event: Any, *, lead_id: Any, actor_sub: str) -> dict[str, Any]:
        captured["lead_id"] = lead_id
        captured["actor_sub"] = actor_sub
        return marker

    monkeypatch.setattr(admin_leads, "_update_lead", _fake_update)
    lead_id = str(uuid4())

    response = admin_leads.handle_admin_leads_request(
        api_gateway_event(method="PATCH", path=f"/v1/admin/leads/{lead_id}"),
        "PATCH",
        f"/v1/admin/leads/{lead_id}",
    )

    assert response is marker
    assert str(captured["lead_id"]) == lead_id
    assert captured["actor_sub"] == admin_identity["userSub"]


def test_handle_admin_leads_dispatches_note_creation(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 201, "body": "{}"}
    monkeypatch.setattr(
        admin_leads,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    monkeypatch.setattr(
        admin_leads, "_create_lead_note", lambda *_args, **_kwargs: marker
    )
    lead_id = str(uuid4())

    response = admin_leads.handle_admin_leads_request(
        api_gateway_event(method="POST", path=f"/v1/admin/leads/{lead_id}/notes"),
        "POST",
        f"/v1/admin/leads/{lead_id}/notes",
    )

    assert response is marker


def test_handle_admin_leads_dispatches_ai_suggestion_get(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(
        admin_leads,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    monkeypatch.setattr(
        admin_leads, "_get_lead_ai_suggestion", lambda *_args, **_kwargs: marker
    )
    lead_id = str(uuid4())

    response = admin_leads.handle_admin_leads_request(
        api_gateway_event(
            method="GET", path=f"/v1/admin/leads/{lead_id}/ai-suggestion"
        ),
        "GET",
        f"/v1/admin/leads/{lead_id}/ai-suggestion",
    )

    assert response is marker


def test_handle_admin_leads_dispatches_ai_suggestion_post(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 201, "body": "{}"}
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        admin_leads,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )

    def _fake_create(event: Any, *, lead_id: Any, actor_sub: str) -> dict[str, Any]:
        captured["lead_id"] = str(lead_id)
        captured["actor_sub"] = actor_sub
        captured["event"] = event
        return marker

    monkeypatch.setattr(admin_leads, "_create_lead_ai_suggestion", _fake_create)
    lead_id = str(uuid4())

    response = admin_leads.handle_admin_leads_request(
        api_gateway_event(
            method="POST", path=f"/v1/admin/leads/{lead_id}/ai-suggestion"
        ),
        "POST",
        f"/v1/admin/leads/{lead_id}/ai-suggestion",
    )

    assert response is marker
    assert captured["lead_id"] == lead_id
    assert captured["actor_sub"] == admin_identity["userSub"]


def test_parse_lead_filters_defaults_to_standard_admin_limit(
    api_gateway_event: Any,
) -> None:
    filters = parse_lead_filters(
        api_gateway_event(method="GET", path="/v1/admin/leads")
    )

    assert filters["limit"] == 25


def test_parse_lead_filters_rejects_cursor_for_non_created_sort(
    api_gateway_event: Any,
) -> None:
    event = api_gateway_event(
        method="GET",
        path="/v1/admin/leads",
        query_params={"cursor": "abc", "sort": "updated_at"},
    )

    with pytest.raises(ValidationError, match="cursor is only supported"):
        parse_lead_filters(event)
