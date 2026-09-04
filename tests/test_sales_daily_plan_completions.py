"""Tests for insight priority completion helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from app.services.sales_daily_plan_completions import (
    priority_key,
    serialize_completion,
    upsert_completion,
)


def test_priority_key_is_stable_for_title_and_ids() -> None:
    lead_id = uuid4()
    invoice_id = uuid4()
    assert priority_key("  Reply to Mei  ", lead_id, invoice_id) == (
        f"Reply to Mei\n{lead_id}\n{invoice_id}"
    )
    assert priority_key("Chase invoice", None, None) == "Chase invoice\n\n"


def test_serialize_completion_includes_ids() -> None:
    lead_id = uuid4()
    row = SimpleNamespace(
        title="Reply to Mei",
        lead_id=lead_id,
        invoice_id=None,
        done_at=datetime(2026, 9, 3, 10, 0, tzinfo=UTC),
        done_by="user-1",
    )
    payload = serialize_completion(row)  # type: ignore[arg-type]
    assert payload == {
        "title": "Reply to Mei",
        "lead_id": str(lead_id),
        "invoice_id": None,
        "done_at": "2026-09-03T10:00:00+00:00",
        "done_by": "user-1",
    }


def test_upsert_completion_creates_then_removes() -> None:
    plan_id = uuid4()
    added: list[object] = []
    deleted: list[object] = []
    existing = SimpleNamespace()

    class _Result:
        def __init__(self, row: object | None) -> None:
            self._row = row

        def first(self) -> object | None:
            return self._row

    class _Session:
        def __init__(self) -> None:
            self._row: object | None = None

        def scalars(self, _statement: object) -> _Result:
            return _Result(self._row)

        def add(self, row: object) -> None:
            added.append(row)
            self._row = row

        def flush(self) -> None:
            return None

        def delete(self, row: object) -> None:
            deleted.append(row)
            self._row = None

    session = _Session()
    created = upsert_completion(
        session,  # type: ignore[arg-type]
        plan_id=plan_id,
        title="Reply to Mei",
        lead_id=None,
        invoice_id=None,
        done_by="user-1",
        done=True,
    )
    assert created is not None
    assert created.title == "Reply to Mei"
    assert created.plan_id == plan_id
    assert added == [created]

    session._row = existing
    removed = upsert_completion(
        session,  # type: ignore[arg-type]
        plan_id=plan_id,
        title="Reply to Mei",
        lead_id=None,
        invoice_id=None,
        done_by="user-1",
        done=False,
    )
    assert removed is None
    assert deleted == [existing]
