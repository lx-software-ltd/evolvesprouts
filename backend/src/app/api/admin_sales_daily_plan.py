"""Admin handlers for /v1/admin/leads/daily-plan and jobs."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_leads_common import request_id
from app.api.admin_request import parse_body
from app.api.admin_validators import validate_string_length
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.sales_daily_plan import SalesDailyPlan
from app.db.models.sales_daily_plan_job import SalesDailyPlanJobStatus
from app.db.repositories.sales_daily_plan_job import SalesDailyPlanJobRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.sales_daily_plan import get_latest_plan, serialize_plan
from app.services.sales_daily_plan_enqueue import queue_sales_daily_plan_job
from app.services.sales_daily_plan_memory import (
    MAX_OPERATOR_INPUT_LENGTH,
    list_recent_plans,
    reset_sales_daily_plan_memory,
    serialize_memory_entry,
)
from app.services.sales_daily_plan_serialize import serialize_sales_daily_plan_job
from app.utils import json_response


def get_sales_daily_plan(event: Mapping[str, Any]) -> dict[str, Any]:
    with Session(get_engine()) as session:
        plan = get_latest_plan(session)
        memory = [serialize_memory_entry(row) for row in list_recent_plans(session)]
        if plan is None:
            return json_response(200, {"plan": None, "memory": memory}, event=event)
        return json_response(
            200,
            {
                "plan": serialize_plan(session, plan=plan),
                "memory": memory,
            },
            event=event,
        )


def parse_daily_plan_operator_input(event: Mapping[str, Any]) -> str | None:
    """Read optional ``operator_input`` from POST; empty body is allowed."""
    raw = event.get("body") or ""
    if event.get("isBase64Encoded") and raw:
        body = parse_body(event)
    elif not str(raw).strip():
        body = {}
    else:
        body = parse_body(event)
    if not isinstance(body, dict):
        raise ValidationError("Request body must be a JSON object")
    return validate_string_length(
        body.get("operator_input"),
        "operator_input",
        MAX_OPERATOR_INPUT_LENGTH,
        required=False,
    )


def create_sales_daily_plan(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
) -> dict[str, Any]:
    operator_input = parse_daily_plan_operator_input(event)
    persisted_job = queue_sales_daily_plan_job(
        created_by=actor_sub,
        request_id=request_id(event),
        operator_input=operator_input,
    )
    return json_response(
        202,
        {"job": serialize_sales_daily_plan_job(persisted_job)},
        event=event,
    )


def delete_sales_daily_plan_memory(
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
        reset_sales_daily_plan_memory(session)
        session.commit()
    return json_response(204, {}, event=event)


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
