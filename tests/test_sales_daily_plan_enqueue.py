"""Unit tests for sales daily plan job enqueue helper."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.models.sales_daily_plan_job import SalesDailyPlanJobStatus
from app.exceptions import NotFoundError, ValidationError
from app.services import sales_daily_plan_enqueue as enqueue_mod


class _Session:
    def __init__(self, *_a: object, **_k: object) -> None:
        self.added: list[object] = []
        self.committed = 0
        self.deleted: list[object] = []

    def __enter__(self) -> _Session:
        return self

    def __exit__(self, *_a: object) -> None:
        return None

    def add(self, obj: object) -> None:
        if getattr(obj, "id", None) is None:
            obj.id = uuid4()  # type: ignore[attr-defined]
        self.added.append(obj)

    def flush(self) -> None:
        return None

    def commit(self) -> None:
        self.committed += 1

    def get(self, _model: object, _job_id: object) -> object | None:
        return self.added[0] if self.added else None

    def delete(self, obj: object) -> None:
        self.deleted.append(obj)


def test_queue_sales_daily_plan_job_enqueues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _Session()
    persisted = SimpleNamespace(id=uuid4(), status=SalesDailyPlanJobStatus.PENDING)
    queued: list[object] = []

    monkeypatch.setattr(enqueue_mod, "Session", lambda *_a, **_k: session)
    monkeypatch.setattr(enqueue_mod, "get_engine", lambda: object())
    monkeypatch.setattr(enqueue_mod, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(
        enqueue_mod,
        "enqueue_sales_daily_plan_job",
        lambda job_id: queued.append(job_id),
    )

    class _Repo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id(self, _job_id: object) -> object:
            return persisted

    monkeypatch.setattr(enqueue_mod, "SalesDailyPlanJobRepository", _Repo)

    job = enqueue_mod.queue_sales_daily_plan_job(
        created_by="admin-1",
        request_id="req-1",
        operator_input="Focus on consults",
    )
    assert job is persisted
    assert queued
    assert session.committed >= 1
    created = session.added[0]
    assert created.created_by == "admin-1"  # type: ignore[attr-defined]
    assert created.operator_input == "Focus on consults"  # type: ignore[attr-defined]
    assert created.status == SalesDailyPlanJobStatus.PENDING  # type: ignore[attr-defined]


def test_queue_sales_daily_plan_job_deletes_row_when_queue_misconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _Session()
    monkeypatch.setattr(enqueue_mod, "Session", lambda *_a, **_k: session)
    monkeypatch.setattr(enqueue_mod, "get_engine", lambda: object())
    monkeypatch.setattr(enqueue_mod, "set_audit_context", lambda *_a, **_k: None)

    def _raise(_job_id: object) -> None:
        raise ValidationError(
            "Sales daily plan queue is not configured", field="configuration"
        )

    monkeypatch.setattr(enqueue_mod, "enqueue_sales_daily_plan_job", _raise)

    with pytest.raises(ValidationError, match="not configured"):
        enqueue_mod.queue_sales_daily_plan_job(created_by="admin-1", request_id="req-1")
    assert session.deleted


def test_queue_sales_daily_plan_job_marks_failed_on_unexpected_enqueue_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _Session()
    failed_job = SimpleNamespace(id=uuid4())
    marked: list[str] = []

    class _Repo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id(self, _job_id: object) -> object:
            return failed_job

        def mark_failed(self, _job: object, message: str) -> None:
            marked.append(message)

    monkeypatch.setattr(enqueue_mod, "Session", lambda *_a, **_k: session)
    monkeypatch.setattr(enqueue_mod, "get_engine", lambda: object())
    monkeypatch.setattr(enqueue_mod, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(
        enqueue_mod,
        "enqueue_sales_daily_plan_job",
        lambda _job_id: (_ for _ in ()).throw(RuntimeError("sqs down")),
    )
    monkeypatch.setattr(enqueue_mod, "SalesDailyPlanJobRepository", _Repo)

    with pytest.raises(ValidationError, match="could not be queued"):
        enqueue_mod.queue_sales_daily_plan_job(created_by="admin-1", request_id="req-1")
    assert marked


def test_queue_sales_daily_plan_job_raises_when_row_disappears(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _Session()

    class _Repo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id(self, _job_id: object) -> None:
            return None

    monkeypatch.setattr(enqueue_mod, "Session", lambda *_a, **_k: session)
    monkeypatch.setattr(enqueue_mod, "get_engine", lambda: object())
    monkeypatch.setattr(enqueue_mod, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(
        enqueue_mod, "enqueue_sales_daily_plan_job", lambda _job_id: None
    )
    monkeypatch.setattr(enqueue_mod, "SalesDailyPlanJobRepository", _Repo)

    with pytest.raises(NotFoundError):
        enqueue_mod.queue_sales_daily_plan_job(created_by="admin-1", request_id="req-1")
