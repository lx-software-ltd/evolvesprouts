"""Enqueue the org-wide sales plan of the day from a daily schedule."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.db.audit import SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID
from app.db.engine import get_engine
from app.db.repositories.sales_daily_plan_job import SalesDailyPlanJobRepository
from app.services.sales_daily_plan_enqueue import queue_sales_daily_plan_job
from app.utils.logging import get_logger

logger = get_logger(__name__)

SCHEDULE_REQUEST_ID_PREFIX = "sales-daily-plan-schedule"


def enqueue_scheduled_sales_daily_plan(*, request_id: str) -> UUID | None:
    """Queue a scheduled daily plan unless another job is already in flight.

    Returns the new job id, or ``None`` when a pending/processing job exists.
    """
    with Session(get_engine()) as session:
        job_repo = SalesDailyPlanJobRepository(session)
        in_flight = job_repo.find_in_flight()
        if in_flight is not None:
            logger.info(
                "Skipping scheduled sales daily plan; job already in flight",
                extra={
                    "job_id": str(in_flight.id),
                    "status": in_flight.status.value,
                },
            )
            return None

    job = queue_sales_daily_plan_job(
        created_by=SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID,
        request_id=request_id,
    )
    logger.info(
        "Queued scheduled sales daily plan",
        extra={"job_id": str(job.id)},
    )
    return job.id
