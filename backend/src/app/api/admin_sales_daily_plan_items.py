"""Admin handlers for insight-board annotations and follow-up questions."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from app.api.admin_leads_common import request_id
from app.api.admin_request import parse_body, parse_uuid
from app.api.admin_validators import validate_string_length
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.exceptions import NotFoundError, ValidationError
from app.services.sales_daily_plan import get_latest_plan, serialize_plan
from app.services.sales_daily_plan_annotations import (
    FEEDBACK_VALUES,
    ITEM_KINDS,
    MAX_DRAFT_REPLY,
    resolve_snoozed_until,
    serialize_annotation,
    upsert_annotation,
)
from app.services.sales_daily_plan_completions import priority_key
from app.services.sales_daily_plan_payload import outreach_item_key
from app.services.sales_daily_plan_questions import (
    MAX_QUESTION_LENGTH,
    answer_follow_up_question,
    serialize_question,
)
from app.utils import json_response


def upsert_sales_daily_plan_item_annotation(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    if not isinstance(body, dict):
        raise ValidationError("Request body must be a JSON object")
    item_kind = str(body.get("item_kind") or "").strip()
    if item_kind not in ITEM_KINDS:
        raise ValidationError(
            "item_kind must be priority or outreach", field="item_kind"
        )
    item_key = _resolve_item_key(body, item_kind=item_kind)
    feedback = _optional_feedback(body.get("feedback"))
    snooze_token = body.get("snooze")
    if snooze_token is not None and not isinstance(snooze_token, str):
        raise ValidationError("snooze must be a string", field="snooze")
    try:
        snoozed_until = resolve_snoozed_until(
            snooze_token if isinstance(snooze_token, str) else None
        )
    except ValueError as exc:
        raise ValidationError(str(exc), field="snooze") from exc
    draft_reply = validate_string_length(
        body.get("draft_reply"),
        "draft_reply",
        MAX_DRAFT_REPLY,
        required=False,
    )
    has_draft = "draft_reply" in body
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        plan = get_latest_plan(session)
        if plan is None:
            raise NotFoundError("SalesDailyPlan", "latest")
        row = upsert_annotation(
            session,
            plan_id=plan.id,
            item_kind=item_kind,
            item_key=item_key,
            updated_by=actor_sub,
            feedback=feedback if "feedback" in body else ...,
            snoozed_until=snoozed_until,
            draft_reply=draft_reply if has_draft else ...,
        )
        session.commit()
        return json_response(
            200,
            {
                "plan": serialize_plan(session, plan=plan),
                "annotation": serialize_annotation(row),
            },
            event=event,
        )


def create_sales_daily_plan_question(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    if not isinstance(body, dict):
        raise ValidationError("Request body must be a JSON object")
    question = validate_string_length(
        body.get("question"),
        "question",
        MAX_QUESTION_LENGTH,
        required=True,
    )
    if question is None:
        raise ValidationError("question is required", field="question")
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        plan = get_latest_plan(session)
        if plan is None:
            raise NotFoundError("SalesDailyPlan", "latest")
        row = answer_follow_up_question(
            session,
            plan=plan,
            question=question,
            asked_by=actor_sub,
        )
        session.commit()
        return json_response(
            200,
            {
                "plan": serialize_plan(session, plan=plan),
                "question": serialize_question(row),
            },
            event=event,
        )


def _resolve_item_key(body: dict[str, Any], *, item_kind: str) -> str:
    raw_key = str(body.get("item_key") or "").strip()
    if raw_key:
        return raw_key
    if item_kind == "priority":
        title = validate_string_length(body.get("title"), "title", 500, required=True)
        if title is None:
            raise ValidationError("title is required", field="title")
        return priority_key(
            title,
            _optional_uuid_field(body.get("lead_id"), "lead_id"),
            _optional_uuid_field(body.get("invoice_id"), "invoice_id"),
        )
    channel = str(body.get("channel") or "unknown").strip() or "unknown"
    return outreach_item_key(
        channel,
        _optional_uuid_field(body.get("lead_id"), "lead_id"),
        _optional_uuid_field(body.get("conversation_id"), "conversation_id"),
        str(body.get("message_excerpt") or ""),
    )


def _optional_feedback(value: Any) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip()
    if text not in FEEDBACK_VALUES:
        raise ValidationError(
            "feedback must be up, down, or not_relevant", field="feedback"
        )
    return text


def _optional_uuid_field(value: Any, field: str) -> Any:
    if value is None or str(value).strip() == "":
        return None
    try:
        return parse_uuid(str(value))
    except ValidationError as exc:
        raise ValidationError(f"Invalid UUID: {value}", field=field) from exc
