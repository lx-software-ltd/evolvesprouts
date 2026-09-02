"""Admin billing: list and get customer invoices."""

from __future__ import annotations

import time
from collections.abc import Mapping
from typing import Any
from uuid import UUID

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
from app.db.audit import session_with_audit
from app.db.repositories.customer_invoice import CustomerInvoiceRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.customer_billing import ensure_invoice_pdf_storage
from app.utils import json_response

_MAX_INVOICE_LIST_Q_LEN = 200


def list_invoices(
    event: Mapping[str, Any], *, user_sub: str, request_id: str | None
) -> dict[str, Any]:
    """All invoices for the tenant; admin authorization is enforced at API Gateway."""
    limit = parse_limit(event)
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

    with session_with_audit(user_sub, request_id) as session:
        party_clause = None
        if contact_id is not None:
            party_clause = invoice_party_filter(session, contact_id)
        elif family_id is not None:
            party_clause = invoice_family_filter(session, family_id)
        elif organization_id is not None:
            party_clause = invoice_organization_filter(session, organization_id)
        repository = CustomerInvoiceRepository(session)
        rows = repository.list_newest(
            limit=limit + 1,
            cursor_created_at=cursor_ts,
            cursor_id=cursor_id,
            party_clause=party_clause,
            status=status_filter,
            settlement=settlement_filter,
            currency=currency,
            search=q_raw or None,
        )
        has_more = len(rows) > limit
        page = rows[:limit]
        count_map = repository.line_counts_by_invoice_id([r.id for r in page])

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
    with session_with_audit(user_sub, request_id) as session:
        inv = CustomerInvoiceRepository(session).get_with_lines(invoice_id)
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
    with session_with_audit(user_sub, request_id) as session:
        inv = CustomerInvoiceRepository(session).get_with_lines(invoice_id)
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
