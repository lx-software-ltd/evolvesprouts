"""Admin completion certificate API handlers."""

from __future__ import annotations

import time
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.admin_request import (
    encode_created_cursor,
    parse_body,
    parse_created_cursor,
    parse_limit,
    parse_uuid,
    query_param,
    require_admin_identity,
    split_route_parts,
)
from app.api.admin_services_payload_utils import parse_optional_uuid
from app.api.assets.assets_storage import (
    delete_s3_object,
    generate_download_url,
    signed_link_no_cache_headers,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import CompletionCertificate, Contact, Service, ServiceInstance
from app.db.models.enums import CompletionCertificateStatus
from app.exceptions import NotFoundError, ValidationError
from app.services.completion_certificate_common import (
    create_issued_certificate,
    load_certificate_for_pdf,
    render_draft_pdf_bytes,
    resolve_certificate_draft,
    upload_preview_pdf,
)
from app.utils import json_response, method_not_allowed, not_found
from app.utils.logging import get_logger

logger = get_logger(__name__)

_DEFAULT_LIMIT = 25
_CERTIFICATE_DOWNLOAD_LINK_EXPIRY = timedelta(hours=1)


def _parse_required_uuid(value: Any, *, field: str) -> UUID:
    parsed = parse_optional_uuid(value, field)
    if parsed is None:
        raise ValidationError(f"{field} is required", field=field)
    return parsed


def handle_admin_completion_certificates_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/completion-certificates routes."""
    logger.info(
        "Handling admin completion-certificates route",
        extra={"method": method, "path": path},
    )
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "completion-certificates":
        return not_found(event)

    identity = require_admin_identity(event)

    if len(parts) == 3 and parts[2] == "preview":
        if method == "POST":
            return _preview_certificate(event)
        return method_not_allowed(event)

    if len(parts) == 2:
        if method == "GET":
            return _list_certificates(event)
        if method == "POST":
            return _issue_certificate(event, actor_sub=identity.user_sub)
        return method_not_allowed(event)

    certificate_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return _get_certificate(event, certificate_id=certificate_id)
        if method == "DELETE":
            return _delete_certificate(
                event, certificate_id=certificate_id, actor_sub=identity.user_sub
            )
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "pdf" and method == "GET":
        return _get_certificate_pdf(event, certificate_id=certificate_id)

    if len(parts) == 4 and parts[3] == "void" and method == "POST":
        return _void_certificate(
            event, certificate_id=certificate_id, actor_sub=identity.user_sub
        )

    return not_found(event)


def _parse_issue_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    contact_id = _parse_required_uuid(body.get("contact_id"), field="contact_id")
    service_id = _parse_required_uuid(body.get("service_id"), field="service_id")
    instance_id = _parse_required_uuid(body.get("instance_id"), field="instance_id")
    participation_raw = body.get("participation_date")
    if not isinstance(participation_raw, str) or not participation_raw.strip():
        raise ValidationError(
            "participation_date is required", field="participation_date"
        )
    try:
        participation_date = date.fromisoformat(participation_raw.strip())
    except ValueError as exc:
        raise ValidationError(
            "participation_date must be YYYY-MM-DD",
            field="participation_date",
        ) from exc
    program_title = body.get("program_title")
    program_title_override = None
    if program_title is not None:
        if not isinstance(program_title, str):
            raise ValidationError(
                "program_title must be a string", field="program_title"
            )
        program_title_override = program_title.strip() or None
    partner_organization_id = parse_optional_uuid(
        body.get("partner_organization_id"),
        field="partner_organization_id",
    )
    return {
        "contact_id": contact_id,
        "service_id": service_id,
        "instance_id": instance_id,
        "participation_date": participation_date,
        "program_title_override": program_title_override,
        "partner_organization_id": partner_organization_id,
    }


def _preview_certificate(event: Mapping[str, Any]) -> dict[str, Any]:
    body = parse_body(event)
    payload = _parse_issue_payload(body)
    with Session(get_engine()) as session:
        draft = resolve_certificate_draft(
            session,
            contact_id=payload["contact_id"],
            service_id=payload["service_id"],
            instance_id=payload["instance_id"],
            participation_date=payload["participation_date"],
            program_title_override=payload["program_title_override"],
            partner_organization_id=payload["partner_organization_id"],
        )
        pdf_bytes = render_draft_pdf_bytes(draft)
        s3_key = upload_preview_pdf(pdf_bytes)
    download = generate_download_url(
        s3_key=s3_key,
        cache_bust_key=str(time.time_ns()),
        expires_at=datetime.now(UTC) + _CERTIFICATE_DOWNLOAD_LINK_EXPIRY,
    )
    return json_response(
        200,
        {
            "downloadUrl": download["download_url"],
            "expiresAt": download["expires_at"],
        },
        headers=signed_link_no_cache_headers(),
        event=event,
    )


def _issue_certificate(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    body = parse_body(event)
    payload = _parse_issue_payload(body)
    request_id = event.get("requestContext", {}).get("requestId")
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id)
        draft = resolve_certificate_draft(
            session,
            contact_id=payload["contact_id"],
            service_id=payload["service_id"],
            instance_id=payload["instance_id"],
            participation_date=payload["participation_date"],
            program_title_override=payload["program_title_override"],
            partner_organization_id=payload["partner_organization_id"],
        )
        cert = create_issued_certificate(session, draft=draft, actor_sub=actor_sub)
        session.commit()
        session.refresh(cert)
        serialized = serialize_completion_certificate(session, cert)
    return json_response(201, {"certificate": serialized}, event=event)


def _list_certificates(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event, default=_DEFAULT_LIMIT)
    cursor_ts, cursor_id = parse_created_cursor(query_param(event, "cursor"))
    contact_id = parse_optional_uuid(query_param(event, "contact_id"), "contact_id")
    instance_id = parse_optional_uuid(query_param(event, "instance_id"), "instance_id")
    service_id = parse_optional_uuid(query_param(event, "service_id"), "service_id")
    status_raw = query_param(event, "status")
    status_filter: CompletionCertificateStatus | None = None
    if status_raw:
        try:
            status_filter = CompletionCertificateStatus(status_raw.strip().lower())
        except ValueError as exc:
            raise ValidationError("Invalid status filter", field="status") from exc

    with Session(get_engine()) as session:
        stmt = select(CompletionCertificate).order_by(
            CompletionCertificate.issued_at.desc(),
            CompletionCertificate.id.desc(),
        )
        if contact_id is not None:
            stmt = stmt.where(CompletionCertificate.contact_id == contact_id)
        if instance_id is not None:
            stmt = stmt.where(CompletionCertificate.instance_id == instance_id)
        if service_id is not None:
            stmt = stmt.where(CompletionCertificate.service_id == service_id)
        if status_filter is not None:
            stmt = stmt.where(CompletionCertificate.status == status_filter)
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    CompletionCertificate.issued_at < cursor_ts,
                    (
                        (CompletionCertificate.issued_at == cursor_ts)
                        & (CompletionCertificate.id < cursor_id)
                    ),
                )
            )
        rows = list(session.execute(stmt.limit(limit + 1)).scalars().all())
        has_more = len(rows) > limit
        page = rows[:limit]
        items = [serialize_completion_certificate(session, row) for row in page]
        next_cursor = None
        if has_more and page:
            last = page[-1]
            next_cursor = encode_created_cursor(last.issued_at, last.id)
        return json_response(
            200,
            {
                "items": items,
                "next_cursor": next_cursor,
            },
            event=event,
        )


def _get_certificate(
    event: Mapping[str, Any], *, certificate_id: UUID
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        cert = session.get(CompletionCertificate, certificate_id)
        if cert is None:
            raise NotFoundError("CompletionCertificate", str(certificate_id))
        return json_response(
            200,
            {"certificate": serialize_completion_certificate(session, cert)},
            event=event,
        )


def _get_certificate_pdf(
    event: Mapping[str, Any], *, certificate_id: UUID
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        cert = load_certificate_for_pdf(session, certificate_id)
        download = generate_download_url(
            s3_key=cert.issued_pdf_s3_key or "",
            cache_bust_key=str(time.time_ns()),
            expires_at=datetime.now(UTC) + _CERTIFICATE_DOWNLOAD_LINK_EXPIRY,
        )
    return json_response(
        200,
        {
            "downloadUrl": download["download_url"],
            "expiresAt": download["expires_at"],
        },
        headers=signed_link_no_cache_headers(),
        event=event,
    )


def _void_certificate(
    event: Mapping[str, Any], *, certificate_id: UUID, actor_sub: str
) -> dict[str, Any]:
    request_id = event.get("requestContext", {}).get("requestId")
    s3_key = ""
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id)
        cert = session.get(CompletionCertificate, certificate_id)
        if cert is None:
            raise NotFoundError("CompletionCertificate", str(certificate_id))
        if cert.status == CompletionCertificateStatus.VOIDED:
            raise ValidationError("Certificate is already voided", field="id")
        s3_key = (cert.issued_pdf_s3_key or "").strip()
        cert.status = CompletionCertificateStatus.VOIDED
        cert.voided_at = datetime.now(UTC)
        cert.voided_by = actor_sub
        cert.issued_pdf_s3_key = None
        session.commit()
        session.refresh(cert)
        serialized = serialize_completion_certificate(session, cert)
    if s3_key:
        try:
            delete_s3_object(s3_key=s3_key)
        except Exception:
            logger.exception(
                "Failed to delete voided completion certificate PDF from S3",
                extra={"certificate_id": str(certificate_id)},
            )
    return json_response(200, {"certificate": serialized}, event=event)


def _delete_certificate(
    event: Mapping[str, Any], *, certificate_id: UUID, actor_sub: str
) -> dict[str, Any]:
    request_id = event.get("requestContext", {}).get("requestId")
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id)
        cert = session.get(CompletionCertificate, certificate_id)
        if cert is None:
            raise NotFoundError("CompletionCertificate", str(certificate_id))
        s3_key = (cert.issued_pdf_s3_key or "").strip()
        session.delete(cert)
        session.commit()
    if s3_key:
        try:
            delete_s3_object(s3_key=s3_key)
        except Exception:
            logger.exception(
                "Failed to delete completion certificate PDF from S3",
                extra={"certificate_id": str(certificate_id)},
            )
    return json_response(200, {"deleted": True}, event=event)


def serialize_completion_certificate(
    session: Session, cert: CompletionCertificate
) -> dict[str, Any]:
    contact = session.get(Contact, cert.contact_id)
    instance = session.get(ServiceInstance, cert.instance_id)
    service = session.get(Service, cert.service_id)
    contact_label = ""
    if contact:
        parts = [contact.first_name or "", contact.last_name or ""]
        contact_label = " ".join(p for p in parts if p).strip() or (contact.email or "")
    instance_label = instance.slug if instance else ""
    service_label = service.title if service else ""
    return {
        "id": str(cert.id),
        "contact_id": str(cert.contact_id),
        "contact_label": contact_label,
        "instance_id": str(cert.instance_id),
        "instance_label": instance_label,
        "service_id": str(cert.service_id),
        "service_label": service_label,
        "enrollment_id": str(cert.enrollment_id),
        "partner_organization_id": str(cert.partner_organization_id)
        if cert.partner_organization_id
        else None,
        "participation_date": cert.participation_date.isoformat(),
        "recipient_display_name": cert.recipient_display_name,
        "program_title": cert.program_title,
        "partner_display_name": cert.partner_display_name,
        "partner_signer_name": cert.partner_signer_name,
        "body_text": cert.body_text,
        "status": cert.status.value,
        "issued_at": cert.issued_at,
        "issued_by": cert.issued_by,
        "voided_at": cert.voided_at,
        "voided_by": cert.voided_by,
        "issued_pdf_sha256": cert.issued_pdf_sha256,
        "pdf_template_version": cert.pdf_template_version,
        "created_at": cert.created_at,
        "updated_at": cert.updated_at,
    }
