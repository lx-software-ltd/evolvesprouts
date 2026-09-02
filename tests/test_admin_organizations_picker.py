from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.api import admin_organizations_picker
from app.api.admin_request import RequestIdentity
from app.db.models import RelationshipType


def _admin_identity() -> RequestIdentity:
    return RequestIdentity(
        user_sub="admin-sub",
        groups={"admin"},
        organization_ids=set(),
    )


@pytest.fixture
def picker_session(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    session = MagicMock()

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            pass

        def __enter__(self) -> MagicMock:
            return session

        def __exit__(self, *_args: Any) -> bool:
            return False

    monkeypatch.setattr(admin_organizations_picker, "Session", _SessionCtx)
    monkeypatch.setattr(admin_organizations_picker, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_organizations_picker,
        "extract_identity",
        lambda _event: _admin_identity(),
    )
    return session


def _make_org_list_result(rows: list[tuple[Any, ...]]) -> MagicMock:
    m = MagicMock()
    m.all.return_value = rows
    return m


def test_picker_default_excludes_vendors_and_partners(
    api_gateway_event: Any,
    picker_session: MagicMock,
) -> None:
    org_id = uuid4()
    picker_session.execute.side_effect = [
        _make_org_list_result([(org_id, "Alpha Org")]),
        _make_org_list_result([]),
    ]

    path = "/v1/admin/organizations/picker"
    response = admin_organizations_picker.handle_admin_organizations_picker_request(
        api_gateway_event(method="GET", path=path),
        "GET",
        path,
    )

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"] == [{"id": str(org_id), "label": "Alpha Org"}]


def test_picker_relationship_type_partner_calls_parser(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
    picker_session: MagicMock,
) -> None:
    org_id = uuid4()
    picker_session.execute.side_effect = [
        _make_org_list_result([(org_id, "Partner Org")]),
        _make_org_list_result([]),
    ]
    captured: list[Any] = []

    def _capture(value: Any, *, field: str, allowed: Any = None) -> RelationshipType:
        captured.append((value, field))
        return RelationshipType.PARTNER

    monkeypatch.setattr(
        admin_organizations_picker,
        "parse_relationship_type",
        _capture,
    )

    path = "/v1/admin/organizations/picker"
    response = admin_organizations_picker.handle_admin_organizations_picker_request(
        api_gateway_event(
            method="GET",
            path=path,
            query_params={"relationship_type": "partner", "limit": "50"},
        ),
        "GET",
        path,
    )

    assert response["statusCode"] == 200
    assert captured == [("partner", "relationship_type")]
    body = json.loads(response["body"])
    assert body["items"] == [{"id": str(org_id), "label": "Partner Org"}]
