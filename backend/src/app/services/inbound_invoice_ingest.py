"""Business logic for storing invoice emails as expenses."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.api.assets.assets_storage import build_s3_key
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import (
    AssetType,
    AssetVisibility,
    ExpenseParseStatus,
    ExpenseStatus,
    InboundEmail,
    InboundEmailStatus,
)
from app.db.repositories import (
    AssetRepository,
    ExpenseRepository,
    InboundEmailRepository,
    OrganizationRepository,
)
from app.services.aws_clients import get_s3_client
from app.services.expense_events import enqueue_expense_parse
from app.services.inbound_invoice_allowlist import inbound_invoice_sender_is_allowed
from app.services.inbound_email import (
    EMAIL_INVOICE_BODY_FILE_NAME,
    InvoiceAttachment,
    ParsedInboundEmail,
    invoice_attachments_for_ingest,
    parse_raw_email,
)
from app.utils import require_env
from app.utils.logging import get_logger, mask_email

logger = get_logger(__name__)

_SYSTEM_ACTOR = "system"
_MAX_ASSET_TITLE_LENGTH = 255
_MAX_EXPENSE_NOTES_LENGTH = 5000
_SENDER_NOT_ALLOWLISTED_REASON = (
    "Sender address is not allowlisted for inbound invoice processing"
)


@dataclass(frozen=True)
class InboundInvoiceEmailEvent:
    """Normalized SES receipt event for an inbound invoice email."""

    ses_message_id: str
    recipient: str
    source_email: str | None
    subject: str | None
    received_at: datetime
    raw_s3_bucket: str
    raw_s3_key: str
    spam_status: str | None = None
    virus_status: str | None = None
    spf_status: str | None = None
    dkim_status: str | None = None
    dmarc_status: str | None = None


@dataclass(frozen=True)
class InboundInvoiceProcessResult:
    """Summary of an inbound invoice processing attempt."""

    status: InboundEmailStatus
    expense_id: UUID | None = None


def process_inbound_invoice_email(
    event: InboundInvoiceEmailEvent,
) -> InboundInvoiceProcessResult:
    """Persist an inbound invoice email and enqueue parser work if needed."""
    existing_record = _get_tracking_record(event.ses_message_id)
    if existing_record is not None and existing_record.expense_id is not None:
        expense_id = cast(UUID, existing_record.expense_id)
        _ensure_parse_requested(expense_id)
        return InboundInvoiceProcessResult(
            status=InboundEmailStatus.STORED,
            expense_id=expense_id,
        )
    if _should_skip_email(event):
        _upsert_tracking_record(event, status=InboundEmailStatus.SKIPPED)
        return InboundInvoiceProcessResult(status=InboundEmailStatus.SKIPPED)

    _upsert_tracking_record(event, status=InboundEmailStatus.PROCESSING)
    raw_email = _load_raw_email(event.raw_s3_bucket, event.raw_s3_key)
    parsed_email = parse_raw_email(raw_email)
    if not inbound_invoice_sender_is_allowed(
        envelope_from=event.source_email,
        header_from=parsed_email.from_email,
    ):
        _upsert_tracking_record(
            event,
            status=InboundEmailStatus.FAILED,
            parsed_email=parsed_email,
            failure_reason=_SENDER_NOT_ALLOWLISTED_REASON,
        )
        logger.info(
            "Inbound invoice email rejected by sender allowlist",
            extra={
                "ses_message_id": event.ses_message_id,
                "source_email_masked": mask_email(
                    parsed_email.from_email or event.source_email or ""
                ),
            },
        )
        return InboundInvoiceProcessResult(status=InboundEmailStatus.FAILED)

    source_email = parsed_email.from_email or event.source_email
    invoice_attachments = invoice_attachments_for_ingest(parsed_email)
    if not invoice_attachments:
        _upsert_tracking_record(
            event,
            status=InboundEmailStatus.FAILED,
            parsed_email=parsed_email,
            failure_reason=(
                "Inbound email does not include supported invoice attachments "
                "or enough body text to parse"
            ),
        )
        logger.info(
            "Inbound invoice email skipped without attachments or parseable body",
            extra={
                "ses_message_id": event.ses_message_id,
                "source_email_masked": mask_email(source_email or ""),
            },
        )
        return InboundInvoiceProcessResult(status=InboundEmailStatus.FAILED)

    expense_id = _store_expense_from_email(
        event=event,
        parsed_email=parsed_email,
        invoice_attachments=invoice_attachments,
    )

    _ensure_parse_requested(expense_id)
    logger.info(
        "Stored inbound invoice email",
        extra={
            "ses_message_id": event.ses_message_id,
            "expense_id": str(expense_id),
            "attachment_count": len(invoice_attachments),
            "source_email_masked": mask_email(source_email or ""),
        },
    )
    return InboundInvoiceProcessResult(
        status=InboundEmailStatus.STORED,
        expense_id=expense_id,
    )


def _store_expense_from_email(
    *,
    event: InboundInvoiceEmailEvent,
    parsed_email: ParsedInboundEmail,
    invoice_attachments: list[InvoiceAttachment],
) -> UUID:
    assets_bucket = require_env("ASSETS_BUCKET_NAME")
    uploaded_objects: list[str] = []
    s3_client = get_s3_client()

    with Session(get_engine()) as session:
        set_audit_context(
            session, user_id=_SYSTEM_ACTOR, request_id=event.ses_message_id
        )
        inbound_repo = InboundEmailRepository(session)
        asset_repo = AssetRepository(session)
        expense_repo = ExpenseRepository(session)
        vendor_id = _resolve_inbound_vendor_id(session, parsed_email)
        if vendor_id is None:
            logger.info(
                "Inbound invoice vendor unresolved; creating expense without vendor",
                extra={
                    "ses_message_id": event.ses_message_id,
                    "source_email_masked": mask_email(
                        parsed_email.from_email or event.source_email or ""
                    ),
                },
            )

        expense = expense_repo.create_expense(
            created_by=_SYSTEM_ACTOR,
            status=ExpenseStatus.SUBMITTED,
            parse_status=ExpenseParseStatus.NOT_REQUESTED,
            vendor_id=vendor_id,
            notes=_build_expense_notes(event, parsed_email),
        )
        expense.submitted_at = event.received_at
        asset_ids: list[UUID] = []

        try:
            for attachment in invoice_attachments:
                asset_id = uuid4()
                s3_key = build_s3_key(asset_id, attachment.file_name)
                s3_client.put_object(
                    Bucket=assets_bucket,
                    Key=s3_key,
                    Body=attachment.data,
                    ContentType=attachment.content_type,
                )
                uploaded_objects.append(s3_key)
                asset_repo.create_asset(
                    asset_id=asset_id,
                    title=_build_asset_title(attachment.file_name),
                    description=(
                        "Invoice text extracted from inbound email body"
                        if attachment.file_name == EMAIL_INVOICE_BODY_FILE_NAME
                        else "Imported from inbound invoice email"
                    ),
                    asset_type=_asset_type_for_attachment(attachment),
                    s3_key=s3_key,
                    file_name=attachment.file_name,
                    resource_key=None,
                    content_type=attachment.content_type,
                    content_language=None,
                    visibility=AssetVisibility.RESTRICTED,
                    created_by=_SYSTEM_ACTOR,
                )
                asset_ids.append(asset_id)

            expense_repo.replace_attachments(expense, asset_ids)
            tracking = inbound_repo.find_by_ses_message_id(event.ses_message_id)
            if tracking is None:
                tracking = _new_tracking_record(
                    event,
                    parsed_email=parsed_email,
                    status=InboundEmailStatus.STORED,
                )
                inbound_repo.create(tracking)
            else:
                _apply_tracking_update(
                    tracking,
                    event=event,
                    parsed_email=parsed_email,
                    status=InboundEmailStatus.STORED,
                )
            tracking.expense_id = expense.id
            tracking.failure_reason = None
            inbound_repo.update(tracking)
            session.commit()
            return cast(UUID, expense.id)
        except Exception:
            session.rollback()
            _cleanup_uploaded_objects(uploaded_objects)
            raise


def _ensure_parse_requested(expense_id: UUID) -> None:
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=_SYSTEM_ACTOR, request_id=str(expense_id))
        repository = ExpenseRepository(session)
        expense = repository.get_with_attachments(expense_id)
        if expense is None:
            return
        if expense.parse_status != ExpenseParseStatus.NOT_REQUESTED:
            return

    enqueue_expense_parse(expense_id)

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=_SYSTEM_ACTOR, request_id=str(expense_id))
        repository = ExpenseRepository(session)
        expense = repository.get_with_attachments(expense_id)
        if expense is None:
            return
        if expense.parse_status != ExpenseParseStatus.NOT_REQUESTED:
            return
        expense.parse_status = ExpenseParseStatus.QUEUED
        expense.updated_by = _SYSTEM_ACTOR
        repository.update(expense)
        session.commit()


def _get_tracking_record(ses_message_id: str) -> InboundEmail | None:
    with Session(get_engine()) as session:
        repository = InboundEmailRepository(session)
        return repository.find_by_ses_message_id(ses_message_id)


def _upsert_tracking_record(
    event: InboundInvoiceEmailEvent,
    *,
    status: InboundEmailStatus,
    parsed_email: ParsedInboundEmail | None = None,
    failure_reason: str | None = None,
) -> None:
    with Session(get_engine()) as session:
        set_audit_context(
            session, user_id=_SYSTEM_ACTOR, request_id=event.ses_message_id
        )
        repository = InboundEmailRepository(session)
        tracking = repository.find_by_ses_message_id(event.ses_message_id)
        if tracking is None:
            tracking = _new_tracking_record(
                event,
                parsed_email=parsed_email,
                status=status,
            )
            tracking.failure_reason = failure_reason
            repository.create(tracking)
        else:
            _apply_tracking_update(
                tracking,
                event=event,
                parsed_email=parsed_email,
                status=status,
            )
            tracking.failure_reason = failure_reason
            repository.update(tracking)
        session.commit()


def _new_tracking_record(
    event: InboundInvoiceEmailEvent,
    *,
    parsed_email: ParsedInboundEmail | None,
    status: InboundEmailStatus,
) -> InboundEmail:
    return InboundEmail(
        ses_message_id=event.ses_message_id,
        recipient=event.recipient,
        source_email=_resolved_source_email(event, parsed_email),
        subject=_resolved_subject(event, parsed_email),
        received_at=event.received_at,
        raw_s3_bucket=event.raw_s3_bucket,
        raw_s3_key=event.raw_s3_key,
        spam_status=event.spam_status,
        virus_status=event.virus_status,
        spf_status=event.spf_status,
        dkim_status=event.dkim_status,
        dmarc_status=event.dmarc_status,
        processing_status=status.value,
    )


def _apply_tracking_update(
    tracking: InboundEmail,
    *,
    event: InboundInvoiceEmailEvent,
    parsed_email: ParsedInboundEmail | None,
    status: InboundEmailStatus,
) -> None:
    tracking.recipient = event.recipient
    tracking.source_email = _resolved_source_email(event, parsed_email)
    tracking.subject = _resolved_subject(event, parsed_email)
    tracking.received_at = event.received_at
    tracking.raw_s3_bucket = event.raw_s3_bucket
    tracking.raw_s3_key = event.raw_s3_key
    tracking.spam_status = event.spam_status
    tracking.virus_status = event.virus_status
    tracking.spf_status = event.spf_status
    tracking.dkim_status = event.dkim_status
    tracking.dmarc_status = event.dmarc_status
    tracking.processing_status = status.value


def _resolved_source_email(
    event: InboundInvoiceEmailEvent,
    parsed_email: ParsedInboundEmail | None,
) -> str | None:
    if parsed_email is not None and parsed_email.from_email:
        return parsed_email.from_email
    return event.source_email


def _resolved_subject(
    event: InboundInvoiceEmailEvent,
    parsed_email: ParsedInboundEmail | None,
) -> str | None:
    if parsed_email is not None and parsed_email.subject:
        return parsed_email.subject
    return event.subject


def _load_raw_email(bucket: str, key: str) -> bytes:
    response = get_s3_client().get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def _should_skip_email(event: InboundInvoiceEmailEvent) -> bool:
    verdicts = {event.spam_status, event.virus_status}
    return any(status is not None and status.upper() == "FAIL" for status in verdicts)


def _cleanup_uploaded_objects(s3_keys: list[str]) -> None:
    if not s3_keys:
        return
    bucket_name = require_env("ASSETS_BUCKET_NAME")
    s3_client = get_s3_client()
    for s3_key in s3_keys:
        try:
            s3_client.delete_object(Bucket=bucket_name, Key=s3_key)
        except Exception:
            logger.warning(
                "Failed to clean up uploaded asset object", extra={"s3_key": s3_key}
            )


def _resolve_inbound_vendor_id(
    session: Session, parsed_email: ParsedInboundEmail
) -> UUID | None:
    """Match sender display name or email local-part to a unique active vendor."""
    org_repo = OrganizationRepository(session)
    candidates: list[str] = []
    if parsed_email.from_name:
        candidates.append(parsed_email.from_name.strip())
    if parsed_email.from_email and "@" in parsed_email.from_email:
        local = parsed_email.from_email.split("@", 1)[0].strip()
        if local:
            candidates.append(local)
    seen: set[str] = set()
    for raw in candidates:
        if not raw or raw in seen:
            continue
        seen.add(raw)
        matched = org_repo.try_resolve_active_vendor_by_parsed_name(raw)
        if matched is not None:
            return matched.id
    return None


def _build_asset_title(file_name: str) -> str:
    stem = Path(file_name).stem.strip()
    if not stem:
        return "Invoice attachment"
    return stem[:_MAX_ASSET_TITLE_LENGTH]


def _asset_type_for_attachment(attachment: InvoiceAttachment) -> AssetType:
    return attachment.asset_type


def _build_expense_notes(
    event: InboundInvoiceEmailEvent,
    parsed_email: ParsedInboundEmail,
) -> str:
    lines = [
        "Imported from inbound invoice email.",
        f"SES message id: {event.ses_message_id}",
    ]
    source_email = parsed_email.from_email or event.source_email
    if source_email:
        lines.append(f"Sender: {source_email}")
    if parsed_email.subject or event.subject:
        lines.append(f"Subject: {parsed_email.subject or event.subject}")
    lines.append(f"Recipient: {event.recipient}")
    lines.append(f"Received at: {event.received_at.isoformat()}")
    notes = "\n".join(lines)
    return notes[:_MAX_EXPENSE_NOTES_LENGTH]
