"""Admin inbox import job handlers (Meta Graph + WhatsApp export)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import parse_body, parse_limit, parse_uuid, query_param
from app.db.engine import get_engine
from app.db.models.enums import MetaChannel
from app.db.models.inbox_import_job import (
    InboxImportJob,
    InboxImportJobStatus,
    InboxImportKind,
)
from app.db.repositories.asset import AssetRepository
from app.db.repositories.inbox_import_job import InboxImportJobRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.inbox_import_events import enqueue_inbox_import_job
from app.utils import json_response
from app.utils.logging import get_logger

logger = get_logger(__name__)

_DEFAULT_LIMIT = 25
_MAX_LIMIT = 100
_EXPORT_CONTENT_TYPES = frozenset(
    {
        "text/plain",
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
    }
)


def handle_meta_import_jobs(
    event: Mapping[str, Any],
    method: str,
    parts: list[str],
    *,
    actor_sub: str,
) -> dict[str, Any] | None:
    """Dispatch ``/v1/admin/meta/import-jobs`` routes, or None if unmatched."""
    if len(parts) == 3 and parts[2] == "import-jobs":
        if method == "GET":
            return _list_jobs(event, kind=InboxImportKind.META_GRAPH)
        if method == "POST":
            return _create_meta_job(event, actor_sub=actor_sub)
        return json_response(405, {"error": "Method not allowed"}, event=event)
    if len(parts) == 4 and parts[2] == "import-jobs":
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _get_job(
            event,
            job_id=parse_uuid(parts[3]),
            kind=InboxImportKind.META_GRAPH,
        )
    return None


def handle_whatsapp_import_jobs(
    event: Mapping[str, Any],
    method: str,
    parts: list[str],
    *,
    actor_sub: str,
) -> dict[str, Any] | None:
    """Dispatch ``/v1/admin/whatsapp/import-jobs`` routes, or None if unmatched."""
    if len(parts) == 3 and parts[2] == "import-jobs":
        if method == "GET":
            return _list_jobs(event, kind=InboxImportKind.WHATSAPP_EXPORT)
        if method == "POST":
            return _create_whatsapp_job(event, actor_sub=actor_sub)
        return json_response(405, {"error": "Method not allowed"}, event=event)
    if len(parts) == 4 and parts[2] == "import-jobs":
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _get_job(
            event,
            job_id=parse_uuid(parts[3]),
            kind=InboxImportKind.WHATSAPP_EXPORT,
        )
    return None


def _create_meta_job(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    body = parse_body(event)
    channel = _parse_channel(body.get("channel"))
    return _enqueue_job(
        event,
        actor_sub=actor_sub,
        kind=InboxImportKind.META_GRAPH,
        channel=channel,
    )


def _create_whatsapp_job(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    body = parse_body(event)
    attachment_id = _parse_required_uuid(
        body.get("attachment_asset_id") or body.get("attachmentAssetId"),
        field="attachment_asset_id",
    )
    counterparty = body.get("counterparty_wa_id") or body.get("counterpartyWaId")
    names_raw = body.get("business_display_names") or body.get("businessDisplayNames")
    names: list[str] = []
    if names_raw is not None:
        if not isinstance(names_raw, list):
            raise ValidationError(
                "business_display_names must be an array of strings",
                field="business_display_names",
            )
        names = [str(item).strip() for item in names_raw if str(item).strip()]
    options: dict[str, Any] = {}
    if isinstance(counterparty, str) and counterparty.strip():
        options["counterparty_wa_id"] = "".join(
            char for char in counterparty if char.isdigit()
        )
    if names:
        options["business_display_names"] = names
    with Session(get_engine()) as session:
        _assert_export_asset(session, attachment_id)
    return _enqueue_job(
        event,
        actor_sub=actor_sub,
        kind=InboxImportKind.WHATSAPP_EXPORT,
        attachment_asset_id=attachment_id,
        options=options or None,
    )


def _enqueue_job(
    event: Mapping[str, Any],
    *,
    actor_sub: str,
    kind: InboxImportKind,
    channel: MetaChannel | None = None,
    attachment_asset_id: UUID | None = None,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        job = InboxImportJob(
            created_by=actor_sub,
            kind=kind,
            channel=channel,
            attachment_asset_id=attachment_asset_id,
            options=options,
            status=InboxImportJobStatus.PENDING,
        )
        session.add(job)
        session.flush()
        job_id = job.id
        summary = _serialize_job(job)
        session.commit()
    try:
        enqueue_inbox_import_job(job_id)
    except ValidationError:
        _delete_job(job_id)
        raise
    except Exception:
        logger.exception(
            "Failed to enqueue inbox import job", extra={"job_id": str(job_id)}
        )
        _fail_enqueue(job_id)
        raise ValidationError(
            "Inbox import could not be queued; try again shortly.",
            field="configuration",
        ) from None
    return json_response(
        202,
        {"inbox_import_job": summary},
        event=event,
    )


def _list_jobs(event: Mapping[str, Any], *, kind: InboxImportKind) -> dict[str, Any]:
    limit = parse_limit(event, default=_DEFAULT_LIMIT, max_limit=_MAX_LIMIT)
    cursor_raw = query_param(event, "cursor")
    cursor = parse_uuid(cursor_raw) if cursor_raw else None
    with Session(get_engine()) as session:
        repo = InboxImportJobRepository(session)
        rows = repo.list_for_kind(kind=kind, limit=limit + 1, cursor_job_id=cursor)
        has_more = len(rows) > limit
        page = rows[:limit]
        return json_response(
            200,
            {
                "items": [_serialize_job(row) for row in page],
                "next_cursor": str(page[-1].id) if has_more and page else None,
                "total_count": repo.count_for_kind(kind=kind),
            },
            event=event,
        )


def _get_job(
    event: Mapping[str, Any], *, job_id: UUID, kind: InboxImportKind
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        job = InboxImportJobRepository(session).get_by_id(job_id)
        if job is None or job.kind is not kind:
            raise NotFoundError("InboxImportJob", str(job_id))
        return json_response(
            200, {"inbox_import_job": _serialize_job(job)}, event=event
        )


def _assert_export_asset(session: Session, asset_id: UUID) -> None:
    asset = AssetRepository(session).get_by_id(asset_id)
    if asset is None:
        raise ValidationError("Export asset was not found", field="attachment_asset_id")
    content_type = (asset.content_type or "").split(";", 1)[0].strip().lower()
    filename = (asset.file_name or "").lower()
    if content_type in _EXPORT_CONTENT_TYPES:
        return
    if filename.endswith(".txt") or filename.endswith(".zip"):
        return
    raise ValidationError(
        "Export must be a .txt or .zip WhatsApp chat export",
        field="attachment_asset_id",
    )


def _parse_channel(raw_value: Any) -> MetaChannel:
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise ValidationError("channel is required", field="channel")
    try:
        return MetaChannel(raw_value.strip().lower())
    except ValueError as exc:
        raise ValidationError(
            "channel must be facebook or instagram", field="channel"
        ) from exc


def _parse_required_uuid(raw_value: Any, *, field: str) -> UUID:
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise ValidationError(f"{field} is required", field=field)
    return parse_uuid(raw_value)


def _serialize_job(job: InboxImportJob) -> dict[str, Any]:
    return {
        "id": str(job.id),
        "kind": job.kind.value,
        "channel": job.channel.value if job.channel is not None else None,
        "attachment_asset_id": (
            str(job.attachment_asset_id) if job.attachment_asset_id else None
        ),
        "status": job.status.value,
        "error_message": job.error_message,
        "counters": job.counters,
        "created_at": _isoformat(job.created_at),
        "updated_at": _isoformat(job.updated_at),
    }


def _delete_job(job_id: UUID) -> None:
    with Session(get_engine()) as session:
        job = session.get(InboxImportJob, job_id)
        if job is not None:
            session.delete(job)
            session.commit()


def _fail_enqueue(job_id: UUID) -> None:
    with Session(get_engine()) as session:
        repo = InboxImportJobRepository(session)
        job = repo.get_by_id(job_id)
        if job is not None:
            repo.mark_failed(job, "Could not queue inbox import; try again shortly.")
            session.commit()


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()
