"""Admin lead AI suggestion handlers (/v1/admin/leads/{id}/ai-suggestion and jobs)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_leads_common import (
    request_id,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.repositories import (
    SalesLeadRepository,
)
from app.exceptions import NotFoundError, ValidationError
from app.db.models.sales_lead_ai_suggestion_job import (
    SalesLeadAiSuggestionJob,
    SalesLeadAiSuggestionJobStatus,
)
from app.db.repositories.sales_lead_ai_suggestion_job import (
    SalesLeadAiSuggestionJobRepository,
)
from app.services.lead_ai_suggestion_events import enqueue_lead_ai_suggestion_job
from app.services.lead_ai_suggestion_serialize import serialize_lead_ai_suggestion_job
from app.services.lead_close_suggestion import (
    get_latest_suggestion,
    serialize_suggestion,
)
from app.utils import json_response


def get_lead_ai_suggestion(
    event: Mapping[str, Any],
    *,
    lead_id: UUID,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        lead_repo = SalesLeadRepository(session)
        lead = lead_repo.get_by_id(lead_id)
        if lead is None:
            raise NotFoundError("SalesLead", str(lead_id))
        suggestion = get_latest_suggestion(session, lead_id=lead.id)
        if suggestion is None:
            return json_response(200, {"suggestion": None}, event=event)
        return json_response(
            200,
            {
                "suggestion": serialize_suggestion(
                    session,
                    suggestion=suggestion,
                    contact_id=lead.contact_id,
                )
            },
            event=event,
        )


def create_lead_ai_suggestion(
    event: Mapping[str, Any],
    *,
    lead_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
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
        job = SalesLeadAiSuggestionJob(
            lead_id=lead.id,
            created_by=actor_sub,
            status=SalesLeadAiSuggestionJobStatus.PENDING,
        )
        session.add(job)
        session.flush()
        job_id = job.id
        session.commit()

    try:
        enqueue_lead_ai_suggestion_job(job_id)
    except ValidationError:
        with Session(get_engine()) as session:
            stale = session.get(SalesLeadAiSuggestionJob, job_id)
            if stale is not None:
                session.delete(stale)
                session.commit()
        raise
    except Exception:
        with Session(get_engine()) as session:
            job_repo = SalesLeadAiSuggestionJobRepository(session)
            failed = job_repo.get_by_id(job_id)
            if failed is not None:
                job_repo.mark_failed(
                    failed, "Could not queue AI suggestion; try again shortly."
                )
                session.commit()
        raise ValidationError(
            "AI suggestion could not be queued; try again shortly.",
            field="configuration",
        ) from None

    with Session(get_engine()) as session:
        job_repo = SalesLeadAiSuggestionJobRepository(session)
        persisted_job = job_repo.get_by_id(job_id)
        if persisted_job is None:
            raise NotFoundError("SalesLeadAiSuggestionJob", str(job_id))
        return json_response(
            202,
            {"job": serialize_lead_ai_suggestion_job(persisted_job)},
            event=event,
        )


def get_lead_ai_suggestion_job(
    event: Mapping[str, Any],
    *,
    lead_id: UUID,
    job_id: UUID,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        lead_repo = SalesLeadRepository(session)
        lead = lead_repo.get_by_id(lead_id)
        if lead is None:
            raise NotFoundError("SalesLead", str(lead_id))
        job_repo = SalesLeadAiSuggestionJobRepository(session)
        job = job_repo.get_for_lead(job_id, lead_id=lead.id)
        if job is None:
            raise NotFoundError("SalesLeadAiSuggestionJob", str(job_id))
        suggestion_payload = None
        if (
            job.status == SalesLeadAiSuggestionJobStatus.SUCCEEDED
            and job.suggestion_id is not None
        ):
            from app.db.models.sales_lead_ai_suggestion import SalesLeadAiSuggestion

            suggestion = session.get(SalesLeadAiSuggestion, job.suggestion_id)
            if suggestion is not None:
                suggestion_payload = serialize_suggestion(
                    session,
                    suggestion=suggestion,
                    contact_id=lead.contact_id,
                )
        return json_response(
            200,
            {
                "job": serialize_lead_ai_suggestion_job(
                    job, suggestion=suggestion_payload
                )
            },
            event=event,
        )
