"""Tests for admin inbox import job routes."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.api import admin_meta as am
from app.api import admin_whatsapp as aw
from app.db.models.enums import MetaChannel
from app.db.models.inbox_import_job import InboxImportJobStatus, InboxImportKind
from app.exceptions import ValidationError


def _identity_event(
    api_gateway_event: Any, path: str, **kwargs: object
) -> dict[str, Any]:
    return api_gateway_event(
        method=kwargs.pop("method", "GET"),
        path=path,
        authorizer_context={"userSub": "admin-user"},
        **kwargs,
    )


def test_admin_meta_queues_graph_import(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job_id = uuid4()
    added: list[object] = []

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)
            setattr(obj, "id", job_id)

        def flush(self) -> None:
            return None

        def commit(self) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.admin_inbox_import.Session", lambda _e: _FakeSessionCM()
    )
    monkeypatch.setattr("app.api.admin_inbox_import.get_engine", lambda: object())
    monkeypatch.setattr(
        "app.api.admin_inbox_import.enqueue_inbox_import_job", lambda _jid: None
    )

    event = _identity_event(
        api_gateway_event,
        "/v1/admin/meta/import-jobs",
        method="POST",
        body={"channel": "instagram"},
    )
    response = am.handle_admin_meta_request(event, "POST", "/v1/admin/meta/import-jobs")
    assert response["statusCode"] == 202
    body = json.loads(response["body"])
    assert body["inbox_import_job"]["id"] == str(job_id)
    assert added
    assert getattr(added[0], "kind") is InboxImportKind.META_GRAPH
    assert getattr(added[0], "channel") is MetaChannel.INSTAGRAM


def test_admin_whatsapp_import_requires_asset(
    api_gateway_event: Any,
) -> None:
    event = _identity_event(
        api_gateway_event,
        "/v1/admin/whatsapp/import-jobs",
        method="POST",
        body={},
    )
    with pytest.raises(ValidationError):
        aw.handle_admin_whatsapp_request(
            event, "POST", "/v1/admin/whatsapp/import-jobs"
        )


def test_admin_meta_lists_import_jobs(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job_id = uuid4()
    row = SimpleNamespace(
        id=job_id,
        kind=InboxImportKind.META_GRAPH,
        channel=MetaChannel.FACEBOOK,
        attachment_asset_id=None,
        status=InboxImportJobStatus.SUCCEEDED,
        error_message=None,
        counters={"stored": 3, "duplicates": 1, "skipped": 0},
        created_at=datetime(2026, 8, 1, tzinfo=UTC),
        updated_at=datetime(2026, 8, 1, tzinfo=UTC),
    )

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def list_for_kind(self, **_k: object) -> list[object]:
            return [row]

        def count_for_kind(self, **_k: object) -> int:
            return 1

    class _FakeSessionCM:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.admin_inbox_import.InboxImportJobRepository", _FakeRepo
    )
    monkeypatch.setattr(
        "app.api.admin_inbox_import.Session", lambda _e: _FakeSessionCM()
    )
    monkeypatch.setattr("app.api.admin_inbox_import.get_engine", lambda: object())

    event = _identity_event(api_gateway_event, "/v1/admin/meta/import-jobs")
    response = am.handle_admin_meta_request(event, "GET", "/v1/admin/meta/import-jobs")
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["total_count"] == 1
    assert body["items"][0]["counters"]["stored"] == 3
