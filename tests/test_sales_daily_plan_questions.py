"""Tests for insight-board follow-up questions."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from app.exceptions import AppError
from app.services.sales_daily_plan_questions import (
    MAX_QUESTIONS_RETURNED,
    answer_follow_up_question,
    list_questions_for_plan,
    serialize_question,
    serialize_questions_for_plan,
)


def test_serialize_questions_for_plan_skips_simple_session() -> None:
    assert serialize_questions_for_plan(SimpleNamespace(), uuid4()) == []


def test_list_questions_returns_newest_cap_in_chronological_order() -> None:
    plan_id = uuid4()
    rows = [
        SimpleNamespace(id=uuid4(), asked_at=datetime(2026, 9, 1, 12, i, tzinfo=UTC))
        for i in range(MAX_QUESTIONS_RETURNED)
    ]
    session = MagicMock(spec=Session)
    session.scalars.return_value.all.return_value = list(reversed(rows))
    listed = list_questions_for_plan(session, plan_id)
    assert listed == rows
    statement = session.scalars.call_args[0][0]
    compiled = str(statement.compile(compile_kwargs={"literal_binds": False}))
    assert "sales_daily_plan_questions" in compiled


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
            "assert_timeout": kwargs["timeout"] == 15,
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
    with pytest.raises(AppError, match="empty answer") as exc_info:
        answer_follow_up_question(
            session,  # type: ignore[arg-type]
            plan=SimpleNamespace(id=uuid4(), payload={}),  # type: ignore[arg-type]
            question="Why?",
            asked_by="user-1",
        )
    assert exc_info.value.status_code == 502


def test_answer_follow_up_question_maps_timeout(monkeypatch: object) -> None:
    session = SimpleNamespace(add=lambda _row: None, flush=lambda: None)
    monkeypatch.setattr(
        "app.services.sales_daily_plan_questions.openrouter_chat_completion",
        lambda **_kwargs: (_ for _ in ()).throw(TimeoutError("timed out")),
    )
    with pytest.raises(AppError, match="too long") as exc_info:
        answer_follow_up_question(
            session,  # type: ignore[arg-type]
            plan=SimpleNamespace(id=uuid4(), payload={}),  # type: ignore[arg-type]
            question="Why?",
            asked_by="user-1",
        )
    assert exc_info.value.status_code == 504
