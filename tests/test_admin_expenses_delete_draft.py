"""Tests for DELETE /v1/admin/expenses/{id} (draft-only hard delete)."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from app.api import admin_expenses
from app.db.models.enums import ExpenseStatus


def test_delete_draft_expense_removes_row_and_syncs_tags(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    """Successful delete returns 204 and runs attachment tag sync."""
    expense_id = uuid4()
    asset_a = uuid4()
    sync_calls: list[set[UUID]] = []

    class _Att:
        def __init__(self, asset_id: UUID) -> None:
            self.asset_id = asset_id

    class _FakeExpense:
        def __init__(self) -> None:
            self.id = expense_id
            self.status = ExpenseStatus.DRAFT
            self.attachments = [_Att(asset_a)]

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_with_attachments(self, eid: UUID) -> _FakeExpense | None:
            if eid == expense_id:
                return _FakeExpense()
            return None

        def count_amendments_targeting(self, eid: UUID) -> int:
            assert eid == expense_id
            return 0

        def delete(self, _expense: _FakeExpense) -> None:
            return None

    class _FakeSession:
        def flush(self) -> None:
            return None

        def commit(self) -> None:
            return None

    class _FakeSessionCtx:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *args: object) -> None:
            return None

    def _sync(session: object, asset_ids: set[UUID]) -> None:
        sync_calls.append(asset_ids)

    monkeypatch.setattr(admin_expenses, "ExpenseRepository", _FakeRepo)
    monkeypatch.setattr(admin_expenses, "Session", lambda _engine: _FakeSessionCtx())
    monkeypatch.setattr(admin_expenses, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_expenses,
        "sync_expense_attachment_tags_for_assets",
        _sync,
    )
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
        api_gateway_event(method="DELETE", path=f"/v1/admin/expenses/{expense_id}"),
        "DELETE",
        f"/v1/admin/expenses/{expense_id}",
    )

    assert out["statusCode"] == 204
    assert sync_calls == [{asset_a}]


def test_delete_draft_expense_rejects_non_draft(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    expense_id = uuid4()

    class _FakeExpense:
        def __init__(self) -> None:
            self.id = expense_id
            self.status = ExpenseStatus.SUBMITTED
            self.attachments = []

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_with_attachments(self, eid: UUID) -> _FakeExpense | None:
            if eid == expense_id:
                return _FakeExpense()
            return None

    class _FakeSessionCtx:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(admin_expenses, "ExpenseRepository", _FakeRepo)
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

    from app.exceptions import ValidationError

    try:
        admin_expenses.handle_admin_expenses_request(
            api_gateway_event(method="DELETE", path=f"/v1/admin/expenses/{expense_id}"),
            "DELETE",
            f"/v1/admin/expenses/{expense_id}",
        )
    except ValidationError as exc:
        assert exc.field == "status"
    else:
        raise AssertionError("expected ValidationError")


def test_delete_draft_expense_rejects_when_amendments_exist(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    expense_id = uuid4()

    class _FakeExpense:
        def __init__(self) -> None:
            self.id = expense_id
            self.status = ExpenseStatus.DRAFT
            self.attachments = []

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_with_attachments(self, eid: UUID) -> _FakeExpense | None:
            if eid == expense_id:
                return _FakeExpense()
            return None

        def count_amendments_targeting(self, eid: UUID) -> int:
            assert eid == expense_id
            return 1

    class _FakeSessionCtx:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(admin_expenses, "ExpenseRepository", _FakeRepo)
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

    from app.exceptions import ValidationError

    try:
        admin_expenses.handle_admin_expenses_request(
            api_gateway_event(method="DELETE", path=f"/v1/admin/expenses/{expense_id}"),
            "DELETE",
            f"/v1/admin/expenses/{expense_id}",
        )
    except ValidationError as exc:
        assert exc.field == "amends_expense_id"
    else:
        raise AssertionError("expected ValidationError")
