"""Admin handlers for /v1/admin/leads/daily-plan and jobs."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_leads_common import request_id
from app.api.admin_request import parse_body, parse_uuid, query_param
from app.api.admin_sales_daily_plan_instructions import (
    archive_sales_daily_plan_instruction_http,
    create_sales_daily_plan_instruction_http,
    list_sales_daily_plan_instructions,
)
from app.api.admin_sales_daily_plan_items import (
    create_sales_daily_plan_question,
    upsert_sales_daily_plan_item_annotation,
)
from app.api.admin_validators import validate_string_length
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.sales_daily_plan import SalesDailyPlan
from app.db.models.sales_daily_plan_job import SalesDailyPlanJobStatus
from app.db.repositories.sales_daily_plan_job import SalesDailyPlanJobRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.sales_daily_plan import get_latest_plan, serialize_plan
from app.services.sales_daily_plan_annotations import MAX_ITEM_KEY
from app.services.sales_daily_plan_enqueue import queue_sales_daily_plan_job
from app.services.sales_daily_plan_identity import priority_identity
from app.services.sales_daily_plan_instructions import (
    INSTRUCTION_SCOPES,
    create_instruction,
    delete_instruction,
    list_active_instructions,
    serialize_instruction,
)
from app.services.sales_daily_plan_item_state import (
    serialize_completion,
    set_item_done,
)
from app.services.sales_daily_plan_memory import (
    MAX_OPERATOR_INPUT_LENGTH,
    list_recent_plans,
    reset_sales_daily_plan_memory,
    serialize_memory_entry,
)
from app.services.sales_daily_plan_serialize import serialize_sales_daily_plan_job
from app.utils import json_response, method_not_allowed
from app.utils.logging import get_logger

logger = get_logger(__name__)


def route_sales_daily_plan_request(
    event: Mapping[str, Any],
    method: str,
    parts: list[str],
    *,
    actor_sub: str,
) -> dict[str, Any] | None:
    """Dispatch /v1/admin/leads/daily-plan* or return None when unmatched."""
    if len(parts) < 3 or parts[2] != "daily-plan":
        return None
    if len(parts) == 3:
        if method == "GET":
            return get_sales_daily_plan(event)
        if method == "POST":
            return create_sales_daily_plan(event, actor_sub=actor_sub)
        if method == "DELETE":
            return delete_sales_daily_plan_memory(event, actor_sub=actor_sub)
        return method_not_allowed(event)
    if len(parts) == 5 and parts[3] == "jobs":
        job_id = parse_uuid(parts[4])
        if method == "GET":
            return get_sales_daily_plan_job(event, job_id=job_id)
        return method_not_allowed(event)
    if len(parts) == 4 and parts[3] == "instructions":
        if method == "GET":
            return list_sales_daily_plan_instructions(event)
        if method == "POST":
            return create_sales_daily_plan_instruction_http(event, actor_sub=actor_sub)
        return method_not_allowed(event)
    if len(parts) == 5 and parts[3] == "instructions":
        instruction_id = parse_uuid(parts[4])
        if method == "DELETE":
            return archive_sales_daily_plan_instruction_http(
                event, instruction_id=instruction_id, actor_sub=actor_sub
            )
        return method_not_allowed(event)
    if len(parts) == 4 and parts[3] == "priority-completions":
        if method == "POST":
            return upsert_sales_daily_plan_priority_completion(
                event, actor_sub=actor_sub
            )
        return method_not_allowed(event)
    if len(parts) == 4 and parts[3] == "item-annotations":
        if method == "POST":
            return upsert_sales_daily_plan_item_annotation(event, actor_sub=actor_sub)
        return method_not_allowed(event)
    if len(parts) == 4 and parts[3] == "questions":
        if method == "POST":
            return create_sales_daily_plan_question(event, actor_sub=actor_sub)
        return method_not_allowed(event)
    return None


def parse_compare_flag(event: Mapping[str, Any]) -> bool:
    raw = query_param(event, "compare")
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes"}


def get_sales_daily_plan(event: Mapping[str, Any]) -> dict[str, Any]:
    include_comparison = parse_compare_flag(event)
    with Session(get_engine()) as session:
        plan = get_latest_plan(session)
        memory = [serialize_memory_entry(row) for row in list_recent_plans(session)]
        instructions = [
            serialize_instruction(row) for row in list_active_instructions(session)
        ]
        latest_job = SalesDailyPlanJobRepository(session).latest()
        job_payload = (
            serialize_sales_daily_plan_job(latest_job)
            if latest_job is not None
            else None
        )
        if plan is None:
            return json_response(
                200,
                {
                    "plan": None,
                    "memory": memory,
                    "instructions": instructions,
                    "job": job_payload,
                },
                event=event,
            )
        return json_response(
            200,
            {
                "plan": serialize_plan(
                    session, plan=plan, include_comparison=include_comparison
                ),
                "memory": memory,
                "instructions": instructions,
                "job": job_payload,
            },
            event=event,
        )


def parse_daily_plan_operator_input(event: Mapping[str, Any]) -> str | None:
    """Read optional ``operator_input`` from POST; empty body is allowed."""
    body = _daily_plan_body(event)
    return validate_string_length(
        body.get("operator_input"),
        "operator_input",
        MAX_OPERATOR_INPUT_LENGTH,
        required=False,
    )


def _daily_plan_body(event: Mapping[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or ""
    if event.get("isBase64Encoded") and raw:
        body = parse_body(event)
    elif not str(raw).strip():
        body = {}
    else:
        body = parse_body(event)
    if not isinstance(body, dict):
        raise ValidationError("Request body must be a JSON object")
    return body


def parse_daily_plan_operator_scope(event: Mapping[str, Any]) -> str:
    """Read optional ``operator_input_scope``; default is ``today``."""
    body = _daily_plan_body(event)
    raw = body.get("operator_input_scope")
    if raw is None or str(raw).strip() == "":
        return "today"
    scope = str(raw).strip().lower()
    if scope not in INSTRUCTION_SCOPES:
        raise ValidationError(
            "operator_input_scope must be today or standing",
            field="operator_input_scope",
        )
    return scope


def create_sales_daily_plan(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
) -> dict[str, Any]:
    operator_input = parse_daily_plan_operator_input(event)
    created_instruction_id = _store_operator_instruction(
        event, actor_sub=actor_sub, operator_input=operator_input
    )
    try:
        persisted_job = queue_sales_daily_plan_job(
            created_by=actor_sub,
            request_id=request_id(event),
            operator_input=operator_input,
        )
    except Exception:
        if created_instruction_id is not None:
            _discard_instruction(created_instruction_id)
        raise
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


def upsert_sales_daily_plan_priority_completion(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
) -> dict[str, Any]:
    """Mark or unmark a priority on the latest plan."""
    body = parse_body(event)
    if not isinstance(body, dict):
        raise ValidationError("Request body must be a JSON object")
    title = validate_string_length(body.get("title"), "title", 500, required=True)
    if title is None:
        raise ValidationError("title is required", field="title")
    raw_done = body.get("done")
    if not isinstance(raw_done, bool):
        raise ValidationError("done must be a boolean", field="done")
    lead_id = _optional_uuid_field(body.get("lead_id"), "lead_id")
    invoice_id = _optional_uuid_field(body.get("invoice_id"), "invoice_id")
    conversation_id = _optional_uuid_field(
        body.get("conversation_id"), "conversation_id"
    )
    raw_key = str(body.get("item_key") or "").strip()
    if len(raw_key) > MAX_ITEM_KEY:
        raise ValidationError(
            f"item_key must be at most {MAX_ITEM_KEY} characters",
            field="item_key",
        )
    identity = raw_key or priority_identity(
        kind=_optional_text(body.get("kind")),
        lead_id=lead_id,
        invoice_id=invoice_id,
        conversation_id=conversation_id,
        title=title,
        instruction_id=body.get("instruction_id"),
    )
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        plan = get_latest_plan(session)
        if plan is None:
            raise NotFoundError("SalesDailyPlan", "latest")
        row = set_item_done(
            session,
            identity=identity,
            item_kind="priority",
            title=title,
            lead_id=lead_id,
            invoice_id=invoice_id,
            conversation_id=conversation_id,
            priority_kind=_optional_text(body.get("kind")),
            done=raw_done,
            actor=actor_sub,
            source_plan_id=plan.id,
        )
        session.commit()
        return json_response(
            200,
            {
                "plan": serialize_plan(session, plan=plan),
                "completion": serialize_completion(row) if row is not None else None,
            },
            event=event,
        )


def _store_operator_instruction(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
    operator_input: str | None,
) -> UUID | None:
    """Persist a new note before enqueue. Reused notes are left in place."""
    if not operator_input:
        return None
    scope = parse_daily_plan_operator_scope(event)
    current = datetime.now(UTC)
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        row = create_instruction(
            session,
            text=operator_input,
            scope=scope,
            created_by=actor_sub,
            now=current,
        )
        is_new = row.created_at == current
        session.commit()
        return row.id if is_new else None


def _discard_instruction(instruction_id: UUID) -> None:
    try:
        with Session(get_engine()) as session:
            delete_instruction(session, instruction_id=instruction_id)
            session.commit()
    except Exception:
        logger.exception("Failed to discard insight instruction after enqueue failure")


def _optional_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _optional_uuid_field(value: Any, field: str) -> UUID | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return parse_uuid(str(value))
    except ValidationError as exc:
        raise ValidationError(f"Invalid UUID: {value}", field=field) from exc
