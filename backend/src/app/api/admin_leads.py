"""Admin sales lead API handlers."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_leads_common import (
    encode_lead_cursor,
    parse_create_lead_payload,
    parse_lead_filters,
    parse_update_lead_payload,
    request_id,
    serialize_lead_detail,
    serialize_lead_summary,
    serialize_note,
)
from app.api.admin_sales_settings import handle_sales_settings_request
from app.api.admin_request import (
    parse_body,
    parse_uuid,
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)
from app.api.admin_validators import MAX_DESCRIPTION_LENGTH, validate_string_length
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import Contact, Note, SalesLead
from app.db.models.enums import FunnelStage, LeadEventType
from app.db.repositories import (
    ContactRepository,
    NoteRepository,
    SalesLeadRepository,
)
from app.exceptions import NotFoundError, ValidationError
from app.services.sales_assignment import (
    notify_lead_assignee,
    record_new_lead_assignment_event,
    resolve_create_assignee,
)
from app.utils import json_response, method_not_allowed, not_found
from app.api.admin_leads_ai_suggestions import (
    create_lead_ai_suggestion,
    get_lead_ai_suggestion,
    get_lead_ai_suggestion_job,
)
from app.api.admin_leads_analytics import (
    get_analytics,
)
from app.api.admin_sales_daily_plan import (
    create_sales_daily_plan,
    get_sales_daily_plan,
    get_sales_daily_plan_job,
)


def handle_admin_leads_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/leads routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "admin", "leads"):
        return not_found(event)

    identity = require_admin_identity(event)

    if len(parts) == 2:
        if method == "GET":
            return _list_leads(event)
        if method == "POST":
            return _create_lead(event, actor_sub=identity.user_sub)
        return method_not_allowed(event)

    if len(parts) == 3 and parts[2] == "analytics":
        if method != "GET":
            return method_not_allowed(event)
        return get_analytics(event)

    if len(parts) == 3 and parts[2] == "settings":
        return handle_sales_settings_request(event, method, actor_sub=identity.user_sub)

    if len(parts) == 3 and parts[2] == "daily-plan":
        if method == "GET":
            return get_sales_daily_plan(event)
        if method == "POST":
            return create_sales_daily_plan(event, actor_sub=identity.user_sub)
        return method_not_allowed(event)

    if len(parts) == 5 and parts[2] == "daily-plan" and parts[3] == "jobs":
        job_id = parse_uuid(parts[4])
        if method == "GET":
            return get_sales_daily_plan_job(event, job_id=job_id)
        return method_not_allowed(event)

    lead_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return _get_lead(event, lead_id=lead_id)
        if method == "PATCH":
            return _update_lead(event, lead_id=lead_id, actor_sub=identity.user_sub)
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "notes":
        if method != "POST":
            return method_not_allowed(event)
        return _create_lead_note(event, lead_id=lead_id, actor_sub=identity.user_sub)

    if len(parts) == 4 and parts[3] == "ai-suggestion":
        if method == "GET":
            return get_lead_ai_suggestion(event, lead_id=lead_id)
        if method == "POST":
            return create_lead_ai_suggestion(
                event, lead_id=lead_id, actor_sub=identity.user_sub
            )
        return method_not_allowed(event)

    if len(parts) == 6 and parts[3] == "ai-suggestion" and parts[4] == "jobs":
        job_id = parse_uuid(parts[5])
        if method == "GET":
            return get_lead_ai_suggestion_job(event, lead_id=lead_id, job_id=job_id)
        return method_not_allowed(event)

    return not_found(event)


def _list_leads(event: Mapping[str, Any]) -> dict[str, Any]:
    filters = parse_lead_filters(event)
    limit = filters["limit"]

    with Session(get_engine()) as session:
        repository = SalesLeadRepository(session)
        rows = repository.list_leads(
            limit=limit + 1,
            stage=filters["stage"],
            source=filters["source"],
            lead_type=filters["lead_type"],
            assigned_to=filters["assigned_to"],
            unassigned=filters["unassigned"],
            date_from=filters["date_from"],
            date_to=filters["date_to"],
            search=filters["search"],
            sort=filters["sort"],
            sort_dir=filters["sort_dir"],
            cursor_created_at=filters["cursor_created_at"],
            cursor_id=filters["cursor_id"],
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        total_count = repository.count_leads(
            stage=filters["stage"],
            source=filters["source"],
            lead_type=filters["lead_type"],
            assigned_to=filters["assigned_to"],
            unassigned=filters["unassigned"],
            date_from=filters["date_from"],
            date_to=filters["date_to"],
            search=filters["search"],
        )
        next_cursor = None
        if has_more and page_rows and filters["sort"] == "created_at":
            next_cursor = encode_lead_cursor(page_rows[-1])
        return json_response(
            200,
            {
                "items": [serialize_lead_summary(lead) for lead in page_rows],
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _get_lead(event: Mapping[str, Any], *, lead_id: UUID) -> dict[str, Any]:
    with Session(get_engine()) as session:
        repository = SalesLeadRepository(session)
        lead = repository.get_by_id_with_details(lead_id)
        if lead is None:
            raise NotFoundError("SalesLead", str(lead_id))
        return json_response(
            200,
            {"lead": serialize_lead_detail(lead)},
            event=event,
        )


def _create_lead(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    body = parse_body(event)
    payload = parse_create_lead_payload(body)

    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        contact_repo = ContactRepository(session)
        lead_repo = SalesLeadRepository(session)
        note_repo = NoteRepository(session)

        if payload["email"]:
            contact, _ = contact_repo.upsert_by_email(
                payload["email"],
                first_name=payload["first_name"],
                source=payload["source"],
                source_detail=payload["source_detail"],
                contact_type=payload["contact_type"],
            )
        else:
            contact = contact_repo.create(
                Contact(
                    first_name=payload["first_name"],
                    source=payload["source"],
                    source_detail=payload["source_detail"],
                    contact_type=payload["contact_type"],
                )
            )

        if payload["last_name"] is not None:
            contact.last_name = payload["last_name"]
        if not payload["skip_phone_update"]:
            contact.phone_region = payload["phone_region"]
            contact.phone_national_number = payload["phone_national_number"]
        if payload["instagram_handle"] is not None:
            contact.instagram_handle = payload["instagram_handle"]
        contact_repo.update(contact)

        assigned_to = resolve_create_assignee(
            session,
            assigned_to=payload["assigned_to"],
            assigned_to_provided=payload["assigned_to_provided"],
        )
        lead = lead_repo.create_with_event(
            SalesLead(
                contact_id=contact.id,
                lead_type=payload["lead_type"],
                funnel_stage=FunnelStage.NEW,
                assigned_to=assigned_to,
                is_manual=True,
            ),
            LeadEventType.CREATED,
            from_stage=None,
            to_stage=FunnelStage.NEW,
            created_by=actor_sub,
        )
        record_new_lead_assignment_event(
            lead_repo,
            lead_id=lead.id,
            assigned_to=assigned_to,
            actor_sub=actor_sub,
        )

        if payload["note"]:
            note = note_repo.create(
                Note(
                    contact_id=contact.id,
                    lead_id=lead.id,
                    content=payload["note"],
                    created_by=actor_sub,
                )
            )
            lead_repo.add_event(
                lead_id=lead.id,
                event_type=LeadEventType.NOTE_ADDED,
                metadata={"note_id": str(note.id)},
                created_by=actor_sub,
            )

        session.commit()
        created = lead_repo.get_by_id_with_details(lead.id)
        if created is None:
            raise NotFoundError("SalesLead", str(lead.id))
        notify_lead_assignee(session, created, previous=None)
        return json_response(
            201,
            {"lead": serialize_lead_detail(created)},
            event=event,
        )


def _update_lead(
    event: Mapping[str, Any],
    *,
    lead_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    payload = parse_update_lead_payload(body)

    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        repository = SalesLeadRepository(session)
        lead = repository.get_by_id_with_details(lead_id)
        if lead is None:
            raise NotFoundError("SalesLead", str(lead_id))

        if payload["funnel_stage"] is not None:
            previous = lead.funnel_stage
            next_stage = payload["funnel_stage"]
            if next_stage != previous:
                lead.funnel_stage = next_stage
                lead.updated_at = datetime.now(UTC)
                if next_stage == FunnelStage.CONVERTED:
                    lead.converted_at = datetime.now(UTC)
                    lead.lost_at = None
                    lead.lost_reason = None
                elif next_stage == FunnelStage.LOST:
                    lead.lost_at = datetime.now(UTC)
                    lead.lost_reason = payload["lost_reason"]
                    lead.converted_at = None
                else:
                    lead.converted_at = None
                    lead.lost_at = None
                    lead.lost_reason = None
                repository.update(lead)
                repository.add_event(
                    lead_id=lead.id,
                    event_type=LeadEventType.STAGE_CHANGED,
                    from_stage=previous,
                    to_stage=next_stage,
                    metadata=None,
                    created_by=actor_sub,
                )

        previous_assignee = lead.assigned_to
        assignment_changed = False
        if payload["assigned_to_provided"]:
            if previous_assignee != payload["assigned_to"]:
                lead.assigned_to = payload["assigned_to"]
                lead.updated_at = datetime.now(UTC)
                repository.update(lead)
                repository.add_event(
                    lead_id=lead.id,
                    event_type=LeadEventType.ASSIGNED,
                    metadata={"from": previous_assignee, "to": payload["assigned_to"]},
                    created_by=actor_sub,
                )
                assignment_changed = True

        session.commit()
        updated = repository.get_by_id_with_details(lead.id)
        if updated is None:
            raise NotFoundError("SalesLead", str(lead.id))
        if assignment_changed:
            notify_lead_assignee(session, updated, previous=previous_assignee)
        return json_response(200, {"lead": serialize_lead_detail(updated)}, event=event)


def _create_lead_note(
    event: Mapping[str, Any],
    *,
    lead_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    content = validate_string_length(
        body.get("content"),
        "content",
        max_length=MAX_DESCRIPTION_LENGTH,
        required=True,
    )
    if content is None:
        raise ValidationError("content is required", field="content")

    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        lead_repo = SalesLeadRepository(session)
        lead = lead_repo.get_by_id(lead_id)
        if lead is None:
            raise NotFoundError("SalesLead", str(lead_id))

        note_repo = NoteRepository(session)
        note = note_repo.create(
            Note(
                lead_id=lead.id,
                contact_id=lead.contact_id,
                content=content,
                created_by=actor_sub,
            )
        )
        lead_repo.add_event(
            lead_id=lead.id,
            event_type=LeadEventType.NOTE_ADDED,
            metadata={"note_id": str(note.id)},
            created_by=actor_sub,
        )
        session.commit()
        return json_response(201, {"note": serialize_note(note)}, event=event)
