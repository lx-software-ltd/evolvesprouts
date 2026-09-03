"""Tests for admin lead merge API and payload parsing."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.api import admin_leads
from app.api.admin_leads_common import parse_merge_leads_payload
from app.api.admin_request import RequestIdentity
from app.exceptions import ValidationError


def _build_admin_identity(admin_identity: dict[str, str]) -> RequestIdentity:
    return RequestIdentity(
        user_sub=admin_identity.get("userSub"),
        groups=set(admin_identity.get("groups", "").split(",")),
        organization_ids=set(admin_identity.get("organizationIds", "").split(",")),
    )


def test_parse_merge_leads_payload_requires_two_ids() -> None:
    with pytest.raises(ValidationError, match="lead_ids"):
        parse_merge_leads_payload({"lead_ids": [str(uuid4())], "keeper_lead_id": str(uuid4())})


def test_parse_merge_leads_payload_requires_keeper() -> None:
    first = str(uuid4())
    second = str(uuid4())
    with pytest.raises(ValidationError, match="keeper_lead_id"):
        parse_merge_leads_payload({"lead_ids": [first, second]})


def test_parse_merge_leads_payload_parses_uuids() -> None:
    first = uuid4()
    second = uuid4()
    keeper = first
    payload = parse_merge_leads_payload(
        {"lead_ids": [str(first), str(second)], "keeper_lead_id": str(keeper)}
    )
    assert payload["lead_ids"] == [first, second]
    assert payload["keeper_lead_id"] == keeper


def test_handle_admin_leads_dispatches_merge(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(
        admin_leads,
        "require_admin_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    monkeypatch.setattr(admin_leads, "_merge_leads", lambda *_args, **_kwargs: marker)

    response = admin_leads.handle_admin_leads_request(
        api_gateway_event(method="POST", path="/v1/admin/leads/merge"),
        "POST",
        "/v1/admin/leads/merge",
    )

    assert response is marker
