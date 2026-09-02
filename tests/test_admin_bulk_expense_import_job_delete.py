"""Tests for DELETE /v1/admin/expenses/bulk-import-jobs/{job_id}."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest

from app.api import admin_expenses
from app.exceptions import NotFoundError


def test_delete_bulk_import_job_removes_row_for_creator(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    job_id = uuid4()
    deleted: list[object] = []

    class _FakeJob:
        pass

    class _FakeBulkRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_for_actor(self, jid: UUID, *, actor_sub: str) -> _FakeJob | None:
            if jid == job_id and actor_sub == "admin-sub":
                return _FakeJob()
            return None

    class _FakeSession:
        def delete(self, obj: object) -> None:
            deleted.append(obj)

        def commit(self) -> None:
            return None

    class _FakeSessionCtx:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(admin_expenses, "BulkExpenseImportJobRepository", _FakeBulkRepo)
    monkeypatch.setattr(admin_expenses, "Session", lambda _engine: _FakeSessionCtx())
    monkeypatch.setattr(admin_expenses, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_expenses, "set_audit_context", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(admin_expenses, "request_id", lambda _e: "req-1")
    monkeypatch.setattr(
        admin_expenses,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    out = admin_expenses.handle_admin_expenses_request(
        api_gateway_event(
            method="DELETE",
            path=f"/v1/admin/expenses/bulk-import-jobs/{job_id}",
        ),
        "DELETE",
        f"/v1/admin/expenses/bulk-import-jobs/{job_id}",
    )

    assert out["statusCode"] == 204
    assert len(deleted) == 1
    assert isinstance(deleted[0], _FakeJob)


def test_delete_bulk_import_job_returns_404_when_missing(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    job_id = uuid4()

    class _FakeBulkRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_for_actor(self, jid: UUID, *, actor_sub: str) -> None:
            return None

    class _FakeSessionCtx:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(admin_expenses, "BulkExpenseImportJobRepository", _FakeBulkRepo)
    monkeypatch.setattr(admin_expenses, "Session", lambda _engine: _FakeSessionCtx())
    monkeypatch.setattr(admin_expenses, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_expenses, "set_audit_context", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(admin_expenses, "request_id", lambda _e: "req-1")
    monkeypatch.setattr(
        admin_expenses,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    with pytest.raises(NotFoundError):
        admin_expenses.handle_admin_expenses_request(
            api_gateway_event(
                method="DELETE",
                path=f"/v1/admin/expenses/bulk-import-jobs/{job_id}",
            ),
            "DELETE",
            f"/v1/admin/expenses/bulk-import-jobs/{job_id}",
        )
