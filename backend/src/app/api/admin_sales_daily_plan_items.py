"""Admin handlers for insight-board annotations and follow-up questions."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_leads_common import request_id
from app.api.admin_request import parse_body, parse_uuid
from app.api.admin_validators import validate_string_length
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.sales_daily_plan import SalesDailyPlan
from app.db.models.sales_daily_plan_item_annotation import (
    SalesDailyPlanItemAnnotation,
)
from app.db.models.sales_daily_plan_item_state import SalesDailyPlanItemState
from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.services.sales_daily_plan import get_latest_plan, serialize_plan
from app.services.sales_daily_plan_annotations import (
    FEEDBACK_VALUES,
    ITEM_KINDS,
    MAX_DRAFT_REPLY,
    MAX_ITEM_KEY,
    resolve_snoozed_until,
    serialize_annotation,
    upsert_annotation,
)
from app.services.sales_daily_plan_identity import outreach_identity, priority_identity
from app.services.sales_daily_plan_item_state import set_item_feedback, set_item_snooze
from app.services.sales_daily_plan_questions import (
    MAX_QUESTION_LENGTH,
    generate_follow_up_answer,
    persist_follow_up_question,
    serialize_question,
)
from app.utils import json_response


def parse_optional_plan_id(body: Mapping[str, Any]) -> UUID | None:
    raw = body.get("plan_id")
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return parse_uuid(str(raw))
    except ValidationError as exc:
        raise ValidationError(f"Invalid UUID: {raw}", field="plan_id") from exc


def require_latest_plan_for_mutation(
    session: Session, plan_id: UUID | None
) -> SalesDailyPlan:
    plan = get_latest_plan(session)
    if plan is None:
        raise NotFoundError("SalesDailyPlan", "latest")
    if plan_id is not None and plan.id != plan_id:
        raise ConflictError(
            "The insight was refreshed. Reload the page and try again.",
            latest_plan_id=str(plan.id),
        )
    return plan


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
    has_feedback = "feedback" in body
    has_snooze = isinstance(snooze_token, str)
    plan_id = parse_optional_plan_id(body)
    title = str(body.get("title") or body.get("message_excerpt") or item_key)
    lead_id = _optional_uuid_field(body.get("lead_id"), "lead_id")
    invoice_id = _optional_uuid_field(body.get("invoice_id"), "invoice_id")
    conversation_id = _optional_uuid_field(
        body.get("conversation_id"), "conversation_id"
    )
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        if has_draft:
            plan = require_latest_plan_for_mutation(session, plan_id)
        else:
            latest = get_latest_plan(session)
            if latest is None:
                raise NotFoundError("SalesDailyPlan", "latest")
            plan = latest
        row: SalesDailyPlanItemAnnotation | SalesDailyPlanItemState | None = None
        if has_draft:
            row = upsert_annotation(
                session,
                plan_id=plan.id,
                item_kind=item_kind,
                item_key=item_key,
                updated_by=actor_sub,
                draft_reply=draft_reply,
            )
        if has_feedback:
            row = set_item_feedback(
                session,
                identity=item_key,
                item_kind=item_kind,
                title=title,
                feedback=feedback,
                actor=actor_sub,
                lead_id=lead_id,
                invoice_id=invoice_id,
                conversation_id=conversation_id,
                source_plan_id=plan.id,
            )
        if has_snooze:
            row = set_item_snooze(
                session,
                identity=item_key,
                item_kind=item_kind,
                title=title,
                snoozed_until=_snooze_timestamp(snoozed_until),
                actor=actor_sub,
                lead_id=lead_id,
                invoice_id=invoice_id,
                conversation_id=conversation_id,
                source_plan_id=plan.id,
            )
        if row is None:
            raise ValidationError(
                "feedback, snooze, or draft_reply is required",
                field="feedback",
            )
        session.commit()
        annotation = (
            serialize_annotation(row)
            if isinstance(row, SalesDailyPlanItemAnnotation)
            else _state_annotation(row, item_kind=item_kind, item_key=item_key)
        )
        return json_response(
            200,
            {
                "plan": serialize_plan(session, plan=plan),
                "annotation": annotation,
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
    requested_plan_id = parse_optional_plan_id(body)
    plan_id, plan_payload = _load_plan_for_question(
        event, actor_sub=actor_sub, plan_id=requested_plan_id
    )
    answer, model = generate_follow_up_answer(
        plan_payload=plan_payload,
        question=question,
        plan_id=plan_id,
    )
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        plan = session.get(SalesDailyPlan, plan_id)
        if plan is None:
            raise NotFoundError("SalesDailyPlan", str(plan_id))
        row = persist_follow_up_question(
            session,
            plan_id=plan.id,
            question=question,
            answer=answer,
            asked_by=actor_sub,
            model=model,
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


def _load_plan_for_question(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
    plan_id: UUID | None,
) -> tuple[UUID, dict[str, Any]]:
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        plan = require_latest_plan_for_mutation(session, plan_id)
        payload = plan.payload if isinstance(plan.payload, dict) else {}
        return plan.id, dict(payload)


def _resolve_item_key(body: dict[str, Any], *, item_kind: str) -> str:
    raw_key = str(body.get("item_key") or "").strip()
    if raw_key:
        return _validated_item_key(raw_key)
    if item_kind == "priority":
        title = validate_string_length(body.get("title"), "title", 500, required=True)
        if title is None:
            raise ValidationError("title is required", field="title")
        return _validated_item_key(
            priority_identity(
                kind=_optional_text(body.get("kind")),
                lead_id=_optional_uuid_field(body.get("lead_id"), "lead_id"),
                invoice_id=_optional_uuid_field(body.get("invoice_id"), "invoice_id"),
                conversation_id=_optional_uuid_field(
                    body.get("conversation_id"), "conversation_id"
                ),
                title=title,
                instruction_id=body.get("instruction_id"),
            )
        )
    channel = str(body.get("channel") or "unknown").strip() or "unknown"
    return _validated_item_key(
        outreach_identity(
            channel=channel,
            lead_id=_optional_uuid_field(body.get("lead_id"), "lead_id"),
            conversation_id=_optional_uuid_field(
                body.get("conversation_id"), "conversation_id"
            ),
            message_excerpt=str(body.get("message_excerpt") or ""),
        )
    )


def _validated_item_key(item_key: str) -> str:
    if len(item_key) > MAX_ITEM_KEY:
        raise ValidationError(
            f"item_key must be at most {MAX_ITEM_KEY} characters",
            field="item_key",
        )
    return item_key


def _state_annotation(
    row: SalesDailyPlanItemState, *, item_kind: str, item_key: str
) -> dict[str, Any]:
    snoozed = row.snoozed_until
    updated = row.updated_at
    return {
        "item_kind": item_kind,
        "item_key": item_key,
        "feedback": row.feedback,
        "snoozed_until": snoozed.isoformat() if isinstance(snoozed, datetime) else None,
        "draft_reply": None,
        "updated_by": row.updated_by,
        "updated_at": updated.isoformat() if isinstance(updated, datetime) else None,
    }


def _snooze_timestamp(value: datetime | None | object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    return None


def _optional_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


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
