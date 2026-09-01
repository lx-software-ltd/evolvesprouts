"""Execute inbox import jobs (SQS worker)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models.inbox_import_job import (
    InboxImportJob,
    InboxImportJobStatus,
    InboxImportKind,
)
from app.db.repositories.asset import AssetRepository
from app.db.repositories.inbox_import_job import InboxImportJobRepository
from app.exceptions import ValidationError
from app.services.aws_clients import get_s3_client
from app.services.meta_graph_client import MetaGraphApiError
from app.services.meta_history_sync import sync_meta_channel_history
from app.services.whatsapp_export_import import import_parsed_whatsapp_chats
from app.services.whatsapp_export_parse import parse_whatsapp_export
from app.utils.logging import get_logger

logger = get_logger(__name__)

_SYSTEM_ACTOR = "system:inbox-import"


@dataclass(frozen=True)
class InboxImportOutcome:
    """Worker result that tells SQS whether to ack the message."""

    ack_sqs_message: bool


def _lambda_timeout_seconds() -> int:
    raw = os.environ.get("INBOX_IMPORT_LAMBDA_TIMEOUT_SECONDS", "600").strip()
    try:
        return max(60, int(raw))
    except ValueError:
        return 600


def _processing_stale_threshold() -> timedelta:
    return timedelta(seconds=_lambda_timeout_seconds() * 2 + 120)


def process_inbox_import_job(job_id: UUID) -> InboxImportOutcome:
    """Run one inbox import job to a terminal status."""
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=_SYSTEM_ACTOR, request_id=str(job_id))
        repo = InboxImportJobRepository(session)
        job = repo.get_by_id(job_id)
        if job is None:
            logger.warning("Inbox import job missing", extra={"job_id": str(job_id)})
            return InboxImportOutcome(ack_sqs_message=True)
        if job.status in {
            InboxImportJobStatus.SUCCEEDED,
            InboxImportJobStatus.SUCCEEDED_WITH_ERRORS,
        }:
            return InboxImportOutcome(ack_sqs_message=True)
        if job.status is InboxImportJobStatus.PROCESSING:
            age = datetime.now(UTC) - (job.updated_at or job.created_at)
            if age < _processing_stale_threshold():
                return InboxImportOutcome(ack_sqs_message=False)
        repo.mark_processing(job)
        session.commit()

    try:
        counters = _run_job(job_id)
    except ValidationError as exc:
        _fail_job(job_id, str(exc))
        return InboxImportOutcome(ack_sqs_message=True)
    except MetaGraphApiError as exc:
        _fail_job(job_id, str(exc))
        return InboxImportOutcome(ack_sqs_message=True)
    except Exception:
        logger.exception("Inbox import job failed", extra={"job_id": str(job_id)})
        _fail_job(job_id, "Inbox import failed. Try again shortly.")
        return InboxImportOutcome(ack_sqs_message=True)

    skipped = int(counters.get("skipped") or 0) + int(
        counters.get("skipped_no_wa_id") or 0
    )
    status = (
        InboxImportJobStatus.SUCCEEDED_WITH_ERRORS
        if skipped
        else InboxImportJobStatus.SUCCEEDED
    )
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=_SYSTEM_ACTOR, request_id=str(job_id))
        repo = InboxImportJobRepository(session)
        job = repo.get_by_id(job_id)
        if job is not None:
            repo.mark_finished(job, status=status, counters=counters)
            session.commit()
    return InboxImportOutcome(ack_sqs_message=True)


def _run_job(job_id: UUID) -> dict[str, int]:
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=_SYSTEM_ACTOR, request_id=str(job_id))
        job = InboxImportJobRepository(session).get_by_id(job_id)
        if job is None:
            raise ValidationError("Inbox import job was not found", field="id")
        if job.kind is InboxImportKind.META_GRAPH:
            if job.channel is None:
                raise ValidationError("channel is required", field="channel")
            counters = sync_meta_channel_history(session, job.channel)
            session.commit()
            return counters
        if job.kind is InboxImportKind.WHATSAPP_EXPORT:
            counters = _run_whatsapp_export(session, job)
            session.commit()
            return counters
        raise ValidationError("Unsupported inbox import kind", field="kind")


def _run_whatsapp_export(session: Session, job: InboxImportJob) -> dict[str, int]:
    if job.attachment_asset_id is None:
        raise ValidationError(
            "attachment_asset_id is required", field="attachment_asset_id"
        )
    asset = AssetRepository(session).get_by_id(job.attachment_asset_id)
    if asset is None:
        raise ValidationError("Export asset was not found", field="attachment_asset_id")
    bucket = os.getenv("ASSETS_BUCKET_NAME", "").strip()
    if not bucket:
        raise ValidationError("Assets bucket is not configured", field="configuration")
    response = get_s3_client().get_object(Bucket=bucket, Key=asset.s3_key)
    body = response["Body"].read()
    chats = parse_whatsapp_export(
        body,
        filename=asset.file_name,
        content_type=asset.content_type,
    )
    options = job.options if isinstance(job.options, dict) else {}
    names_raw = options.get("business_display_names")
    names = [str(item) for item in names_raw] if isinstance(names_raw, list) else []
    counterparty = options.get("counterparty_wa_id")
    return import_parsed_whatsapp_chats(
        session,
        chats,
        counterparty_wa_id=str(counterparty) if counterparty else None,
        business_display_names=names,
    )


def _fail_job(job_id: UUID, message: str) -> None:
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=_SYSTEM_ACTOR, request_id=str(job_id))
        repo = InboxImportJobRepository(session)
        job = repo.get_by_id(job_id)
        if job is not None:
            repo.mark_failed(job, message[:8000])
            session.commit()
