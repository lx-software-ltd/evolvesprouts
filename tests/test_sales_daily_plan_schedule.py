"""Unit tests for scheduled sales daily plan enqueue."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.audit import SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID
from app.db.models.sales_daily_plan_job import SalesDailyPlanJobStatus
from app.services import sales_daily_plan_schedule as schedule_mod
from app.services.sales_daily_plan_schedule import enqueue_scheduled_sales_daily_plan


def _load_scheduler_handler() -> object:
    module_path = (
        Path(__file__).resolve().parents[1]
        / "backend"
        / "lambda"
        / "sales_daily_plan_scheduler"
        / "handler.py"
    )
    spec = importlib.util.spec_from_file_location(
        "test_sales_daily_plan_scheduler_handler", module_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module at {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Session:
    def __init__(self, *_a: object, **_k: object) -> None:
        return None

    def __enter__(self) -> _Session:
        return self

    def __exit__(self, *_a: object) -> None:
        return None


def test_enqueue_scheduled_skips_when_job_in_flight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    in_flight = SimpleNamespace(
        id=uuid4(),
        status=SalesDailyPlanJobStatus.PROCESSING,
    )
    queued: list[object] = []

    class _Repo:
        def __init__(self, _session: object) -> None:
            pass

        def find_in_flight(self) -> object:
            return in_flight

    monkeypatch.setattr(schedule_mod, "Session", _Session)
    monkeypatch.setattr(schedule_mod, "get_engine", lambda: object())
    monkeypatch.setattr(schedule_mod, "SalesDailyPlanJobRepository", _Repo)
    monkeypatch.setattr(
        schedule_mod,
        "queue_sales_daily_plan_job",
        lambda **_k: queued.append(1),
    )

    assert (
        enqueue_scheduled_sales_daily_plan(request_id="sales-daily-plan-schedule:1")
        is None
    )
    assert queued == []


def test_enqueue_scheduled_creates_system_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job_id = uuid4()
    captured: dict[str, object] = {}

    class _Repo:
        def __init__(self, _session: object) -> None:
            pass

        def find_in_flight(self) -> None:
            return None

    monkeypatch.setattr(schedule_mod, "Session", _Session)
    monkeypatch.setattr(schedule_mod, "get_engine", lambda: object())
    monkeypatch.setattr(schedule_mod, "SalesDailyPlanJobRepository", _Repo)

    def _queue(**kwargs: object) -> SimpleNamespace:
        captured.update(kwargs)
        return SimpleNamespace(id=job_id)

    monkeypatch.setattr(schedule_mod, "queue_sales_daily_plan_job", _queue)

    result = enqueue_scheduled_sales_daily_plan(
        request_id="sales-daily-plan-schedule:abc"
    )
    assert result == job_id
    assert captured["created_by"] == SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID
    assert captured["request_id"] == "sales-daily-plan-schedule:abc"
    assert "operator_input" not in captured


def test_scheduler_lambda_handler_returns_skipped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = _load_scheduler_handler()
    monkeypatch.setattr(
        handler, "enqueue_scheduled_sales_daily_plan", lambda **_k: None
    )
    result = handler.lambda_handler({}, SimpleNamespace(aws_request_id="req-skip"))
    assert result == {"statusCode": 200, "skipped": True}


def test_scheduler_lambda_handler_returns_job_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = _load_scheduler_handler()
    job_id = uuid4()
    seen: dict[str, str] = {}

    def _enqueue(*, request_id: str) -> object:
        seen["request_id"] = request_id
        return job_id

    monkeypatch.setattr(handler, "enqueue_scheduled_sales_daily_plan", _enqueue)
    result = handler.lambda_handler({}, SimpleNamespace(aws_request_id="req-run"))
    assert result == {"statusCode": 202, "skipped": False, "job_id": str(job_id)}
    assert seen["request_id"] == "sales-daily-plan-schedule:req-run"
