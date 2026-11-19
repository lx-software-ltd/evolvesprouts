"""Enqueue incremental Meta Graph inbox imports from a schedule."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.enums import MetaChannel
from app.db.models.inbox_import_job import (
    InboxImportJob,
    InboxImportJobStatus,
    InboxImportKind,
)
from app.db.repositories.inbox_import_job import InboxImportJobRepository
from app.services.inbox_import_events import enqueue_inbox_import_job
from app.utils.logging import get_logger

logger = get_logger(__name__)

META_GRAPH_SYNC_SCHEDULE_AUDIT_USER_ID = "system:meta-graph-sync"
SCHEDULE_REQUEST_ID_PREFIX = "meta-graph-sync-schedule"
_CHANNELS = (MetaChannel.INSTAGRAM, MetaChannel.FACEBOOK)


def enqueue_scheduled_meta_graph_sync(*, request_id: str) -> list[UUID]:
    """Queue one incremental meta_graph job per channel that is not in flight."""
    job_ids: list[UUID] = []
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=META_GRAPH_SYNC_SCHEDULE_AUDIT_USER_ID,
            request_id=request_id,
        )
        repo = InboxImportJobRepository(session)
        for channel in _CHANNELS:
            in_flight = repo.find_in_flight_for_channel(
                kind=InboxImportKind.META_GRAPH,
                channel=channel,
            )
            if in_flight is not None:
                logger.info(
                    "Skipping scheduled Meta Graph sync; job already in flight",
                    extra={
                        "channel": channel.value,
                        "job_id": str(in_flight.id),
                        "status": in_flight.status.value,
                    },
                )
                continue
            job = InboxImportJob(
                created_by=META_GRAPH_SYNC_SCHEDULE_AUDIT_USER_ID,
                kind=InboxImportKind.META_GRAPH,
                channel=channel,
                options={"incremental": True},
                status=InboxImportJobStatus.PENDING,
            )
            session.add(job)
            session.flush()
            job_ids.append(job.id)
            logger.info(
                "Queued scheduled Meta Graph sync",
                extra={"job_id": str(job.id), "channel": channel.value},
            )
        session.commit()

    for job_id in job_ids:
        enqueue_inbox_import_job(job_id)
    return job_ids
