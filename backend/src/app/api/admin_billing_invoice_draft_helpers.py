"""Shared helpers for admin billing invoice draft creation."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin_billing_common import (
    effective_enrollment_bill_to_fks,
)
from app.db.models import Contact, Enrollment, Family, Organization
from app.db.models.contact import contact_full_name
from app.db.models.customer_invoice import CustomerInvoice
from app.db.models.enums import BillingBillToKind, RelationshipType
from app.db.models.family import FamilyMember
from app.db.models.geographic_area import GeographicArea
from app.db.models.location import Location
from app.db.models.organization import OrganizationMember
from app.exceptions import ValidationError
from app.services.customer_invoice_pdf import split_address_lines


def _first_present(d: Mapping[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in d:
            return d[k]
    return None


def _decimal_field(raw: Any, *, field: str) -> Decimal:
    try:
        return Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be a decimal number", field=field) from exc


def _enrollment_merge_key(en: Enrollment) -> tuple[Any, ...]:
    return effective_enrollment_bill_to_fks(en)


def _trimmed_str_or_none(value: object | None) -> str | None:
    """Return stripped non-empty string, or None (non-strings ignored)."""
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    t = value.strip()
    return t or None


def _capitalize_first_letter(value: str) -> str:
    s = value.strip()
    if not s:
        return s
    return s[0].upper() + s[1:]


def _service_kind_en_label(service_type: object | None) -> str:
    """English invoice line label for ``Service.service_type`` (enum or string value)."""
    raw = getattr(service_type, "value", service_type)
    key = str(raw).strip().lower() if raw is not None else ""
    return {
        "training_course": "Training course",
        "event": "Event",
        "consultation": "Consultation",
        "intro_call": "Intro call",
    }.get(key, key.replace("_", " ").title() if key else "")


def _build_enrollment_merge_line_description(enrollment: Enrollment) -> str:
    """Line text for enrollment-merge invoices: service kind, title tail, tier, and cohort.

    The lead segment is always the parent service **kind** (``Service.service_type``) in
    English when a service row is loaded. It is joined with ``": "`` to a **tail** that
    prefers the instance title, then the service title, when that tail is non-empty and
    differs from the kind label (case-insensitive); otherwise only the kind is used when no
    tail exists. Tier prefers enrollment ticket tier name, then catalog ``service_tier``.
    Tier and cohort segments use a leading capital letter only (rest unchanged). Falls back
    to ``Enrollment`` when no usable segments exist.
    """
    inst = enrollment.instance
    svc = getattr(inst, "service", None) if inst is not None else None
    instance_title = _trimmed_str_or_none(inst.title) if inst is not None else None
    service_title = (
        _trimmed_str_or_none(getattr(svc, "title", None)) if svc is not None else None
    )
    tail = instance_title or service_title
    kind_label = (
        _service_kind_en_label(getattr(svc, "service_type", None)) if svc else ""
    )

    title_part: str | None = None
    if kind_label and tail:
        if tail.casefold() == kind_label.casefold():
            title_part = kind_label
        else:
            title_part = f"{kind_label}: {tail}"
    elif kind_label:
        title_part = kind_label
    elif tail:
        title_part = tail

    tier_raw: str | None = None
    if enrollment.ticket_tier_id and enrollment.ticket_tier is not None:
        tier_raw = _trimmed_str_or_none(enrollment.ticket_tier.name)
    if tier_raw is None and svc is not None:
        tier_raw = _trimmed_str_or_none(getattr(svc, "service_tier", None))

    cohort_raw: str | None = None
    if inst is not None:
        cohort_raw = _trimmed_str_or_none(inst.cohort)

    parts: list[str] = []
    if title_part:
        parts.append(title_part)
    if tier_raw:
        parts.append(_capitalize_first_letter(tier_raw))
    if cohort_raw:
        parts.append(_capitalize_first_letter(cohort_raw))

    if not parts:
        return "Enrollment"
    out = " ".join(parts)
    return out[:500]


build_enrollment_invoice_line_description = _build_enrollment_merge_line_description


_MAX_GEO_AREA_WALK = 32


def _geographic_area_chain_root_first(
    session: Session, area_id: object
) -> list[GeographicArea]:
    """Return geographic_areas from root (country) to leaf, or [] if missing or cyclic."""
    from uuid import UUID as Uuid

    try:
        aid = Uuid(str(area_id))
    except (TypeError, ValueError):
        return []
    rev: list[GeographicArea] = []
    seen: set[str] = set()
    current: GeographicArea | None = session.get(GeographicArea, aid)
    n = 0
    while current is not None and n < _MAX_GEO_AREA_WALK:
        sid = str(current.id)
        if sid in seen:
            break
        seen.add(sid)
        rev.append(current)
        pid = current.parent_id
        if pid is None:
            break
        try:
            next_id = Uuid(str(pid))
        except (TypeError, ValueError):
            break
        current = session.get(GeographicArea, next_id)
        n += 1
    rev.reverse()
    return rev


def _district_and_country_labels_from_chain(
    chain: list[GeographicArea],
) -> tuple[str | None, str | None]:
    """Pick display labels for ``district`` and ``country`` levels from a root-first chain."""
    country: str | None = None
    for node in chain:
        if node.level == "country":
            t = (node.name or "").strip()
            if t:
                country = t
    district: str | None = None
    for node in reversed(chain):
        if node.level == "district":
            t = (node.name or "").strip()
            if t:
                district = t
            break
    return district, country


def _append_unique_invoice_location_line(parts: list[str], line: str | None) -> None:
    if not line:
        return
    t = line.strip()
    if not t:
        return
    lower = {p.strip().lower() for p in parts}
    if t.lower() in lower:
        return
    parts.append(t)


def _bill_to_location_snapshot_text(
    session: Session,
    location_id: UUID | None,
    *,
    include_venue_name: bool = True,
) -> str | None:
    """Return newline-separated venue, address, district, and country for invoice PDF.

    ``include_venue_name=False`` drops ``Location.name`` from the snapshot. Used by the
    family bill-to branch because family-affiliated locations are typically labelled with
    the household/family name, which duplicates and clutters the postal block.
    """
    if location_id is None:
        return None
    loc = session.get(Location, location_id)
    if loc is None:
        return None
    parts: list[str] = []
    if include_venue_name:
        name = (loc.name or "").strip()
        if name:
            parts.append(name)
    parts.extend(split_address_lines(loc.address or ""))
    area_id = getattr(loc, "area_id", None)
    if area_id is not None:
        chain = _geographic_area_chain_root_first(session, area_id)
        dlab, clab = _district_and_country_labels_from_chain(chain)
        _append_unique_invoice_location_line(parts, dlab)
        _append_unique_invoice_location_line(parts, clab)
    if not parts:
        return None
    return "\n".join(parts)


def _resolve_bill_to_party_from_invoice_fks(
    session: Session, *, inv: CustomerInvoice
) -> None:
    """Set bill-to display fields from invoice bill-to foreign keys (CRM snapshot)."""
    inv.bill_to_location_text = None
    if inv.bill_to_kind == BillingBillToKind.CONTACT:
        cid = inv.bill_to_contact_id
        if cid:
            c = session.get(Contact, cid)
            if c:
                name = contact_full_name(c) or ""
                if name:
                    inv.bill_to_display_name = name
                em = (c.email or "").strip()
                if em:
                    inv.bill_to_email = em
                inv.bill_to_location_text = _bill_to_location_snapshot_text(
                    session, getattr(c, "location_id", None)
                )
        return
    if inv.bill_to_kind == BillingBillToKind.FAMILY and inv.bill_to_family_id:
        fam = session.get(Family, inv.bill_to_family_id)
        if fam is None:
            return
        stmt = (
            select(Contact)
            .join(FamilyMember, FamilyMember.contact_id == Contact.id)
            .where(FamilyMember.family_id == inv.bill_to_family_id)
            .where(FamilyMember.is_primary_contact.is_(True))
            .limit(1)
        )
        primary = session.execute(stmt).scalar_one_or_none()
        primary_nm = contact_full_name(primary) or ""
        if primary_nm:
            inv.bill_to_display_name = primary_nm
        else:
            inv.bill_to_display_name = None
        if primary and primary.email:
            inv.bill_to_email = primary.email
        loc_id = getattr(fam, "location_id", None)
        if loc_id is None and primary is not None:
            loc_id = getattr(primary, "location_id", None)
        inv.bill_to_location_text = _bill_to_location_snapshot_text(
            session, loc_id, include_venue_name=False
        )
        return
    if (
        inv.bill_to_kind == BillingBillToKind.ORGANIZATION
        and inv.bill_to_organization_id
    ):
        org = session.get(Organization, inv.bill_to_organization_id)
        if org is None:
            return
        stmt = (
            select(Contact)
            .join(
                OrganizationMember,
                OrganizationMember.contact_id == Contact.id,
            )
            .where(OrganizationMember.organization_id == inv.bill_to_organization_id)
            .where(OrganizationMember.is_primary_contact.is_(True))
            .limit(1)
        )
        primary = session.execute(stmt).scalar_one_or_none()
        if org.relationship_type == RelationshipType.PARTNER:
            entity_nm = ((org.legal_name or org.name) or "").strip()
        else:
            entity_nm = (org.name or "").strip()
        primary_nm = contact_full_name(primary) or ""
        if entity_nm and primary_nm:
            inv.bill_to_display_name = f"{entity_nm}\n{primary_nm}"
        elif entity_nm:
            inv.bill_to_display_name = entity_nm
        elif primary_nm:
            inv.bill_to_display_name = primary_nm
        if primary and primary.email:
            inv.bill_to_email = primary.email
        inv.bill_to_location_text = _bill_to_location_snapshot_text(
            session, getattr(org, "location_id", None)
        )


def _resolve_bill_to_party_for_draft(
    session: Session, *, inv: CustomerInvoice, first: Enrollment
) -> None:
    """Set bill-to display fields from enrollment bill-to defaults."""
    if inv.bill_to_kind == BillingBillToKind.CONTACT:
        cid = inv.bill_to_contact_id or first.contact_id
        inv.bill_to_contact_id = cid
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)


def _parse_bill_to_block(
    body: Mapping[str, Any],
) -> tuple[BillingBillToKind, UUID | None, UUID | None, UUID | None]:
    raw = _first_present(body, "billTo", "bill_to")
    if not isinstance(raw, Mapping):
        raise ValidationError("billTo is required", field="billTo")
    kind_raw = str(raw.get("kind") or "").strip().lower()
    try:
        bill_kind = BillingBillToKind(kind_raw)
    except ValueError as exc:
        raise ValidationError(
            "billTo.kind must be contact, family, or organization",
            field="billTo",
        ) from exc
    cid_raw = _first_present(raw, "contactId", "contact_id")
    fid_raw = _first_present(raw, "familyId", "family_id")
    oid_raw = _first_present(raw, "organizationId", "organization_id")
    cid: UUID | None = None
    fid: UUID | None = None
    oid: UUID | None = None
    if bill_kind == BillingBillToKind.CONTACT:
        if cid_raw is None:
            raise ValidationError("billTo.contactId is required", field="billTo")
        try:
            cid = UUID(str(cid_raw))
        except (ValueError, TypeError) as exc:
            raise ValidationError(
                "billTo.contactId must be a UUID string", field="billTo"
            ) from exc
    elif bill_kind == BillingBillToKind.FAMILY:
        if fid_raw is None:
            raise ValidationError("billTo.familyId is required", field="billTo")
        try:
            fid = UUID(str(fid_raw))
        except (ValueError, TypeError) as exc:
            raise ValidationError(
                "billTo.familyId must be a UUID string", field="billTo"
            ) from exc
    else:
        if oid_raw is None:
            raise ValidationError("billTo.organizationId is required", field="billTo")
        try:
            oid = UUID(str(oid_raw))
        except (ValueError, TypeError) as exc:
            raise ValidationError(
                "billTo.organizationId must be a UUID string", field="billTo"
            ) from exc
    return bill_kind, cid, fid, oid
