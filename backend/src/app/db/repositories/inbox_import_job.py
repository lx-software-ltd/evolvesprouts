"""Repository for inbox import jobs."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.inbox_import_job import (
    InboxImportJob,
    InboxImportJobStatus,
    InboxImportKind,
)
from app.db.repositories.base import BaseRepository


class InboxImportJobRepository(BaseRepository[InboxImportJob]):
    """Data access for Meta Graph and WhatsApp export import jobs."""

    def __init__(self, session: Session):
        super().__init__(session, InboxImportJob)

    def get_by_id(self, job_id: UUID) -> InboxImportJob | None:
        """Fetch one job by primary key."""
        return self._session.get(InboxImportJob, job_id)

    def list_for_kind(
        self,
        *,
        kind: InboxImportKind,
        limit: int,
        cursor_job_id: UUID | None = None,
    ) -> list[InboxImportJob]:
        """List jobs for one import kind, newest first."""
        statement = select(InboxImportJob).where(InboxImportJob.kind == kind)
        if cursor_job_id is not None:
            statement = statement.where(InboxImportJob.id < cursor_job_id)
        statement = statement.order_by(InboxImportJob.created_at.desc()).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    def count_for_kind(self, *, kind: InboxImportKind) -> int:
        """Count jobs for one import kind."""
        statement = select(func.count(InboxImportJob.id)).where(
            InboxImportJob.kind == kind
        )
        return int(self._session.execute(statement).scalar_one())

    def mark_processing(self, job: InboxImportJob) -> InboxImportJob:
        """Mark a job as in progress."""
        job.status = InboxImportJobStatus.PROCESSING
        job.error_message = None
        job.updated_at = datetime.now(UTC)
        self._session.flush()
        return job

    def mark_finished(
        self,
        job: InboxImportJob,
        *,
        status: InboxImportJobStatus,
        counters: dict[str, Any] | None,
        error_message: str | None = None,
    ) -> InboxImportJob:
        """Persist terminal job status and counters."""
        job.status = status
        job.counters = counters
        job.error_message = error_message
        job.updated_at = datetime.now(UTC)
        self._session.flush()
        return job

    def mark_failed(self, job: InboxImportJob, error_message: str) -> InboxImportJob:
        """Mark a job failed with an operator-safe message."""
        return self.mark_finished(
            job,
            status=InboxImportJobStatus.FAILED,
            counters=job.counters,
            error_message=error_message,
        )
