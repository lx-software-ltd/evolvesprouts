"""Tests for insight-board item annotations."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

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


def test_upsert_annotation_uses_on_conflict() -> None:
    plan_id = uuid4()
    row = SimpleNamespace(feedback="up", updated_by="user-1")
    session = MagicMock(spec=Session)
    session.scalars.return_value.first.return_value = row
    created = upsert_annotation(
        session,
        plan_id=plan_id,
        item_kind="priority",
        item_key="Reply to Mei\n\n",
        updated_by="user-1",
        feedback="up",
    )
    assert created is row
    statement = session.scalars.call_args[0][0]
    compiled = str(statement.compile(dialect=postgresql.dialect())).upper()
    assert "ON CONFLICT" in compiled
    session.flush.assert_called_once()


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
