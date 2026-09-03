"""Execute sales daily plan jobs (SQS worker).

Time budget: the worker Lambda timeout is configured in CDK (typically **120s**)
via ``SALES_DAILY_PLAN_LAMBDA_TIMEOUT_SECONDS``. OpenRouter completion is capped
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
from app.db.models.sales_daily_plan_job import SalesDailyPlanJobStatus
from app.db.repositories.sales_daily_plan_job import SalesDailyPlanJobRepository
from app.services.sales_daily_plan import generate_and_store_plan
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _lambda_timeout_seconds() -> int:
    raw = os.environ.get("SALES_DAILY_PLAN_LAMBDA_TIMEOUT_SECONDS", "120").strip()
    try:
        return max(30, int(raw))
    except ValueError:
        return 120


def _processing_stale_threshold() -> timedelta:
    """Treat PROCESSING rows older than this as abandoned (worker died)."""
    return timedelta(seconds=_lambda_timeout_seconds() * 2 + 60)


@dataclass(frozen=True)
class SalesDailyPlanWorkerOutcome:
    """Whether the SQS message should be deleted (``True``) or retried (``False``)."""

    ack_sqs_message: bool


def process_sales_daily_plan_job(job_id: UUID) -> SalesDailyPlanWorkerOutcome:
    """Load job, generate the daily plan via OpenRouter, update job status."""
    req_id = f"sales-daily-plan-job:{job_id}"
    stale_after = _processing_stale_threshold()

    with Session(get_engine()) as session:
        job_repo = SalesDailyPlanJobRepository(session)
        job = job_repo.get_by_id(job_id)
        if job is None:
            logger.warning(
                "Sales daily plan job not found", extra={"job_id": str(job_id)}
            )
            return SalesDailyPlanWorkerOutcome(ack_sqs_message=True)
        if job.status == SalesDailyPlanJobStatus.SUCCEEDED:
            logger.info(
                "Sales daily plan job already succeeded; skipping",
                extra={"job_id": str(job_id)},
            )
            return SalesDailyPlanWorkerOutcome(ack_sqs_message=True)
        if job.status == SalesDailyPlanJobStatus.FAILED:
            logger.info(
                "Sales daily plan job already failed; skipping",
                extra={"job_id": str(job_id)},
            )
            return SalesDailyPlanWorkerOutcome(ack_sqs_message=True)

        if job.status == SalesDailyPlanJobStatus.PROCESSING:
            now = datetime.now(UTC)
            updated = job.updated_at
            if updated is not None and (now - updated) < stale_after:
                logger.info(
                    "Sales daily plan job still processing; deferring SQS message",
                    extra={"job_id": str(job_id)},
                )
                return SalesDailyPlanWorkerOutcome(ack_sqs_message=False)
            set_audit_context(session, user_id=job.created_by, request_id=req_id)
            job_repo.mark_failed(
                job,
                "Worker did not finish the previous attempt; please generate again.",
            )
            session.commit()
            return SalesDailyPlanWorkerOutcome(ack_sqs_message=True)

        if job.status != SalesDailyPlanJobStatus.PENDING:
            logger.warning(
                "Sales daily plan job in unexpected state",
                extra={"job_id": str(job_id), "status": job.status.value},
            )
            return SalesDailyPlanWorkerOutcome(ack_sqs_message=True)

        actor_sub = job.created_by
        set_audit_context(session, user_id=actor_sub, request_id=req_id)
        job_repo.mark_processing(job)
        session.commit()

    try:
        with Session(get_engine()) as session:
            set_audit_context(session, user_id=actor_sub, request_id=req_id)
            plan = generate_and_store_plan(session, actor_sub=actor_sub)
            session.flush()
            job_repo = SalesDailyPlanJobRepository(session)
            job = job_repo.get_by_id(job_id)
            if job is None:
                raise RuntimeError(f"Job {job_id} disappeared during processing")
            job_repo.mark_succeeded(job, plan_id=plan.id)
            session.commit()
    except Exception as exc:
        logger.exception(
            "Sales daily plan job failed",
            extra={"job_id": str(job_id)},
        )
        _fail_job(job_id, str(exc) or type(exc).__name__)
        return SalesDailyPlanWorkerOutcome(ack_sqs_message=True)

    return SalesDailyPlanWorkerOutcome(ack_sqs_message=True)


def _fail_job(job_id: UUID, message: str) -> None:
    with Session(get_engine()) as session:
        job_repo = SalesDailyPlanJobRepository(session)
        job = job_repo.get_by_id(job_id)
        if job is None:
            return
        if job.status in (
            SalesDailyPlanJobStatus.SUCCEEDED,
            SalesDailyPlanJobStatus.FAILED,
        ):
            return
        set_audit_context(
            session,
            user_id=job.created_by,
            request_id=f"sales-daily-plan-job:{job_id}",
        )
        job_repo.mark_failed(job, message)
        session.commit()
