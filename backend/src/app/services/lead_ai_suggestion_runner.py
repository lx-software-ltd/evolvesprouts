"""Execute lead AI suggestion jobs (SQS worker).

Time budget: the worker Lambda timeout is configured in CDK (typically **120s**)
via ``LEAD_AI_SUGGESTION_LAMBDA_TIMEOUT_SECONDS``. OpenRouter completion is capped
below that so status updates finish before the Lambda hard timeout.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.sales_lead_ai_suggestion_job import SalesLeadAiSuggestionJobStatus
from app.db.repositories.sales_lead import SalesLeadRepository
from app.db.repositories.sales_lead_ai_suggestion_job import (
    SalesLeadAiSuggestionJobRepository,
)
from app.services.lead_close_suggestion import generate_and_store_suggestion
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _lambda_timeout_seconds() -> int:
    raw = os.environ.get("LEAD_AI_SUGGESTION_LAMBDA_TIMEOUT_SECONDS", "120").strip()
    try:
        return max(30, int(raw))
    except ValueError:
        return 120


def _processing_stale_threshold() -> timedelta:
    """Treat PROCESSING rows older than this as abandoned (worker died)."""
    return timedelta(seconds=_lambda_timeout_seconds() * 2 + 60)


@dataclass(frozen=True)
class LeadAiSuggestionWorkerOutcome:
    """Whether the SQS message should be deleted (``True``) or retried (``False``)."""

    ack_sqs_message: bool


def process_lead_ai_suggestion_job(job_id: UUID) -> LeadAiSuggestionWorkerOutcome:
    """Load job, generate suggestion via OpenRouter, update job status and timing."""
    req_id = f"lead-ai-suggestion-job:{job_id}"
    stale_after = _processing_stale_threshold()

    with Session(get_engine()) as session:
        job_repo = SalesLeadAiSuggestionJobRepository(session)
        job = job_repo.get_by_id(job_id)
        if job is None:
            logger.warning(
                "Lead AI suggestion job not found", extra={"job_id": str(job_id)}
            )
            return LeadAiSuggestionWorkerOutcome(ack_sqs_message=True)
        if job.status == SalesLeadAiSuggestionJobStatus.SUCCEEDED:
            logger.info(
                "Lead AI suggestion job already succeeded; skipping",
                extra={"job_id": str(job_id)},
            )
            return LeadAiSuggestionWorkerOutcome(ack_sqs_message=True)
        if job.status == SalesLeadAiSuggestionJobStatus.FAILED:
            logger.info(
                "Lead AI suggestion job already failed; skipping",
                extra={"job_id": str(job_id)},
            )
            return LeadAiSuggestionWorkerOutcome(ack_sqs_message=True)

        if job.status == SalesLeadAiSuggestionJobStatus.PROCESSING:
            now = datetime.now(UTC)
            updated = job.updated_at
            if updated is not None and (now - updated) < stale_after:
                logger.info(
                    "Lead AI suggestion job still processing; deferring SQS message",
                    extra={"job_id": str(job_id)},
                )
                return LeadAiSuggestionWorkerOutcome(ack_sqs_message=False)
            set_audit_context(session, user_id=job.created_by, request_id=req_id)
            job_repo.mark_failed(
                job,
                "Worker did not finish the previous attempt; please generate again.",
            )
            session.commit()
            return LeadAiSuggestionWorkerOutcome(ack_sqs_message=True)

        if job.status != SalesLeadAiSuggestionJobStatus.PENDING:
            logger.warning(
                "Lead AI suggestion job in unexpected state",
                extra={"job_id": str(job_id), "status": job.status.value},
            )
            return LeadAiSuggestionWorkerOutcome(ack_sqs_message=True)

        actor_sub = job.created_by
        lead_id = job.lead_id
        set_audit_context(session, user_id=actor_sub, request_id=req_id)
        job_repo.mark_processing(job)
        session.commit()

    try:
        with Session(get_engine()) as session:
            set_audit_context(session, user_id=actor_sub, request_id=req_id)
            lead_repo = SalesLeadRepository(session)
            lead = lead_repo.get_by_id_with_details(lead_id)
            if lead is None:
                raise RuntimeError(f"Sales lead {lead_id} was not found")
            suggestion = generate_and_store_suggestion(
                session,
                lead=lead,
                actor_sub=actor_sub,
            )
            session.flush()
            job_repo = SalesLeadAiSuggestionJobRepository(session)
            job = job_repo.get_by_id(job_id)
            if job is None:
                raise RuntimeError(f"Job {job_id} disappeared during processing")
            job_repo.mark_succeeded(job, suggestion_id=suggestion.id)
            session.commit()
    except Exception as exc:
        logger.exception(
            "Lead AI suggestion job failed",
            extra={"job_id": str(job_id)},
        )
        _fail_job(job_id, str(exc) or type(exc).__name__)
        return LeadAiSuggestionWorkerOutcome(ack_sqs_message=True)

    return LeadAiSuggestionWorkerOutcome(ack_sqs_message=True)


def _fail_job(job_id: UUID, message: str) -> None:
    with Session(get_engine()) as session:
        job_repo = SalesLeadAiSuggestionJobRepository(session)
        job = job_repo.get_by_id(job_id)
        if job is None:
            return
        if job.status in (
            SalesLeadAiSuggestionJobStatus.SUCCEEDED,
            SalesLeadAiSuggestionJobStatus.FAILED,
        ):
            return
        set_audit_context(
            session,
            user_id=job.created_by,
            request_id=f"lead-ai-suggestion-job:{job_id}",
        )
        job_repo.mark_failed(job, message)
        session.commit()
