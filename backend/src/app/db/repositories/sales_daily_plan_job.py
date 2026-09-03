"""Repository for sales daily plan jobs."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models.sales_daily_plan_job import (
    SalesDailyPlanJob,
    SalesDailyPlanJobStatus,
)
from app.db.repositories.base import BaseRepository


class SalesDailyPlanJobRepository(BaseRepository[SalesDailyPlanJob]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, SalesDailyPlanJob)

    def mark_processing(self, job: SalesDailyPlanJob) -> None:
        now = datetime.now(UTC)
        job.status = SalesDailyPlanJobStatus.PROCESSING
        if job.started_at is None:
            job.started_at = now
        job.updated_at = now
        self.update(job)

    def mark_succeeded(
        self,
        job: SalesDailyPlanJob,
        *,
        plan_id: UUID,
    ) -> None:
        now = datetime.now(UTC)
        job.status = SalesDailyPlanJobStatus.SUCCEEDED
        job.plan_id = plan_id
        job.error_message = None
        job.finished_at = now
        job.updated_at = now
        self.update(job)

    def mark_failed(self, job: SalesDailyPlanJob, message: str) -> None:
        now = datetime.now(UTC)
        job.status = SalesDailyPlanJobStatus.FAILED
        job.error_message = (message or "An error occurred.")[:8000]
        job.finished_at = now
        job.updated_at = now
        self.update(job)
