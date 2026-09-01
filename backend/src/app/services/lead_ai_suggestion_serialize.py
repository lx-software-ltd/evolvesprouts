"""Serialize lead AI suggestion jobs for the admin API."""

from __future__ import annotations

from typing import Any

from app.db.models.sales_lead_ai_suggestion_job import SalesLeadAiSuggestionJob


def serialize_lead_ai_suggestion_job(
    job: SalesLeadAiSuggestionJob,
    *,
    suggestion: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Serialize a job with queue/run timing for the admin poll API."""
    created = job.created_at
    started = job.started_at
    finished = job.finished_at
    queue_wait_ms = None
    duration_ms = None
    if created is not None and started is not None:
        queue_wait_ms = max(0, int((started - created).total_seconds() * 1000))
    if started is not None and finished is not None:
        duration_ms = max(0, int((finished - started).total_seconds() * 1000))
    return {
        "id": str(job.id),
        "lead_id": str(job.lead_id),
        "status": job.status.value,
        "error_message": job.error_message,
        "suggestion_id": str(job.suggestion_id) if job.suggestion_id else None,
        "created_at": created.isoformat() if created is not None else None,
        "started_at": started.isoformat() if started is not None else None,
        "finished_at": finished.isoformat() if finished is not None else None,
        "updated_at": job.updated_at.isoformat()
        if job.updated_at is not None
        else None,
        "queue_wait_ms": queue_wait_ms,
        "duration_ms": duration_ms,
        "suggestion": suggestion,
    }
