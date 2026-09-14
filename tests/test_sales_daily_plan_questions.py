"""Tests for insight-board follow-up questions."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.sales_daily_plan_questions import (
    answer_follow_up_question,
    serialize_question,
    serialize_questions_for_plan,
)


def test_serialize_questions_for_plan_skips_simple_session() -> None:
    assert serialize_questions_for_plan(SimpleNamespace(), uuid4()) == []


def test_serialize_question_includes_text() -> None:
    asked_at = datetime(2026, 9, 1, 11, 0, tzinfo=UTC)
    payload = serialize_question(
        SimpleNamespace(
            id=uuid4(),
            question="Which invoice first?",
            answer="The oldest overdue one.",
            asked_by="user-1",
            asked_at=asked_at,
            model="test-model",
        )  # type: ignore[arg-type]
    )
    assert payload["question"] == "Which invoice first?"
    assert payload["answer"] == "The oldest overdue one."
    assert payload["model"] == "test-model"


def test_answer_follow_up_question_persists_model_text(monkeypatch: object) -> None:
    added: list[object] = []
    session = SimpleNamespace(add=added.append, flush=lambda: None)
    monkeypatch.setattr(
        "app.services.sales_daily_plan_questions.openrouter_chat_completion",
        lambda **kwargs: {
            "assert_timeout": kwargs["timeout"] == 20,
            "assert_sales": kwargs["use_sales_model"] is True,
        },
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan_questions.extract_message_text",
        lambda _body: "Start with INV-1001.",
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan_questions.configured_model_name",
        lambda: "sales-model",
    )
    plan = SimpleNamespace(id=uuid4(), payload={"focus": "Close consults"})
    row = answer_follow_up_question(
        session,  # type: ignore[arg-type]
        plan=plan,  # type: ignore[arg-type]
        question="Which invoice first?",
        asked_by="user-1",
    )
    assert row.answer == "Start with INV-1001."
    assert row.model == "sales-model"
    assert added[0] is row


def test_answer_follow_up_question_rejects_empty(monkeypatch: object) -> None:
    session = SimpleNamespace(add=lambda _row: None, flush=lambda: None)
    monkeypatch.setattr(
        "app.services.sales_daily_plan_questions.openrouter_chat_completion",
        lambda **_kwargs: {},
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan_questions.extract_message_text",
        lambda _body: "   ",
    )
    with pytest.raises(RuntimeError, match="empty answer"):
        answer_follow_up_question(
            session,  # type: ignore[arg-type]
            plan=SimpleNamespace(id=uuid4(), payload={}),  # type: ignore[arg-type]
            question="Why?",
            asked_by="user-1",
        )
