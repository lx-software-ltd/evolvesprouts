"""Unit tests for sales daily plan job serialization/timing."""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from app.db.models.sales_daily_plan_job import SalesDailyPlanJobStatus
from app.services.sales_daily_plan_serialize import serialize_sales_daily_plan_job


def test_serialize_sales_daily_plan_job_computes_timing() -> None:
    created = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    started = datetime(2026, 9, 1, 10, 0, 2, tzinfo=UTC)
    finished = datetime(2026, 9, 1, 10, 0, 9, tzinfo=UTC)
    job = SimpleNamespace(
        id=uuid4(),
        status=SalesDailyPlanJobStatus.SUCCEEDED,
        error_message=None,
        plan_id=uuid4(),
        created_at=created,
        started_at=started,
        finished_at=finished,
        updated_at=finished,
    )
    payload = serialize_sales_daily_plan_job(job, plan={"focus": "Close consults"})
    assert payload["queue_wait_ms"] == 2000
    assert payload["duration_ms"] == 7000
    assert payload["plan"]["focus"] == "Close consults"
    assert payload["status"] == "succeeded"
