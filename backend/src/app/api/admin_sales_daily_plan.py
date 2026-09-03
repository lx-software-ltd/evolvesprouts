"""Admin handlers for /v1/admin/leads/daily-plan and jobs."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_leads_common import request_id
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.sales_daily_plan import SalesDailyPlan
from app.db.models.sales_daily_plan_job import (
    SalesDailyPlanJob,
    SalesDailyPlanJobStatus,
)
from app.db.repositories.sales_daily_plan_job import SalesDailyPlanJobRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.sales_daily_plan import get_latest_plan, serialize_plan
from app.services.sales_daily_plan_events import enqueue_sales_daily_plan_job
from app.services.sales_daily_plan_serialize import serialize_sales_daily_plan_job
from app.utils import json_response


def get_sales_daily_plan(event: Mapping[str, Any]) -> dict[str, Any]:
    with Session(get_engine()) as session:
        plan = get_latest_plan(session)
        if plan is None:
            return json_response(200, {"plan": None}, event=event)
        return json_response(
            200,
            {"plan": serialize_plan(session, plan=plan)},
            event=event,
        )


def create_sales_daily_plan(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        job = SalesDailyPlanJob(
            created_by=actor_sub,
            status=SalesDailyPlanJobStatus.PENDING,
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
        return json_response(
            202,
            {"job": serialize_sales_daily_plan_job(persisted_job)},
            event=event,
        )


def get_sales_daily_plan_job(
    event: Mapping[str, Any],
    *,
    job_id: UUID,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        job_repo = SalesDailyPlanJobRepository(session)
        job = job_repo.get_by_id(job_id)
        if job is None:
            raise NotFoundError("SalesDailyPlanJob", str(job_id))
        plan_payload = None
        if job.status == SalesDailyPlanJobStatus.SUCCEEDED and job.plan_id is not None:
            plan = session.get(SalesDailyPlan, job.plan_id)
            if plan is not None:
                plan_payload = serialize_plan(session, plan=plan)
        return json_response(
            200,
            {"job": serialize_sales_daily_plan_job(job, plan=plan_payload)},
            event=event,
        )
