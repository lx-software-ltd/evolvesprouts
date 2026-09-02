from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from app.api import admin_tags
from app.db.repositories.tag import TagRepository
from app.exceptions import ValidationError


def test_handle_admin_tags_list_get(monkeypatch: Any, api_gateway_event: Any) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(admin_tags, "_list_tags", lambda _: marker)
    monkeypatch.setattr(
        admin_tags,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_tags.handle_admin_tags_request(
        api_gateway_event(method="GET", path="/v1/admin/tags"),
        "GET",
        "/v1/admin/tags",
    )
    assert response is marker


def test_handle_admin_tags_post(monkeypatch: Any, api_gateway_event: Any) -> None:
    marker = {"statusCode": 201, "body": "{}"}
    monkeypatch.setattr(admin_tags, "_create_tag", lambda _event, *, actor_sub: marker)
    monkeypatch.setattr(
        admin_tags,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_tags.handle_admin_tags_request(
        api_gateway_event(method="POST", path="/v1/admin/tags", body="{}"),
        "POST",
        "/v1/admin/tags",
    )
    assert response is marker


def test_parse_include_archived_invalid() -> None:
    event = {
        "queryStringParameters": {"include_archived": "maybe"},
        "multiValueQueryStringParameters": None,
    }
    with pytest.raises(ValidationError, match="include_archived"):
        admin_tags._parse_include_archived(event)


def test_parse_optional_hex_color_rejects_bad() -> None:
    with pytest.raises(ValidationError):
        admin_tags._parse_optional_hex_color("red", field="color")


def test_serialize_admin_tag_includes_usage(monkeypatch: Any) -> None:
    tag_id = uuid4()
    tag = SimpleNamespace(
        id=tag_id,
        name="Alpha",
        color="#aabbcc",
        description="d",
        archived_at=None,
    )
    session = object()
    monkeypatch.setattr(TagRepository, "usage_count", lambda _self, _tid: 3)

    payload = admin_tags._serialize_admin_tag(session, tag)
    assert payload["id"] == str(tag_id)
    assert payload["name"] == "Alpha"
    assert payload["color"] == "#aabbcc"
    assert payload["description"] == "d"
    assert payload["archived_at"] is None
    assert payload["usage_count"] == 3
    assert payload["is_system"] is False


def test_serialize_admin_tag_marks_system_names() -> None:
    tag_id = uuid4()
    tag = SimpleNamespace(
        id=tag_id,
        name="expense_attachment",
        color=None,
        description=None,
        archived_at=None,
    )
    session = object()
    payload = admin_tags._serialize_admin_tag(session, tag, usage_by_id={tag_id: 1})
    assert payload["is_system"] is True
    assert payload["usage_count"] == 1


def test_parse_archived_only_invalid() -> None:
    event = {
        "queryStringParameters": {"archived_only": "maybe"},
        "multiValueQueryStringParameters": None,
    }
    with pytest.raises(ValidationError, match="archived_only"):
        admin_tags._parse_archived_only(event)


def test_list_tags_rejects_conflicting_query_params(
    monkeypatch: Any, api_gateway_event: Any
) -> None:
    monkeypatch.setattr(
        admin_tags,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )
    event = api_gateway_event(
        method="GET",
        path="/v1/admin/tags",
        query_params={"include_archived": "true", "archived_only": "true"},
    )
    with pytest.raises(ValidationError, match="archived_only"):
        admin_tags.handle_admin_tags_request(event, "GET", "/v1/admin/tags")


@pytest.mark.parametrize(
    "name",
    ["expense_attachment", "client_document", "customer_invoice"],
)
def test_create_tag_rejects_reserved_system_name(
    monkeypatch: Any, api_gateway_event: Any, name: str
) -> None:
    monkeypatch.setattr(
        admin_tags,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )
    event = api_gateway_event(
        method="POST",
        path="/v1/admin/tags",
        body=json.dumps({"name": name}),
    )
    with pytest.raises(ValidationError, match="reserved"):
        admin_tags.handle_admin_tags_request(event, "POST", "/v1/admin/tags")


def test_delete_tag_rejects_system_tag(
    monkeypatch: Any, api_gateway_event: Any
) -> None:
    tag_id = str(uuid4())
    monkeypatch.setattr(
        admin_tags,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    class _SessionCtx:
        def __init__(self, _engine: object) -> None:
            self._inner = _Inner()

        def __enter__(self) -> "_Inner":
            return self._inner

        def __exit__(self, *_a: object) -> bool:
            return False

    class _Inner:
        def get(self, _model: type, pk: object) -> object:
            return SimpleNamespace(
                id=pk,
                name="client_document",
                archived_at=None,
            )

        def commit(self) -> None:
            return None

    monkeypatch.setattr(admin_tags, "Session", _SessionCtx)
    monkeypatch.setattr(admin_tags, "get_engine", lambda: object())
    monkeypatch.setattr(admin_tags, "set_audit_context", lambda *_a, **_k: None)

    with pytest.raises(ValidationError, match="System-managed"):
        admin_tags.handle_admin_tags_request(
            api_gateway_event(method="DELETE", path=f"/v1/admin/tags/{tag_id}"),
            "DELETE",
            f"/v1/admin/tags/{tag_id}",
        )
