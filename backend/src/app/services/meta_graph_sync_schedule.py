"""Enqueue incremental Meta Graph inbox imports from a schedule."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
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
_LOCK_NAMESPACE = 0x4D455441  # "META"


def enqueue_scheduled_meta_graph_sync(*, request_id: str) -> list[UUID]:
    """Queue one incremental meta_graph job per channel that is not in flight."""
    job_ids: list[UUID] = []
    for channel in _CHANNELS:
        job_id = _enqueue_channel(channel=channel, request_id=request_id)
        if job_id is not None:
            job_ids.append(job_id)
    return job_ids


def _enqueue_channel(*, channel: MetaChannel, request_id: str) -> UUID | None:
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=META_GRAPH_SYNC_SCHEDULE_AUDIT_USER_ID,
            request_id=request_id,
        )
        session.execute(
            text("SELECT pg_advisory_xact_lock(:ns, :key)"),
            {"ns": _LOCK_NAMESPACE, "key": _channel_lock_key(channel)},
        )
        repo = InboxImportJobRepository(session)
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
            return None
        job = InboxImportJob(
            created_by=META_GRAPH_SYNC_SCHEDULE_AUDIT_USER_ID,
            kind=InboxImportKind.META_GRAPH,
            channel=channel,
            options={"incremental": True},
            status=InboxImportJobStatus.PENDING,
        )
        session.add(job)
        session.flush()
        job_id = job.id
        session.commit()

    try:
        enqueue_inbox_import_job(job_id)
    except Exception:
        logger.exception(
            "Failed to enqueue scheduled Meta Graph sync",
            extra={"job_id": str(job_id), "channel": channel.value},
        )
        _fail_enqueue(job_id)
        return None
    logger.info(
        "Queued scheduled Meta Graph sync",
        extra={"job_id": str(job_id), "channel": channel.value},
    )
    return job_id


def _fail_enqueue(job_id: UUID) -> None:
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=META_GRAPH_SYNC_SCHEDULE_AUDIT_USER_ID,
            request_id=str(job_id),
        )
        repo = InboxImportJobRepository(session)
        job = repo.get_by_id(job_id)
        if job is not None:
            repo.mark_failed(
                job, "Could not queue scheduled Meta Graph sync; try again shortly."
            )
            session.commit()


def _channel_lock_key(channel: MetaChannel) -> int:
    # Stable across processes (Python's hash() is salted per interpreter).
    return sum(ord(char) for char in channel.value) % (2**31)
