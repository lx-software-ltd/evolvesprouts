"""Shared completion certificate issue/preview helpers."""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    CompletionCertificate,
    Contact,
    Enrollment,
    Organization,
    OrganizationMember,
    ServiceInstance,
)
from app.db.models.contact import contact_full_name
from app.db.models.enums import CompletionCertificateStatus, EnrollmentStatus
from app.db.models.service_instance import ServiceInstancePartnerOrganization
from app.exceptions import NotFoundError, ValidationError
from app.services.completion_certificate_pdf import (
    COMPLETION_CERTIFICATE_PDF_TEMPLATE_VERSION,
    CompletionCertificatePdfContext,
    build_certificate_body_text,
    certificate_es_founder_name,
    certificate_trading_name,
    render_completion_certificate_pdf,
)
from app.services.customer_billing import store_pdf_in_assets_bucket


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def preview_pdf_s3_key() -> str:
    return f"completion-certificates/preview/{uuid.uuid4()}.pdf"


def issued_pdf_s3_key(certificate_id: UUID) -> str:
    return f"completion-certificates/{certificate_id}.pdf"


@dataclass(frozen=True)
class ResolvedCertificateDraft:
    contact_id: UUID
    instance_id: UUID
    service_id: UUID
    enrollment_id: UUID
    partner_organization_id: UUID | None
    participation_date: date
    recipient_display_name: str
    program_title: str
    partner_display_name: str | None
    partner_signer_name: str | None
    body_text: str
    trading_name: str
    es_founder_name: str


def _contact_display_name(contact: Contact) -> str:
    return contact_full_name(contact) or contact.email or "Recipient"


def _partner_signer_name(session: Session, organization_id: UUID) -> str | None:
    stmt = (
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == organization_id)
        .options(selectinload(OrganizationMember.contact))
        .order_by(
            OrganizationMember.is_primary_contact.desc(),
            OrganizationMember.created_at.asc(),
        )
    )
    members = list(session.execute(stmt).scalars().all())
    for member in members:
        if not member.is_primary_contact:
            continue
        contact = member.contact
        if contact is None:
            continue
        name = _contact_display_name(contact)
        if name:
            return name
    for member in members:
        contact = member.contact
        if contact is None:
            continue
        name = _contact_display_name(contact)
        if name:
            return name
    return None


def resolve_certificate_draft(
    session: Session,
    *,
    contact_id: UUID,
    service_id: UUID,
    instance_id: UUID,
    participation_date: date,
    program_title_override: str | None,
    partner_organization_id: UUID | None,
) -> ResolvedCertificateDraft:
    """Validate inputs and assemble snapshot fields for preview/issue."""
    contact = session.get(Contact, contact_id)
    if contact is None or contact.archived_at is not None:
        raise ValidationError("contact_id not found", field="contact_id")

    instance = session.execute(
        select(ServiceInstance)
        .where(ServiceInstance.id == instance_id)
        .options(
            selectinload(ServiceInstance.service),
            selectinload(ServiceInstance.partner_organization_links).selectinload(
                ServiceInstancePartnerOrganization.organization
            ),
        )
    ).scalar_one_or_none()
    if instance is None:
        raise ValidationError("instance_id not found", field="instance_id")
    if instance.service_id != service_id:
        raise ValidationError(
            "instance_id does not belong to service_id",
            field="instance_id",
        )

    enrollment = session.execute(
        select(Enrollment).where(
            Enrollment.instance_id == instance_id,
            Enrollment.contact_id == contact_id,
            Enrollment.status == EnrollmentStatus.COMPLETED,
        )
    ).scalar_one_or_none()
    if enrollment is None:
        raise ValidationError(
            "Contact must have a completed enrollment for this instance",
            field="contact_id",
        )

    service = instance.service
    default_program = (
        instance.title if instance.title is not None else service.title
    ).strip()
    program_title = (program_title_override or default_program).strip()
    if not program_title:
        raise ValidationError("program_title is required", field="program_title")

    trading_name = certificate_trading_name()
    if not trading_name:
        raise ValidationError(
            "Certificate trading name is not configured",
            field="program_title",
        )
    es_founder = certificate_es_founder_name()
    if not es_founder:
        raise ValidationError(
            "Certificate founder name is not configured",
            field="program_title",
        )

    active_partner_links = [
        link
        for link in sorted(
            instance.partner_organization_links,
            key=lambda row: row.sort_order,
        )
        if link.organization.archived_at is None
    ]
    resolved_partner_id: UUID | None = None
    partner_display_name: str | None = None
    partner_signer_name: str | None = None

    if active_partner_links:
        if partner_organization_id is None:
            raise ValidationError(
                "partner_organization_id is required when the instance has partners",
                field="partner_organization_id",
            )
        allowed_ids = {link.organization_id for link in active_partner_links}
        if partner_organization_id not in allowed_ids:
            raise ValidationError(
                "partner_organization_id is not linked to this instance",
                field="partner_organization_id",
            )
        org = session.get(Organization, partner_organization_id)
        if org is None:
            raise ValidationError(
                "partner_organization_id not found",
                field="partner_organization_id",
            )
        resolved_partner_id = partner_organization_id
        partner_display_name = org.name.strip()
        partner_signer_name = _partner_signer_name(session, partner_organization_id)
    elif partner_organization_id is not None:
        raise ValidationError(
            "partner_organization_id must be omitted when the instance has no partners",
            field="partner_organization_id",
        )

    recipient_display_name = _contact_display_name(contact)
    body_text = build_certificate_body_text(
        trading_name=trading_name,
        partner_display_name=partner_display_name,
    )

    return ResolvedCertificateDraft(
        contact_id=contact_id,
        instance_id=instance_id,
        service_id=service_id,
        enrollment_id=enrollment.id,
        partner_organization_id=resolved_partner_id,
        participation_date=participation_date,
        recipient_display_name=recipient_display_name,
        program_title=program_title,
        partner_display_name=partner_display_name,
        partner_signer_name=partner_signer_name,
        body_text=body_text,
        trading_name=trading_name,
        es_founder_name=es_founder,
    )


