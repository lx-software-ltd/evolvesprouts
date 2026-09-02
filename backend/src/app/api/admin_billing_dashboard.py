"""Admin billing dashboard read helpers (CRM rollups for analytics)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin_request import parse_body
from app.api.admin_services_payload_utils import parse_uuid_list
from app.db.audit import session_with_audit
from app.db.models.family import FamilyMember
from app.db.models.organization import OrganizationMember
from app.exceptions import ValidationError
from app.utils import json_response
from app.utils.logging import get_logger

logger = get_logger(__name__)

_MAX_BILL_TO_RESOLVE_IDS = 400


def _dedupe_uuid_list(values: list[UUID]) -> list[UUID]:
    seen: set[UUID] = set()
    out: list[UUID] = []
    for v in values:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _primary_contact_by_family(
    session: Session, family_ids: list[UUID]
) -> dict[UUID, UUID]:
    """Pick one contact per family: primary first, then earliest membership."""
    if not family_ids:
        return {}
    stmt = (
        select(
            FamilyMember.family_id,
            FamilyMember.contact_id,
            FamilyMember.is_primary_contact,
            FamilyMember.created_at,
        )
        .where(FamilyMember.family_id.in_(family_ids))
        .order_by(
            FamilyMember.family_id,
            FamilyMember.is_primary_contact.desc(),
            FamilyMember.created_at.asc(),
        )
    )
    rows = session.execute(stmt).all()
    out: dict[UUID, UUID] = {}
    for fam_id, contact_id, _is_primary, _created in rows:
        if fam_id not in out:
            out[fam_id] = contact_id
    return out


def _primary_contact_by_organization(
    session: Session, organization_ids: list[UUID]
) -> dict[UUID, UUID]:
    if not organization_ids:
        return {}
    stmt = (
        select(
            OrganizationMember.organization_id,
            OrganizationMember.contact_id,
            OrganizationMember.is_primary_contact,
            OrganizationMember.created_at,
        )
        .where(OrganizationMember.organization_id.in_(organization_ids))
        .order_by(
            OrganizationMember.organization_id,
            OrganizationMember.is_primary_contact.desc(),
            OrganizationMember.created_at.asc(),
        )
    )
    rows = session.execute(stmt).all()
    out: dict[UUID, UUID] = {}
    for org_id, contact_id, _is_primary, _created in rows:
        if org_id not in out:
            out[org_id] = contact_id
    return out


def resolve_bill_to_primary_contacts(
    event: Mapping[str, Any], *, user_sub: str, request_id: str | None
) -> dict[str, Any]:
    """POST /v1/admin/billing/dashboard/resolve-bill-to-primary-contacts."""
    body = parse_body(event)
    if not isinstance(body, Mapping):
        raise ValidationError("Request body must be a JSON object", field="body")

    raw_families = body.get("familyIds") or body.get("family_ids")
    raw_orgs = body.get("organizationIds") or body.get("organization_ids")

    family_ids = _dedupe_uuid_list(parse_uuid_list(raw_families, "familyIds"))
    organization_ids = _dedupe_uuid_list(parse_uuid_list(raw_orgs, "organizationIds"))

    if len(family_ids) > _MAX_BILL_TO_RESOLVE_IDS:
        raise ValidationError(
            f"familyIds must contain at most {_MAX_BILL_TO_RESOLVE_IDS} entries",
            field="familyIds",
        )
    if len(organization_ids) > _MAX_BILL_TO_RESOLVE_IDS:
        raise ValidationError(
            f"organizationIds must contain at most {_MAX_BILL_TO_RESOLVE_IDS} entries",
            field="organizationIds",
        )

    with session_with_audit(user_sub, request_id) as session:
        fam_map = _primary_contact_by_family(session, family_ids)
        org_map = _primary_contact_by_organization(session, organization_ids)

    fam_json = {str(k): str(v) for k, v in fam_map.items()}
    org_json = {str(k): str(v) for k, v in org_map.items()}

    logger.info(
        "Resolved bill-to primary contacts for dashboard rollup",
        extra={
            "family_id_count": len(family_ids),
            "organization_id_count": len(organization_ids),
            "family_resolved_count": len(fam_json),
            "organization_resolved_count": len(org_json),
        },
    )

    return json_response(
        200,
        {
            "familyPrimaryContactById": fam_json,
            "organizationPrimaryContactById": org_json,
        },
        event=event,
    )
