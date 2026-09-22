"""Instruction persistence and the admin handlers that store them."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.exceptions import ValidationError
from app.services.sales_daily_plan_instructions import create_instruction
from app.services.sales_daily_plan_time import next_business_day_start


def test_create_instruction_dedupes_same_scope_and_sets_horizon() -> None:
    from app.db.models.sales_daily_plan_instruction import SalesDailyPlanInstruction

    stored: list[SalesDailyPlanInstruction] = []

    class _Result:
        def all(self) -> list[SalesDailyPlanInstruction]:
            return list(stored)

    class _Session:
        def scalars(self, _statement: object) -> _Result:
            return _Result()

        def add(self, row: SalesDailyPlanInstruction) -> None:
            stored.append(row)

        def flush(self) -> None:
            return None

    session = _Session()
    now = datetime(2026, 9, 3, 10, 0, tzinfo=UTC)
    first = create_instruction(
        session,  # type: ignore[arg-type]
        text="  Call the venue  ",
        scope="today",
        created_by="user-1",
        now=now,
    )
    assert first.instruction_text == "Call the venue"
    assert first.active_until == next_business_day_start(now)
    again = create_instruction(
        session,  # type: ignore[arg-type]
        text="Call the venue!",
        scope="today",
        created_by="user-2",
        now=now,
    )
    assert again is first
    standing = create_instruction(
        session,  # type: ignore[arg-type]
        text="Call the venue",
        scope="standing",
        created_by="user-1",
        now=now,
    )
    assert standing is not first
    assert standing.active_until is None
    assert len(stored) == 2


def test_completion_uses_client_item_key_and_rejects_oversized_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import admin_sales_daily_plan as api

    captured: dict[str, Any] = {}
    plan_id = uuid4()

    class _Session:
        def __init__(self, _engine: object) -> None:
            return None

        def __enter__(self) -> _Session:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def commit(self) -> None:
            return None

    monkeypatch.setattr(api, "get_engine", lambda: object())
    monkeypatch.setattr(api, "Session", _Session)
    monkeypatch.setattr(api, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(
        api, "get_latest_plan", lambda _session: SimpleNamespace(id=plan_id)
    )
    monkeypatch.setattr(api, "serialize_plan", lambda *_a, **_k: {"id": str(plan_id)})

    def _set_done(_session: object, **kwargs: Any) -> None:
        captured.update(kwargs)
        return None

    monkeypatch.setattr(api, "set_item_done", _set_done)
    lead_id = str(uuid4())
    item_key = f"lead:{lead_id}:reply"
    response = api.upsert_sales_daily_plan_priority_completion(
        {"body": json.dumps({"title": "Reply", "done": True, "item_key": item_key})},
        actor_sub="user-1",
    )
    assert response["statusCode"] == 200
    assert captured["identity"] == item_key

    with pytest.raises(ValidationError, match="item_key"):
        api.upsert_sales_daily_plan_priority_completion(
            {
                "body": json.dumps(
                    {"title": "Reply", "done": True, "item_key": "x" * 1025}
                )
            },
            actor_sub="user-1",
        )


def test_failed_enqueue_discards_only_a_new_instruction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import admin_sales_daily_plan as api

    instruction_id = uuid4()
    discarded: list[object] = []
    created_at = datetime(2026, 9, 3, 10, 0, tzinfo=UTC)

    class _Session:
        def __init__(self, _engine: object) -> None:
            return None

        def __enter__(self) -> _Session:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def commit(self) -> None:
            return None

    def _create(_session: object, **kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(
            id=instruction_id,
            created_at=kwargs["now"],
        )

    monkeypatch.setattr(api, "get_engine", lambda: object())
    monkeypatch.setattr(api, "Session", _Session)
    monkeypatch.setattr(api, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(api, "create_instruction", _create)
    monkeypatch.setattr(
        api,
        "delete_instruction",
        lambda _session, **kwargs: discarded.append(kwargs["instruction_id"]),
    )

    def _boom(**_kwargs: Any) -> None:
        raise ValidationError("not queued", field="configuration")

    monkeypatch.setattr(api, "queue_sales_daily_plan_job", _boom)
    event = {"body": json.dumps({"operator_input": "Call the venue"})}
    with pytest.raises(ValidationError, match="not queued"):
        api.create_sales_daily_plan(event, actor_sub="user-1")
    assert discarded == [instruction_id]
    assert created_at.tzinfo is UTC

    discarded.clear()

    def _reuse(_session: object, **_kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(
            id=instruction_id,
            created_at=datetime(2026, 9, 1, tzinfo=UTC),
        )

    monkeypatch.setattr(api, "create_instruction", _reuse)
    with pytest.raises(ValidationError, match="not queued"):
        api.create_sales_daily_plan(event, actor_sub="user-1")
    assert discarded == []


def test_instruction_routes_list_create_and_archive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import admin_sales_daily_plan_instructions as api

    listed = {"instructions": [{"id": "1", "text": "Call", "scope": "today"}]}
    created = {"instruction": listed["instructions"][0]}
    archived = {"instruction": listed["instructions"][0], "plan": None}
    monkeypatch.setattr(
        api, "list_active_instructions", lambda _session: [SimpleNamespace()]
    )
    monkeypatch.setattr(
        api, "serialize_instruction", lambda _row: listed["instructions"][0]
    )

    class _Session:
        def __init__(self, _engine: object) -> None:
            return None

        def __enter__(self) -> _Session:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def commit(self) -> None:
            return None

    monkeypatch.setattr(api, "get_engine", lambda: object())
    monkeypatch.setattr(api, "Session", _Session)
    listed_response = api.list_sales_daily_plan_instructions({})
    assert json.loads(listed_response["body"]) == listed

    monkeypatch.setattr(api, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(
        api,
        "create_instruction",
        lambda _session, **_kwargs: SimpleNamespace(),
    )
    created_response = api.create_sales_daily_plan_instruction_http(
        {"body": json.dumps({"text": "Call the venue", "scope": "standing"})},
        actor_sub="user-1",
    )
    assert json.loads(created_response["body"]) == created

    monkeypatch.setattr(
        api,
        "archive_instruction",
        lambda _session, **_kwargs: SimpleNamespace(),
    )
    monkeypatch.setattr(api, "get_latest_plan", lambda _session: None)
    archived_response = api.archive_sales_daily_plan_instruction_http(
        {},
        instruction_id=uuid4(),
        actor_sub="user-1",
    )
    assert json.loads(archived_response["body"]) == archived
