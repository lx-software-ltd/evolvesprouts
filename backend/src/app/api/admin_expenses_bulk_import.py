"""Admin bulk expense import handlers.

Covers ``/v1/admin/expenses/import-from-bulk-pdf`` and
``/v1/admin/expenses/bulk-import-jobs``.
"""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_expenses_common import (
    optional_field,
    parse_optional_status,
    parse_optional_uuid,
    resolve_vendor,
    serialize_expense,
)
from app.api.admin_request import (
    encode_cursor,
    parse_body,
    parse_cursor,
    parse_limit,
    query_param,
    request_id,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import ExpenseStatus
from app.db.models.bulk_expense_import_job import (
    BulkExpenseImportJob,
    BulkExpenseImportJobStatus,
)
from app.db.repositories import ExpenseRepository
from app.db.repositories.bulk_expense_import_job import BulkExpenseImportJobRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.bulk_expense_import_common import assert_pdf_asset
from app.services.bulk_expense_import_events import enqueue_bulk_expense_import_job
from app.services.bulk_expense_import_runner import sanitize_bulk_import_error_message
from app.utils import json_response
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _serialize_bulk_import_job_summary(job: BulkExpenseImportJob) -> dict[str, Any]:
    err = job.error_message
    return {
        "id": str(job.id),
        "status": job.status.value,
        "error_message": (
            None if err is None else sanitize_bulk_import_error_message(err)
        ),
        "created_count": job.created_count,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "attachment_asset_id": str(job.attachment_asset_id),
        "default_vendor_id": str(job.default_vendor_id),
        "expense_status": job.expense_status.value,
    }


def _list_bulk_expense_import_jobs(
    event: Mapping[str, Any], *, actor_sub: str
) -> dict[str, Any]:
    limit = parse_limit(event)
    cursor = parse_cursor(query_param(event, "cursor"))
    req_id = request_id(event)
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=req_id)
        job_repo = BulkExpenseImportJobRepository(session)
        rows = job_repo.list_for_actor(
            actor_sub=actor_sub, limit=limit + 1, cursor_job_id=cursor
        )
        has_more = len(rows) > limit
        page_items = rows[:limit]
        next_cursor = (
            encode_cursor(page_items[-1].id) if has_more and page_items else None
        )
        total_count = job_repo.count_for_actor(actor_sub=actor_sub)
        return json_response(
            200,
            {
                "items": [
                    _serialize_bulk_import_job_summary(row) for row in page_items
                ],
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _import_expenses_from_bulk_pdf(
    event: Mapping[str, Any], *, actor_sub: str
) -> dict[str, Any]:
    """Queue a combined PDF for async OpenRouter bulk parse (returns job id)."""
    logger.info("Bulk importing expenses from PDF", extra={"actor": actor_sub})
    body = parse_body(event)
    attachment_id = parse_optional_uuid(
        optional_field(body, "attachment_asset_id", "attachmentAssetId"),
        field="attachment_asset_id",
    )
    if attachment_id is None:
        raise ValidationError(
            "attachment_asset_id is required", field="attachment_asset_id"
        )
    default_vendor_id = parse_optional_uuid(
        optional_field(body, "default_vendor_id", "defaultVendorId"),
        field="default_vendor_id",
    )
    if default_vendor_id is None:
        raise ValidationError(
            "default_vendor_id is required", field="default_vendor_id"
        )
    status = (
        parse_optional_status(optional_field(body, "status")) or ExpenseStatus.SUBMITTED
    )

    req_id = request_id(event)

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=req_id)
        resolve_vendor(session, default_vendor_id)
        assert_pdf_asset(session, attachment_id)

        job = BulkExpenseImportJob(
            created_by=actor_sub,
            attachment_asset_id=attachment_id,
            default_vendor_id=default_vendor_id,
            expense_status=status,
            status=BulkExpenseImportJobStatus.PENDING,
        )
        session.add(job)
        session.flush()
        job_id = job.id
        session.commit()

    try:
        enqueue_bulk_expense_import_job(job_id)
    except ValidationError:
        with Session(get_engine()) as session:
            stale = session.get(BulkExpenseImportJob, job_id)
            if stale is not None:
                session.delete(stale)
                session.commit()
        raise
    except Exception:
        logger.exception(
            "Failed to enqueue bulk expense import job",
            extra={"job_id": str(job_id)},
        )
        with Session(get_engine()) as session:
            job_repo = BulkExpenseImportJobRepository(session)
            failed = job_repo.get_by_id(job_id)
            if failed is not None:
                job_repo.mark_failed(
                    failed, "Could not queue bulk import; try again shortly."
                )
                session.commit()
        raise ValidationError(
            "Bulk import could not be queued; try again shortly.",
            field="configuration",
        ) from None

    return json_response(
        202,
        {
            "bulk_import_job": {
                "id": str(job_id),
                "status": BulkExpenseImportJobStatus.PENDING.value,
                "error_message": None,
                "created_count": None,
                "expenses": None,
            }
        },
        event=event,
    )


def _delete_bulk_expense_import_job(
    event: Mapping[str, Any], *, job_id: UUID, actor_sub: str
) -> dict[str, Any]:
    logger.info(
        "Deleting bulk expense import job",
        extra={"job_id": str(job_id), "actor": actor_sub},
    )
    req_id = request_id(event)
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=req_id)
        job_repo = BulkExpenseImportJobRepository(session)
        job = job_repo.get_for_actor(job_id, actor_sub=actor_sub)
        if job is None:
            raise NotFoundError("BulkExpenseImportJob", str(job_id))
        session.delete(job)
        session.commit()
    return json_response(204, {}, event=event)


def _get_bulk_expense_import_job(
    event: Mapping[str, Any], *, job_id: UUID, actor_sub: str
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        job_repo = BulkExpenseImportJobRepository(session)
        job = job_repo.get_for_actor(job_id, actor_sub=actor_sub)
        if job is None:
            raise NotFoundError("BulkExpenseImportJob", str(job_id))

        expenses_payload: list[dict[str, Any]] | None = None
        if job.created_expense_ids and job.status in (
            BulkExpenseImportJobStatus.SUCCEEDED,
            BulkExpenseImportJobStatus.SUCCEEDED_WITH_ERRORS,
        ):
            expense_repo = ExpenseRepository(session)
            ordered_ids: list[UUID] = []
            for raw_id in job.created_expense_ids:
                try:
                    ordered_ids.append(UUID(str(raw_id)))
                except (TypeError, ValueError):
                    continue
            loaded = expense_repo.get_many_with_attachments(ordered_ids)
            expenses_payload = [serialize_expense(row) for row in loaded]

        err = job.error_message
        return json_response(
            200,
            {
                "bulk_import_job": {
                    "id": str(job.id),
                    "status": job.status.value,
                    "error_message": (
                        None if err is None else sanitize_bulk_import_error_message(err)
                    ),
                    "created_count": job.created_count,
                    "expenses": expenses_payload,
                }
            },
            event=event,
        )
