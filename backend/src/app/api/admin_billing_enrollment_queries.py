"""Admin billing: enrollments eligible for draft invoice picker."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy import and_, cast, exists, or_, select, String
from sqlalchemy.orm import Session, joinedload

from app.api.admin_billing_common import (
    _session_with_audit,
    batch_enrollment_party_display_names,
    collect_enrollment_family_org_ids,
    effective_enrollment_bill_to_kind,
    enrollment_bill_to_merge_key,
    primary_family_emails,
    primary_org_emails,
)
from app.api.admin_request import parse_limit, query_param
from app.config import get_default_currency_code
from app.db.models import Contact, Enrollment
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.enums import (
    BillingBillToKind,
    BillingInvoiceStatus,
    EnrollmentStatus,
)
from app.db.models.family import Family
from app.db.models.organization import Organization
from app.db.models.service import Service
from app.db.models.service_instance import EventTicketTier, ServiceInstance
from app.exceptions import ValidationError
from app.utils import json_response


def _decimal_to_string(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value, "f")


def _party_email(
    session: Session,
    enrollment: Enrollment,
    family_emails: dict[UUID, str],
    org_emails: dict[UUID, str],
) -> str | None:
    bk = effective_enrollment_bill_to_kind(enrollment)
    if bk == BillingBillToKind.CONTACT:
        c = enrollment.bill_to_contact or enrollment.contact
        return c.email if c and c.email else None
    if bk == BillingBillToKind.FAMILY:
        fid = enrollment.bill_to_family_id or enrollment.family_id
        if fid and fid in family_emails:
            return family_emails[fid]
        c = enrollment.contact
        return c.email if c and c.email else None
    if bk == BillingBillToKind.ORGANIZATION:
        oid = enrollment.bill_to_organization_id or enrollment.organization_id
        if oid and oid in org_emails:
            return org_emails[oid]
        c = enrollment.contact
        return c.email if c and c.email else None
    return None


_PICKER_MAX_LIMIT = 500
# Draft invoice picker: `enrolled_at` must be within this many rolling days (two 365-day windows).
_DRAFT_INVOICE_ENROLLMENT_LOOKBACK_DAYS = 730


def _trimmed_str_or_none(value: object | None) -> str | None:
    """Return stripped non-empty string, or None; ignores non-strings (avoids MagicMock in tests)."""
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    t = value.strip()
    return t or None


def _parse_enrolled_at_cursor(raw: str | None) -> tuple[datetime | None, UUID | None]:
    if not raw or not str(raw).strip():
        return None, None
    try:
        padding = "=" * (-len(raw) % 4)
        decoded = base64.urlsafe_b64decode(raw + padding)
        payload = json.loads(decoded)
        ts = datetime.fromisoformat(str(payload["enrolled_at"]).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
        else:
            ts = ts.astimezone(UTC)
        eid = UUID(str(payload["id"]))
        return ts, eid
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValidationError("Invalid cursor", field="cursor") from exc


def _encode_enrolled_at_cursor(enrolled_at: datetime, row_id: UUID) -> str:
    ts = (
        enrolled_at.astimezone(UTC)
        if enrolled_at.tzinfo
        else enrolled_at.replace(tzinfo=UTC)
    )
    payload = json.dumps({"enrolled_at": ts.isoformat(), "id": str(row_id)}).encode(
        "utf-8"
    )
    return base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")


def list_recent_enrollments_for_invoicing(
    event: Mapping[str, Any], *, user_sub: str, request_id: str | None
) -> dict[str, Any]:
    """Non-cancelled enrollments from the last two years (`enrolled_at`), capped and paginated.

    Uses a 730-day rolling window (two 365-day windows), consistent with the prior one-year window.

    Tenant note: this deployment is single-tenant Aurora; there is no tenant_id column on
    enrollments. Authorization is enforced at API Gateway (admin group).
    """
    cutoff = datetime.now(UTC) - timedelta(days=_DRAFT_INVOICE_ENROLLMENT_LOOKBACK_DAYS)
    limit = parse_limit(event, default=_PICKER_MAX_LIMIT, max_limit=_PICKER_MAX_LIMIT)
    cursor_ts, cursor_id = _parse_enrolled_at_cursor(query_param(event, "cursor"))
    q_raw = (query_param(event, "q") or "").strip()

    with _session_with_audit(user_sub, request_id) as session:
        stmt = (
            select(Enrollment)
            .where(Enrollment.enrolled_at >= cutoff)
            .where(Enrollment.status != EnrollmentStatus.CANCELLED)
        )
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Enrollment.enrolled_at < cursor_ts,
                    and_(
                        Enrollment.enrolled_at == cursor_ts,
                        Enrollment.id < cursor_id,
                    ),
                )
            )

        if q_raw:
            q_pat = f"%{q_raw}%"
            stmt = stmt.where(
                or_(
                    cast(Enrollment.id, String).ilike(q_pat),
                    exists(
                        select(1)
                        .select_from(ServiceInstance)
                        .where(
                            ServiceInstance.id == Enrollment.instance_id,
                            or_(
                                ServiceInstance.title.ilike(q_pat),
                                ServiceInstance.cohort.ilike(q_pat),
                            ),
                        )
                    ),
                    exists(
                        select(1)
                        .select_from(Contact)
                        .where(
                            Contact.id == Enrollment.contact_id,
                            or_(
                                Contact.email.ilike(q_pat),
                                Contact.first_name.ilike(q_pat),
                                Contact.last_name.ilike(q_pat),
                            ),
                        )
                    ),
                    exists(
                        select(1)
                        .select_from(Contact)
                        .where(
                            Contact.id == Enrollment.bill_to_contact_id,
                            or_(
                                Contact.email.ilike(q_pat),
                                Contact.first_name.ilike(q_pat),
                                Contact.last_name.ilike(q_pat),
                            ),
                        )
                    ),
                    exists(
                        select(1)
                        .select_from(Family)
                        .where(
                            Family.id == Enrollment.family_id,
                            Family.family_name.ilike(q_pat),
                        )
                    ),
                    exists(
                        select(1)
                        .select_from(Family)
                        .where(
                            Family.id == Enrollment.bill_to_family_id,
                            Family.family_name.ilike(q_pat),
                        )
                    ),
                    exists(
                        select(1)
                        .select_from(Organization)
                        .where(
                            Organization.id == Enrollment.organization_id,
                            Organization.name.ilike(q_pat),
                        )
                    ),
                    exists(
                        select(1)
                        .select_from(Organization)
                        .where(
                            Organization.id == Enrollment.bill_to_organization_id,
                            Organization.name.ilike(q_pat),
                        )
                    ),
                    exists(
                        select(1)
                        .select_from(EventTicketTier)
                        .where(
                            EventTicketTier.id == Enrollment.ticket_tier_id,
                            EventTicketTier.name.ilike(q_pat),
                        )
                    ),
                )
            )

        stmt = (
            stmt.options(
                joinedload(Enrollment.instance).joinedload(ServiceInstance.service),
                joinedload(Enrollment.contact),
                joinedload(Enrollment.family),
                joinedload(Enrollment.organization),
                joinedload(Enrollment.bill_to_contact),
                joinedload(Enrollment.bill_to_family),
                joinedload(Enrollment.bill_to_organization),
                joinedload(Enrollment.ticket_tier),
            )
            .order_by(Enrollment.enrolled_at.desc(), Enrollment.id.desc())
            .limit(limit + 1)
        )

        rows = list(session.execute(stmt).unique().scalars().all())
        truncated = len(rows) > limit
        page_rows = rows[:limit]

        blocked_eids: set[UUID] = set()
        cand_ids = {en.id for en in page_rows}
        if cand_ids:
            blocked_eids = {
                enrollment_id
                for enrollment_id in session.execute(
                    select(CustomerInvoiceLine.enrollment_id)
                    .join(
                        CustomerInvoice,
                        CustomerInvoiceLine.invoice_id == CustomerInvoice.id,
                    )
                    .where(CustomerInvoiceLine.enrollment_id.in_(cand_ids))
                    .where(
                        CustomerInvoice.status.in_(
                            (
                                BillingInvoiceStatus.DRAFT,
                                BillingInvoiceStatus.ISSUED,
                            )
                        )
                    )
                )
                .scalars()
                .all()
                if enrollment_id is not None
            }

        fam_ids, org_ids = collect_enrollment_family_org_ids(page_rows)
        fam_emails = primary_family_emails(session, fam_ids)
        org_emails = primary_org_emails(session, org_ids)
        party_labels = batch_enrollment_party_display_names(session, page_rows)

        default_ccy = get_default_currency_code()
        items: list[dict[str, Any]] = []
        for idx, en in enumerate(page_rows):
            inst = en.instance
            title = _trimmed_str_or_none(inst.title) if inst else None
            cohort = _trimmed_str_or_none(inst.cohort) if inst else None
            parent_service_title = None
            svc_obj: Service | None = None
            if inst is not None:
                svc_obj = getattr(inst, "service", None)
                if svc_obj is not None:
                    parent_service_title = _trimmed_str_or_none(svc_obj.title)
            tier_name: str | None = None
            if en.ticket_tier_id and en.ticket_tier is not None:
                tier_name = _trimmed_str_or_none(en.ticket_tier.name)
            if tier_name is None and svc_obj is not None:
                tier_name = _trimmed_str_or_none(svc_obj.service_tier)
            currency = (en.currency or default_ccy).upper()[:3]
            email = _party_email(session, en, fam_emails, org_emails)
            bk = effective_enrollment_bill_to_kind(en)
            party_display = party_labels[idx]
            items.append(
                {
                    "enrollmentId": str(en.id),
                    "partyDisplayName": party_display,
                    "partyEmail": email,
                    "billToKind": bk.value,
                    "instanceTitle": title,
                    "parentServiceTitle": parent_service_title,
                    "serviceTierName": tier_name,
                    "instanceCohort": cohort or None,
                    "amountPaid": _decimal_to_string(en.amount_paid),
                    "currency": currency,
                    "enrolledAt": en.enrolled_at.isoformat()
                    if en.enrolled_at
                    else None,
                    "invoiceLinked": en.id in blocked_eids,
                    "billToMergeKey": enrollment_bill_to_merge_key(en),
                }
            )

        next_cursor = None
        if truncated and page_rows:
            last = page_rows[-1]
            if last.enrolled_at:
                next_cursor = _encode_enrolled_at_cursor(last.enrolled_at, last.id)

        body: dict[str, Any] = {
            "items": items,
            "truncated": truncated,
            "next_cursor": next_cursor,
        }
        return json_response(200, body, event=event)
