"""Unit tests for lead AI suggestion job serialization/timing."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from app.services.lead_ai_suggestion_serialize import serialize_lead_ai_suggestion_job


def test_serialize_lead_ai_suggestion_job_computes_timing() -> None:
    created = datetime(2026, 9, 1, 12, 0, 0, tzinfo=UTC)
    started = created + timedelta(seconds=2)
    finished = started + timedelta(seconds=7)
    job = SimpleNamespace(
        id=uuid4(),
        lead_id=uuid4(),
        status=SimpleNamespace(value="succeeded"),
        error_message=None,
        suggestion_id=uuid4(),
        created_at=created,
        started_at=started,
        finished_at=finished,
        updated_at=finished,
    )

    payload = serialize_lead_ai_suggestion_job(job, suggestion={"summary": "Go"})

    assert payload["status"] == "succeeded"
    assert payload["queue_wait_ms"] == 2000
    assert payload["duration_ms"] == 7000
    assert payload["suggestion"] == {"summary": "Go"}