def draft_to_pdf_context(
    draft: ResolvedCertificateDraft,
) -> CompletionCertificatePdfContext:
    return CompletionCertificatePdfContext(
        recipient_display_name=draft.recipient_display_name,
        program_title=draft.program_title,
        participation_date=draft.participation_date,
        trading_name=draft.trading_name,
        partner_display_name=draft.partner_display_name,
        partner_signer_name=draft.partner_signer_name,
        es_founder_name=draft.es_founder_name,
        body_text=draft.body_text,
    )


def render_draft_pdf_bytes(draft: ResolvedCertificateDraft) -> bytes:
    return render_completion_certificate_pdf(draft_to_pdf_context(draft))


def upload_preview_pdf(pdf_bytes: bytes) -> str:
    key = preview_pdf_s3_key()
    store_pdf_in_assets_bucket(
        s3_key=key,
        body=pdf_bytes,
        content_type="application/pdf",
        require_upload=True,
    )
    return key


def create_issued_certificate(
    session: Session,
    *,
    draft: ResolvedCertificateDraft,
    actor_sub: str,
) -> CompletionCertificate:
    """Persist certificate row and upload issued PDF."""
    now = datetime.now(UTC)
    cert = CompletionCertificate(
        contact_id=draft.contact_id,
        instance_id=draft.instance_id,
        service_id=draft.service_id,
        enrollment_id=draft.enrollment_id,
        partner_organization_id=draft.partner_organization_id,
        participation_date=draft.participation_date,
        recipient_display_name=draft.recipient_display_name,
        program_title=draft.program_title,
        partner_display_name=draft.partner_display_name,
        partner_signer_name=draft.partner_signer_name,
        body_text=draft.body_text,
        status=CompletionCertificateStatus.ISSUED,
        issued_at=now,
        issued_by=actor_sub,
    )
    session.add(cert)
    session.flush()

    pdf_bytes = render_draft_pdf_bytes(draft)
    digest = _sha256_bytes(pdf_bytes)
    key = issued_pdf_s3_key(cert.id)
    store_pdf_in_assets_bucket(
        s3_key=key,
        body=pdf_bytes,
        content_type="application/pdf",
        require_upload=True,
    )
    cert.issued_pdf_s3_key = key
    cert.issued_pdf_sha256 = digest
    cert.pdf_template_version = COMPLETION_CERTIFICATE_PDF_TEMPLATE_VERSION
    session.flush()
    return cert


def load_certificate_for_pdf(
    session: Session, certificate_id: UUID
) -> CompletionCertificate:
    cert = session.get(CompletionCertificate, certificate_id)
    if cert is None:
        raise NotFoundError("CompletionCertificate", str(certificate_id))
    if cert.status != CompletionCertificateStatus.ISSUED:
        raise ValidationError(
            "Certificate is voided; PDF download is not available",
            field="id",
        )
    if not cert.issued_pdf_s3_key:
        raise ValidationError("Certificate PDF is not available", field="id")
    return cert


def contact_ids_with_issued_certificates(
    session: Session, contact_ids: list[UUID]
) -> set[UUID]:
    if not contact_ids:
        return set()
    stmt = (
        select(CompletionCertificate.contact_id)
        .where(
            CompletionCertificate.contact_id.in_(contact_ids),
            CompletionCertificate.status == CompletionCertificateStatus.ISSUED,
        )
        .distinct()
    )
    return set(session.execute(stmt).scalars().all())
