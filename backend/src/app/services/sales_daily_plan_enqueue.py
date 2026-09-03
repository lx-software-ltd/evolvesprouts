"""Create a sales daily plan job row and send it to SQS."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.sales_daily_plan_job import (
    SalesDailyPlanJob,
    SalesDailyPlanJobStatus,
)
from app.db.repositories.sales_daily_plan_job import SalesDailyPlanJobRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.sales_daily_plan_events import enqueue_sales_daily_plan_job


def queue_sales_daily_plan_job(
    *,
    created_by: str,
    request_id: str,
    operator_input: str | None = None,
) -> SalesDailyPlanJob:
    """Insert a pending job, enqueue it, and return the persisted row."""
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=created_by,
            request_id=request_id,
        )
        job = SalesDailyPlanJob(
            created_by=created_by,
            status=SalesDailyPlanJobStatus.PENDING,
            operator_input=operator_input,
        )
        session.add(job)
        session.flush()
        job_id = job.id
        session.commit()

    try:
        enqueue_sales_daily_plan_job(job_id)
    except ValidationError:
        with Session(get_engine()) as session:
            stale = session.get(SalesDailyPlanJob, job_id)
            if stale is not None:
                session.delete(stale)
                session.commit()
        raise
    except Exception:
        with Session(get_engine()) as session:
            job_repo = SalesDailyPlanJobRepository(session)
            failed = job_repo.get_by_id(job_id)
            if failed is not None:
                job_repo.mark_failed(
                    failed, "Could not queue daily plan; try again shortly."
                )
                session.commit()
        raise ValidationError(
            "Daily plan could not be queued; try again shortly.",
            field="configuration",
        ) from None

    with Session(get_engine()) as session:
        job_repo = SalesDailyPlanJobRepository(session)
        persisted_job = job_repo.get_by_id(job_id)
        if persisted_job is None:
            raise NotFoundError("SalesDailyPlanJob", str(job_id))
        return persisted_job
