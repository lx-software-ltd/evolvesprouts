from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.api import admin_families_picker
from app.api.admin_request import RequestIdentity


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

    monkeypatch.setattr(admin_families_picker, "Session", _SessionCtx)
    monkeypatch.setattr(admin_families_picker, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_families_picker,
        "extract_identity",
        lambda _event: _admin_identity(),
    )
    return session


def _make_execute_result(rows: list[tuple[Any, ...]]) -> MagicMock:
    m = MagicMock()
    m.all.return_value = rows
    return m


def test_picker_label_includes_primary_contact_name(
    api_gateway_event: Any,
    picker_session: MagicMock,
) -> None:
    fam_id = uuid4()
    picker_session.execute.side_effect = [
        _make_execute_result([(fam_id, "Smith Family")]),
        _make_execute_result([(fam_id, "Jane", "Primary")]),
    ]

    path = "/v1/admin/families/picker"
    response = admin_families_picker.handle_admin_families_picker_request(
        api_gateway_event(method="GET", path=path),
        "GET",
        path,
    )

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["items"] == [
        {"id": str(fam_id), "label": "Smith Family \u00b7 Jane Primary"}
    ]
