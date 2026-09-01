"""Repository for lead AI suggestion jobs."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.sales_lead_ai_suggestion_job import (
    SalesLeadAiSuggestionJob,
    SalesLeadAiSuggestionJobStatus,
)
from app.db.repositories.base import BaseRepository


class SalesLeadAiSuggestionJobRepository(BaseRepository[SalesLeadAiSuggestionJob]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, SalesLeadAiSuggestionJob)

    def get_for_lead(
        self, job_id: UUID, *, lead_id: UUID
    ) -> SalesLeadAiSuggestionJob | None:
        stmt = select(SalesLeadAiSuggestionJob).where(
            SalesLeadAiSuggestionJob.id == job_id,
            SalesLeadAiSuggestionJob.lead_id == lead_id,
        )
        return self._session.execute(stmt).scalar_one_or_none()

    def mark_processing(self, job: SalesLeadAiSuggestionJob) -> None:
        now = datetime.now(UTC)
        job.status = SalesLeadAiSuggestionJobStatus.PROCESSING
        if job.started_at is None:
            job.started_at = now
        job.updated_at = now
        self.update(job)

    def mark_succeeded(
        self,
        job: SalesLeadAiSuggestionJob,
        *,
        suggestion_id: UUID,
    ) -> None:
        now = datetime.now(UTC)
        job.status = SalesLeadAiSuggestionJobStatus.SUCCEEDED
        job.suggestion_id = suggestion_id
        job.error_message = None
        job.finished_at = now
        job.updated_at = now
        self.update(job)

    def mark_failed(self, job: SalesLeadAiSuggestionJob, message: str) -> None:
        now = datetime.now(UTC)
        job.status = SalesLeadAiSuggestionJobStatus.FAILED
        job.error_message = (message or "An error occurred.")[:8000]
        job.finished_at = now
        job.updated_at = now
        self.update(job)
