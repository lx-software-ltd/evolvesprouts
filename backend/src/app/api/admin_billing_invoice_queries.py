"""Admin billing: list and get customer invoices."""

from __future__ import annotations

import time
from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload

from app.api.admin_billing_common import DEFAULT_BILLING_LIST_LIMIT, _session_with_audit
from app.api.admin_billing_invoice_serializers import (
    parse_optional_invoice_settlement,
    parse_optional_invoice_status,
    serialize_invoice_detail,
    serialize_invoice_summary,
)
from app.api.admin_contacts_related import invoice_party_filter
from app.api.admin_party_related import (
    invoice_family_filter,
    invoice_organization_filter,
    parse_related_party_ids,
)
from app.api.admin_request import (
    encode_created_cursor,
    parse_created_cursor,
    parse_limit,
    query_param,
)
from app.api.assets.assets_storage import (
    generate_download_url,
    signed_link_no_cache_headers,
)
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.enums import BillingInvoiceStatus
from app.exceptions import NotFoundError, ValidationError
from app.services.customer_billing import ensure_invoice_pdf_storage
from app.utils import json_response

_MAX_INVOICE_LIST_Q_LEN = 200


def _invoice_list_ilike_pattern(q_raw: str) -> tuple[str, str]:
    """Build a LIKE pattern and escape character so ``%`` / ``_`` in user input are literal."""
    esc = "\\"
    escaped = (
        q_raw.replace(esc, esc + esc).replace("%", esc + "%").replace("_", esc + "_")
    )
    return f"%{escaped}%", esc


