"""Shared session, audit context, and bill-to helpers for admin billing handlers."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin_request import DEFAULT_LIST_LIMIT
from app.db.audit import session_with_audit
from app.db.models import Contact, Enrollment
from app.db.models.enums import BillingBillToKind
from app.db.models.family import FamilyMember
from app.db.models.organization import OrganizationMember

DEFAULT_BILLING_LIST_LIMIT = DEFAULT_LIST_LIMIT
_session_with_audit = session_with_audit


def contact_display_name(c: Contact | None) -> str | None:
    """Given a contact row, return a display name or None."""
    if c is None:
        return None
    return " ".join(x for x in [c.first_name, c.last_name] if x).strip() or None


def _uuid_fk_or_none(value: object | None) -> UUID | None:
    """Return ``value`` only when it is a concrete UUID (avoids MagicMock truthiness in tests)."""
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    return None


def effective_enrollment_bill_to_fks(
    enrollment: Enrollment,
) -> tuple[BillingBillToKind, UUID | None, UUID | None, UUID | None]:
    """Resolved bill-to kind and mutually exclusive FK ids for invoicing (picker merge + draft rows).

    Uses ``effective_enrollment_bill_to_kind`` so legacy family/org enrollments that only set
    ``family_id`` / ``organization_id`` align with customer invoice bill-to constraints.
    """
    bk = effective_enrollment_bill_to_kind(enrollment)
    if bk == BillingBillToKind.CONTACT:
        cid = _uuid_fk_or_none(enrollment.bill_to_contact_id)
        if cid is None:
            cid = _uuid_fk_or_none(enrollment.contact_id)
        return (bk, cid, None, None)
    if bk == BillingBillToKind.FAMILY:
        fid = _uuid_fk_or_none(enrollment.bill_to_family_id)
        if fid is None:
            fid = _uuid_fk_or_none(enrollment.family_id)
        return (bk, None, fid, None)
    oid = _uuid_fk_or_none(enrollment.bill_to_organization_id)
    if oid is None:
        oid = _uuid_fk_or_none(enrollment.organization_id)
    return (bk, None, None, oid)


def family_or_organization_bill_to_display_label(
    *,
    entity_name: str | None,
    primary_display_name: str | None,
) -> str | None:
    """Bill-to line for family or organization: ``{entity} · {primary}`` when both exist.

    Keeps customer invoices and enrollment invoicing labels aligned when the party
    is a family or organization and billing names the main (primary) contact.
    """
    entity = (entity_name or "").strip()
    primary = (primary_display_name or "").strip()
    if entity and primary:
        return f"{entity} \u00b7 {primary}"
    if entity:
        return entity
    if primary:
        return primary
    return None


def enrollment_bill_to_merge_key(enrollment: Enrollment) -> str:
    """Stable string key for comparing bill-to identity across enrollments."""
    bk, cid, fid, oid = effective_enrollment_bill_to_fks(enrollment)
    parts = (
        bk.value,
        str(cid) if cid else "",
        str(fid) if fid else "",
        str(oid) if oid else "",
    )
    return "|".join(parts)


def effective_enrollment_bill_to_kind(enrollment: Enrollment) -> BillingBillToKind:
    """Resolve bill-to kind when legacy rows omit ``billing_bill_to_kind``.

    Some enrollments only set structural ``family_id`` / ``organization_id`` (or bill-to FKs)
    without persisting ``bill_to_kind``. Infer family/org for lookups and JSON labels.
    """
    raw = enrollment.bill_to_kind
    if raw is not None:
        return raw
    if enrollment.bill_to_family_id is not None:
        return BillingBillToKind.FAMILY
    if enrollment.bill_to_organization_id is not None:
        return BillingBillToKind.ORGANIZATION
    if enrollment.contact_id is None and enrollment.family_id is not None:
        return BillingBillToKind.FAMILY
    if enrollment.contact_id is None and enrollment.organization_id is not None:
        return BillingBillToKind.ORGANIZATION
    return BillingBillToKind.CONTACT


def collect_enrollment_family_org_ids(
    rows: list[Enrollment],
) -> tuple[set[UUID], set[UUID]]:
    """Collect distinct family and organization ids (bill-to or structural)."""
    fam: set[UUID] = set()
    org: set[UUID] = set()
    for en in rows:
        fid = en.bill_to_family_id or en.family_id
        if fid:
            fam.add(fid)
        oid = en.bill_to_organization_id or en.organization_id
        if oid:
            org.add(oid)
    return fam, org


def compose_enrollment_party_display_name(
    enrollment: Enrollment,
    *,
    family_primary_contact_name: str | None,
    org_primary_contact_name: str | None,
) -> str:
    """Party label: contact ``name · email`` when both known; family/org use ``entity · primary contact``."""
    bk = effective_enrollment_bill_to_kind(enrollment)
    enrolled_nm = contact_display_name(enrollment.contact)
    if bk == BillingBillToKind.CONTACT:
        c = enrollment.bill_to_contact or enrollment.contact
        name = (contact_display_name(c) or "").strip()
        email = (c.email or "").strip() if c else ""
        if name and email:
            return f"{name} \u00b7 {email}"
        if name:
            return name
        if email:
            return email
        fid = enrollment.bill_to_family_id or enrollment.family_id
        if fid is not None:
            fam = enrollment.bill_to_family or enrollment.family
            entity = (fam.family_name or "").strip() if fam else ""
            pc = (family_primary_contact_name or "").strip()
            if not pc and enrolled_nm:
                pc = enrolled_nm.strip()
            if entity and pc:
                return f"{entity} \u00b7 {pc}"
            if entity:
                return entity
            if pc:
                return pc
        oid = enrollment.bill_to_organization_id or enrollment.organization_id
        if oid is not None:
            org = enrollment.bill_to_organization or enrollment.organization
            entity = (org.name or "").strip() if org else ""
            pc = (org_primary_contact_name or "").strip()
            if not pc and enrolled_nm:
                pc = enrolled_nm.strip()
            if entity and pc:
                return f"{entity} \u00b7 {pc}"
            if entity:
                return entity
            if pc:
                return pc
        return "—"
    if bk == BillingBillToKind.FAMILY:
        fam = enrollment.bill_to_family or enrollment.family
        entity = (fam.family_name or "").strip() if fam else ""
        pc = (family_primary_contact_name or "").strip()
        if not pc and enrolled_nm:
            pc = enrolled_nm.strip()
        label = family_or_organization_bill_to_display_label(
            entity_name=entity or None,
            primary_display_name=pc or None,
        )
        return label if label else "—"
    if bk == BillingBillToKind.ORGANIZATION:
        org = enrollment.bill_to_organization or enrollment.organization
        entity = (org.name or "").strip() if org else ""
        pc = (org_primary_contact_name or "").strip()
        if not pc and enrolled_nm:
            pc = enrolled_nm.strip()
        label = family_or_organization_bill_to_display_label(
            entity_name=entity or None,
            primary_display_name=pc or None,
        )
        return label if label else "—"
    return "—"


def batch_enrollment_party_display_names(
    session: Session, rows: list[Enrollment]
) -> list[str]:
    """Compute party labels for many enrollments with batched primary-contact lookups."""
    fam_ids, org_ids = collect_enrollment_family_org_ids(rows)
    fam_pc = primary_family_contact_names(session, fam_ids)
    org_pc = primary_org_contact_names(session, org_ids)
    labels: list[str] = []
    for en in rows:
        fid = en.bill_to_family_id or en.family_id
        oid = en.bill_to_organization_id or en.organization_id
        labels.append(
            compose_enrollment_party_display_name(
                en,
                family_primary_contact_name=fam_pc.get(fid) if fid else None,
                org_primary_contact_name=org_pc.get(oid) if oid else None,
            )
        )
    return labels


def primary_family_emails(session: Session, family_ids: set[UUID]) -> dict[UUID, str]:
    """Map family id -> primary contact email when present."""
    if not family_ids:
        return {}
    stmt = (
        select(FamilyMember.family_id, Contact.email)
        .join(Contact, FamilyMember.contact_id == Contact.id)
        .where(FamilyMember.family_id.in_(family_ids))
        .where(FamilyMember.is_primary_contact.is_(True))
        .where(Contact.email.is_not(None))
    )
    out: dict[UUID, str] = {}
    for fid, email in session.execute(stmt).all():
        if email and fid not in out:
            out[fid] = str(email)
    return out


def primary_org_emails(session: Session, org_ids: set[UUID]) -> dict[UUID, str]:
    """Map organization id -> primary contact email when present."""
    if not org_ids:
        return {}
    stmt = (
        select(OrganizationMember.organization_id, Contact.email)
        .join(Contact, OrganizationMember.contact_id == Contact.id)
        .where(OrganizationMember.organization_id.in_(org_ids))
        .where(OrganizationMember.is_primary_contact.is_(True))
        .where(Contact.email.is_not(None))
    )
    out: dict[UUID, str] = {}
    for oid, email in session.execute(stmt).all():
        if email and oid not in out:
            out[oid] = str(email)
    return out


def primary_family_contact_names(
    session: Session, family_ids: set[UUID]
) -> dict[UUID, str]:
    """Map family id -> primary contact display name (first + last) when non-empty."""
    if not family_ids:
        return {}
    stmt = (
        select(FamilyMember.family_id, Contact.first_name, Contact.last_name)
        .join(Contact, FamilyMember.contact_id == Contact.id)
        .where(FamilyMember.family_id.in_(family_ids))
        .where(FamilyMember.is_primary_contact.is_(True))
    )
    out: dict[UUID, str] = {}
    for fid, fn, ln in session.execute(stmt).all():
        if fid in out:
            continue
        display = " ".join(x for x in (fn, ln) if x).strip()
        if display:
            out[fid] = display
    return out


def primary_org_contact_names(session: Session, org_ids: set[UUID]) -> dict[UUID, str]:
    """Map organization id -> primary contact display name (first + last) when non-empty."""
    if not org_ids:
        return {}
    stmt = (
        select(
            OrganizationMember.organization_id, Contact.first_name, Contact.last_name
        )
        .join(Contact, OrganizationMember.contact_id == Contact.id)
        .where(OrganizationMember.organization_id.in_(org_ids))
        .where(OrganizationMember.is_primary_contact.is_(True))
    )
    out: dict[UUID, str] = {}
    for oid, fn, ln in session.execute(stmt).all():
        if oid in out:
            continue
        display = " ".join(x for x in (fn, ln) if x).strip()
        if display:
            out[oid] = display
    return out
