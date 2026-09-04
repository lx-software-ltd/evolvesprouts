"""Tests for sales daily plan memory helpers and request parsing."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.admin_sales_daily_plan import parse_daily_plan_operator_input
from app.exceptions import ValidationError
from app.services.sales_daily_plan_memory import (
    MAX_OPERATOR_INPUT_LENGTH,
    load_prior_plans_for_context,
    reset_sales_daily_plan_memory,
    serialize_memory_entry,
)


def test_serialize_memory_entry_uses_payload_focus() -> None:
    plan_id = uuid4()
    entry = serialize_memory_entry(
        SimpleNamespace(
            id=plan_id,
            generated_at=datetime(2026, 9, 1, 10, 0, tzinfo=UTC),
            payload={
                "focus": "Close consults",
                "product_focus": "Family Consultations",
            },
            operator_input="Focus on MBA",
        )
    )
    assert entry["id"] == str(plan_id)
    assert entry["focus"] == "Close consults"
    assert entry["product_focus"] == "Family Consultations"
    assert entry["operator_input"] == "Focus on MBA"


def test_load_prior_plans_for_context_is_oldest_first(monkeypatch: object) -> None:
    older = SimpleNamespace(
        generated_at=datetime(2026, 8, 31, 10, 0, tzinfo=UTC),
        operator_input="First note",
        payload={"focus": "Older"},
    )
    newer = SimpleNamespace(
        generated_at=datetime(2026, 9, 1, 10, 0, tzinfo=UTC),
        operator_input="Second note",
        payload={"focus": "Newer"},
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan_memory.list_recent_plans",
        lambda _session, limit=5: [newer, older],
    )
    memory = load_prior_plans_for_context(SimpleNamespace())
    assert [item["plan"]["focus"] for item in memory] == ["Older", "Newer"]
    assert [item["operator_input"] for item in memory] == ["First note", "Second note"]


def test_reset_sales_daily_plan_memory_deletes_jobs_then_plans() -> None:
    executed: list[object] = []
    session = SimpleNamespace(execute=lambda statement: executed.append(statement))
    reset_sales_daily_plan_memory(session)
    assert len(executed) == 3


def test_parse_daily_plan_operator_input_allows_empty_body() -> None:
    assert parse_daily_plan_operator_input({"body": ""}) is None
    assert parse_daily_plan_operator_input({"body": "{}"}) is None
    assert (
        parse_daily_plan_operator_input({"body": '{"operator_input": "  Focus  "}'})
        == "Focus"
    )


def test_parse_daily_plan_operator_input_rejects_overlong() -> None:
    body = '{"operator_input": "' + ("x" * (MAX_OPERATOR_INPUT_LENGTH + 1)) + '"}'
    with pytest.raises(ValidationError, match="at most"):
        parse_daily_plan_operator_input({"body": body})