def list_invoices(
    event: Mapping[str, Any], *, user_sub: str, request_id: str | None
) -> dict[str, Any]:
    """All invoices for the tenant; admin authorization is enforced at API Gateway."""
    limit = parse_limit(event, default=DEFAULT_BILLING_LIST_LIMIT, max_limit=100)
    status_filter = parse_optional_invoice_status(query_param(event, "status"))
    settlement_filter = parse_optional_invoice_settlement(
        query_param(event, "settlement")
    )
    currency_raw = query_param(event, "currency")
    currency = (
        str(currency_raw).strip().upper()[:3]
        if currency_raw and str(currency_raw).strip()
        else None
    )
    if currency is not None and len(currency) != 3:
        raise ValidationError("currency must be a 3-letter ISO code", field="currency")

    q_param = query_param(event, "q")
    q_raw = str(q_param).strip()[:_MAX_INVOICE_LIST_Q_LEN] if q_param else ""
    contact_id, family_id, organization_id = parse_related_party_ids(event)

    cursor_ts, cursor_id = parse_created_cursor(query_param(event, "cursor"))

    with _session_with_audit(user_sub, request_id) as session:
        stmt = select(CustomerInvoice)
        if contact_id is not None:
            stmt = stmt.where(invoice_party_filter(session, contact_id))
        elif family_id is not None:
            stmt = stmt.where(invoice_family_filter(session, family_id))
        elif organization_id is not None:
            stmt = stmt.where(invoice_organization_filter(session, organization_id))
        if status_filter is not None:
            stmt = stmt.where(CustomerInvoice.status == status_filter)
        if settlement_filter == "open":
            stmt = stmt.where(
                CustomerInvoice.status == BillingInvoiceStatus.ISSUED,
                CustomerInvoice.balance_due > 0,
            )
        elif settlement_filter == "partially_paid":
            stmt = stmt.where(
                CustomerInvoice.status == BillingInvoiceStatus.ISSUED,
                CustomerInvoice.amount_allocated > 0,
                CustomerInvoice.balance_due > 0,
            )
        elif settlement_filter == "paid":
            stmt = stmt.where(
                CustomerInvoice.status == BillingInvoiceStatus.ISSUED,
                CustomerInvoice.balance_due == 0,
                CustomerInvoice.amount_allocated > 0,
                CustomerInvoice.total > 0,
            )
        elif settlement_filter == "no_charge":
            stmt = stmt.where(
                CustomerInvoice.status == BillingInvoiceStatus.ISSUED,
                CustomerInvoice.total == 0,
            )
        elif settlement_filter == "not_completed":
            # Draft invoices are incomplete; issued with positive total excluding paid slice.
            stmt = stmt.where(
                or_(
                    CustomerInvoice.status == BillingInvoiceStatus.DRAFT,
                    and_(
                        CustomerInvoice.status == BillingInvoiceStatus.ISSUED,
                        CustomerInvoice.total > 0,
                        ~and_(
                            CustomerInvoice.balance_due == 0,
                            CustomerInvoice.amount_allocated > 0,
                        ),
                    ),
                ),
            )
        if currency is not None:
            stmt = stmt.where(CustomerInvoice.currency == currency)
        if q_raw:
            q_pat, like_esc = _invoice_list_ilike_pattern(q_raw)
            invoice_date_iso = func.to_char(CustomerInvoice.invoice_date, "YYYY-MM-DD")
            stmt = stmt.where(
                or_(
                    CustomerInvoice.invoice_number.ilike(q_pat, escape=like_esc),
                    CustomerInvoice.bill_to_display_name.ilike(q_pat, escape=like_esc),
                    CustomerInvoice.bill_to_email.ilike(q_pat, escape=like_esc),
                    CustomerInvoice.bill_to_location_text.ilike(q_pat, escape=like_esc),
                    invoice_date_iso.ilike(q_pat, escape=like_esc),
                )
            )
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    CustomerInvoice.created_at < cursor_ts,
                    and_(
                        CustomerInvoice.created_at == cursor_ts,
                        CustomerInvoice.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(
            CustomerInvoice.created_at.desc(), CustomerInvoice.id.desc()
        ).limit(limit + 1)
        rows = list(session.execute(stmt).scalars().all())
        has_more = len(rows) > limit
        page = rows[:limit]
        ids = [r.id for r in page]
        count_map: dict[UUID, int] = {}
        if ids:
            cnt_rows = session.execute(
                select(
                    CustomerInvoiceLine.invoice_id, func.count(CustomerInvoiceLine.id)
                )
                .where(CustomerInvoiceLine.invoice_id.in_(ids))
                .group_by(CustomerInvoiceLine.invoice_id)
            ).all()
            count_map = {row[0]: int(row[1]) for row in cnt_rows}

        items = [
            serialize_invoice_summary(inv, line_count=count_map.get(inv.id, 0))
            for inv in page
        ]
        next_cursor = None
        if has_more and page:
            last = page[-1]
            next_cursor = encode_created_cursor(last.created_at, last.id)
        return json_response(
            200,
            {"items": items, "next_cursor": next_cursor},
            event=event,
        )


def get_invoice(
    event: Mapping[str, Any],
    invoice_id: UUID,
    *,
    user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    with _session_with_audit(user_sub, request_id) as session:
        stmt = (
            select(CustomerInvoice)
            .where(CustomerInvoice.id == invoice_id)
            .options(selectinload(CustomerInvoice.lines))
        )
        inv = session.execute(stmt).scalar_one_or_none()
        if inv is None:
            raise NotFoundError("CustomerInvoice", str(invoice_id))
        return json_response(
            200,
            {"invoice": serialize_invoice_detail(inv)},
            event=event,
        )


def get_invoice_pdf_download(
    event: Mapping[str, Any],
    invoice_id: UUID,
    *,
    user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    """Return a time-limited CloudFront-signed URL to open the invoice PDF in a browser."""
    with _session_with_audit(user_sub, request_id) as session:
        stmt = (
            select(CustomerInvoice)
            .where(CustomerInvoice.id == invoice_id)
            .options(selectinload(CustomerInvoice.lines))
        )
        inv = session.execute(stmt).scalar_one_or_none()
        if inv is None:
            raise NotFoundError("CustomerInvoice", str(invoice_id))
        s3_key = ensure_invoice_pdf_storage(session, inv)
        download = generate_download_url(
            s3_key=s3_key,
            cache_bust_key=str(time.time_ns()),
        )
        extra = signed_link_no_cache_headers()
        return json_response(
            200,
            {
                "downloadUrl": download["download_url"],
                "expiresAt": download["expires_at"],
            },
            headers=extra,
            event=event,
        )
