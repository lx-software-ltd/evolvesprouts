"""Admin handlers for insight standing and same-day instructions."""

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
from app.exceptions import NotFoundError, ValidationError
from app.services.sales_daily_plan import get_latest_plan, serialize_plan
from app.services.sales_daily_plan_instructions import (
    INSTRUCTION_SCOPES,
    archive_instruction,
    create_instruction,
    list_active_instructions,
    serialize_instruction,
)
from app.services.sales_daily_plan_memory import MAX_OPERATOR_INPUT_LENGTH
from app.utils import json_response


def list_sales_daily_plan_instructions(event: Mapping[str, Any]) -> dict[str, Any]:
    with Session(get_engine()) as session:
        rows = list_active_instructions(session)
        return json_response(
            200,
            {"instructions": [serialize_instruction(row) for row in rows]},
            event=event,
        )


def create_sales_daily_plan_instruction_http(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    if not isinstance(body, dict):
        raise ValidationError("Request body must be a JSON object")
    text = validate_string_length(
        body.get("text"),
        "text",
        MAX_OPERATOR_INPUT_LENGTH,
        required=True,
    )
    if text is None:
        raise ValidationError("text is required", field="text")
    scope = _scope(body.get("scope"))
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        row = create_instruction(session, text=text, scope=scope, created_by=actor_sub)
        session.commit()
        return json_response(
            200,
            {"instruction": serialize_instruction(row)},
            event=event,
        )


def archive_sales_daily_plan_instruction_http(
    event: Mapping[str, Any],
    *,
    instruction_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        row = archive_instruction(
            session, instruction_id=instruction_id, archived_by=actor_sub
        )
        if row is None:
            raise NotFoundError("SalesDailyPlanInstruction", str(instruction_id))
        plan = get_latest_plan(session)
        session.commit()
        return json_response(
            200,
            {
                "instruction": serialize_instruction(row),
                "plan": serialize_plan(session, plan=plan)
                if plan is not None
                else None,
            },
            event=event,
        )


def _scope(value: Any) -> str:
    if value is None or str(value).strip() == "":
        return "today"
    text = str(value).strip().lower()
    if text not in INSTRUCTION_SCOPES:
        raise ValidationError(
            "scope must be today or standing",
            field="scope",
        )
    return text
