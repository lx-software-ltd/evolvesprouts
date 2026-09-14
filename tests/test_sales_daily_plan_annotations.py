"""Tests for insight-board item annotations."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.sales_daily_plan_annotations import (
    apply_annotations_to_items,
    resolve_snoozed_until,
    serialize_annotation,
    upsert_annotation,
)
from app.services.sales_daily_plan_payload import outreach_item_key


def test_resolve_snoozed_until_maps_tokens() -> None:
    now = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    assert resolve_snoozed_until(None, now=now) is ...
    assert resolve_snoozed_until("clear", now=now) is None
    assert resolve_snoozed_until("tomorrow", now=now) == now + timedelta(days=1)
    assert resolve_snoozed_until("next_week", now=now) == now + timedelta(days=7)
    with pytest.raises(ValueError):
        resolve_snoozed_until("friday", now=now)


def test_apply_annotations_sets_keys_without_session_query() -> None:
    priorities = [
        {
            "title": "Reply to Mei",
            "lead_id": "lead-1",
            "invoice_id": None,
        }
    ]
    outreach = [
        {
            "channel": "whatsapp",
            "lead_id": None,
            "conversation_id": None,
            "message_excerpt": "Hi",
            "draft_reply": "Hello",
        }
    ]
    apply_annotations_to_items(
        SimpleNamespace(),
        plan_id=uuid4(),
        priorities=priorities,
        outreach=outreach,
    )
    assert priorities[0]["item_key"] == "Reply to Mei\nlead-1\n"
    assert outreach[0]["item_key"] == outreach_item_key("whatsapp", None, None, "Hi")
    assert outreach[0]["saved_draft_reply"] is None


def test_upsert_annotation_creates_then_updates_feedback() -> None:
    plan_id = uuid4()
    added: list[object] = []

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

    session = _Session()
    created = upsert_annotation(
        session,  # type: ignore[arg-type]
        plan_id=plan_id,
        item_kind="priority",
        item_key="Reply to Mei\n\n",
        updated_by="user-1",
        feedback="up",
    )
    assert created.feedback == "up"
    assert len(added) == 1
    updated = upsert_annotation(
        session,  # type: ignore[arg-type]
        plan_id=plan_id,
        item_kind="priority",
        item_key="Reply to Mei\n\n",
        updated_by="user-2",
        feedback="down",
    )
    assert updated.feedback == "down"
    assert updated.updated_by == "user-2"
    assert len(added) == 1


def test_serialize_annotation_includes_feedback() -> None:
    now = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    payload = serialize_annotation(
        SimpleNamespace(
            item_kind="outreach",
            item_key="whatsapp\n\n\nHi",
            feedback="not_relevant",
            snoozed_until=now,
            draft_reply="Edited",
            updated_by="user-1",
            updated_at=now,
        )  # type: ignore[arg-type]
    )
    assert payload["feedback"] == "not_relevant"
    assert payload["draft_reply"] == "Edited"
    assert payload["snoozed_until"] == "2026-09-01T10:00:00+00:00"
