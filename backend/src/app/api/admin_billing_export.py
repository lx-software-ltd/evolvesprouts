"""Admin billing: CSV export."""

from __future__ import annotations

import base64
import csv
import io
import json
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.api.admin_request import parse_limit, query_param
from app.db.audit import session_with_audit
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.customer_receipt import CustomerReceipt
from app.db.models.enums import BillingPaymentDirection
from app.db.models.payment_allocation import PaymentAllocation
from app.exceptions import ValidationError
from app.utils import json_response

_DEFAULT_EXPORT_LIMIT = 1000
_MAX_EXPORT_LIMIT = 5000
# Non-payment entities are included once on the first page only (cursor omitted).
_MAX_ALLOCATION_EXPORT_ROWS = 10000
_MAX_INVOICE_EXPORT_ROWS = 5000
_MAX_RECEIPT_EXPORT_ROWS = 5000


def _encode_export_cursor(created_at: datetime, payment_id: UUID) -> str:
    payload = {
        "created_at": created_at.isoformat(),
        "payment_id": str(payment_id),
    }
    return base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")


def _parse_export_cursor(raw: str | None) -> tuple[datetime, UUID] | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        decoded = base64.urlsafe_b64decode(str(raw).strip().encode("ascii"))
        payload = json.loads(decoded.decode("utf-8"))
        created_at = datetime.fromisoformat(str(payload["created_at"]))
        payment_id = UUID(str(payload["payment_id"]))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise ValidationError("Invalid export cursor", field="cursor") from None
    return created_at, payment_id


def _export_csv(
    event: Mapping[str, Any], *, user_sub: str, request_id: str | None
) -> dict[str, Any]:
    raw_ver = (query_param(event, "export_version") or "2").strip().lower()
    if raw_ver not in ("1", "2"):
        raise ValidationError("export_version must be 1 or 2", field="export_version")

    row_limit = parse_limit(
        event, default=_DEFAULT_EXPORT_LIMIT, max_limit=_MAX_EXPORT_LIMIT
    )
    cursor_raw = query_param(event, "cursor")
    cursor = _parse_export_cursor(cursor_raw)

    with session_with_audit(user_sub, request_id) as session:
        allocs: list[PaymentAllocation] = []
        invoices: list[CustomerInvoice] = []
        lines_by_invoice: dict[UUID, list[CustomerInvoiceLine]] = {}
        receipts: list[CustomerReceipt] = []
        if raw_ver == "1":
            payment_query = select(CustomerPayment).order_by(
                CustomerPayment.created_at.desc()
            )
            if cursor is not None:
                cursor_ts, cursor_id = cursor
                payment_query = payment_query.where(
                    (CustomerPayment.created_at < cursor_ts)
                    | (
                        (CustomerPayment.created_at == cursor_ts)
                        & (CustomerPayment.id < cursor_id)
                    )
                )
            payments = (
                session.execute(payment_query.limit(row_limit + 1)).scalars().all()
            )
            has_more = len(payments) > row_limit
            payments_page = list(payments[:row_limit])
            if cursor is None:
                allocs = list(
                    session.execute(
                        select(PaymentAllocation).limit(_MAX_ALLOCATION_EXPORT_ROWS)
                    )
                    .scalars()
                    .all()
                )
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(
                [
                    "export_version",
                    "document_type",
                    "document_id",
                    "amount",
                    "currency",
                    "stripe_payment_intent_id",
                    "stripe_refund_id",
                    "enrollment_id",
                    "created_at",
                ]
            )
            for p in payments_page:
                w.writerow(
                    [
                        "1",
                        "payment",
                        str(p.id),
                        str(p.amount),
                        p.currency,
                        p.stripe_payment_intent_id or "",
                        p.stripe_refund_id or "",
                        str(p.enrollment_id) if p.enrollment_id else "",
                        p.created_at.isoformat(),
                    ]
                )
            for a in allocs:
                w.writerow(
                    [
                        "1",
                        "allocation",
                        str(a.id),
                        str(a.allocated_amount),
                        a.currency,
                        "",
                        "",
                        "",
                        a.created_at.isoformat(),
                    ]
                )
            next_cursor: str | None = None
            if has_more and payments_page:
                last_payment = payments_page[-1]
                next_cursor = _encode_export_cursor(
                    last_payment.created_at, last_payment.id
                )
            return json_response(
                200,
                {"csv": buf.getvalue(), "next_cursor": next_cursor},
                event=event,
            )

        payment_query = select(CustomerPayment).order_by(
            CustomerPayment.created_at.desc()
        )
        if cursor is not None:
            cursor_ts, cursor_id = cursor
            payment_query = payment_query.where(
                (CustomerPayment.created_at < cursor_ts)
                | (
                    (CustomerPayment.created_at == cursor_ts)
                    & (CustomerPayment.id < cursor_id)
                )
            )
        payments = session.execute(payment_query.limit(row_limit + 1)).scalars().all()
        has_more = len(payments) > row_limit
        payments_page = list(payments[:row_limit])
        if cursor is None:
            allocs = list(
                session.execute(
                    select(PaymentAllocation).limit(_MAX_ALLOCATION_EXPORT_ROWS)
                )
                .scalars()
                .all()
            )
            invoices = list(
                session.execute(
                    select(CustomerInvoice)
                    .order_by(CustomerInvoice.created_at.desc())
                    .limit(_MAX_INVOICE_EXPORT_ROWS)
                )
                .scalars()
                .all()
            )
            inv_ids = [i.id for i in invoices]
            if inv_ids:
                line_rows = (
                    session.execute(
                        select(CustomerInvoiceLine)
                        .where(CustomerInvoiceLine.invoice_id.in_(inv_ids))
                        .order_by(
                            CustomerInvoiceLine.invoice_id,
                            CustomerInvoiceLine.line_order,
                        )
                    )
                    .scalars()
                    .all()
                )
                for ln in line_rows:
                    lines_by_invoice.setdefault(ln.invoice_id, []).append(ln)
            receipts = list(
                session.execute(
                    select(CustomerReceipt)
                    .order_by(CustomerReceipt.created_at.desc())
                    .limit(_MAX_RECEIPT_EXPORT_ROWS)
                )
                .scalars()
                .all()
            )

        def _snap_name(snap: Any) -> str:
            if not snap:
                return ""
            v = snap.get("display_name")
            return str(v) if v else ""

        def _payment_doc_type(p: CustomerPayment) -> str:
            if p.direction == BillingPaymentDirection.REFUND:
                return "refund"
            return "payment"

        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(
            [
                "export_version",
                "document_type",
                "document_id",
                "parent_document_id",
                "amount",
                "currency",
                "payment_method",
                "bank_reference",
                "counterparty_name_snapshot",
                "tax_amount",
                "created_by",
                "stripe_payment_intent_id",
                "stripe_refund_id",
                "original_payment_id",
                "bill_to_kind",
                "bill_to_email",
                "bill_to_display_name",
                "invoice_number",
                "enrollment_id",
                "invoice_line_id",
                "created_at",
            ]
        )
        for p in payments_page:
            w.writerow(
                [
                    "2",
                    _payment_doc_type(p),
                    str(p.id),
                    str(p.original_payment_id) if p.original_payment_id else "",
                    str(p.amount),
                    p.currency,
                    p.method,
                    p.external_reference or "",
                    "",
                    "",
                    p.confirmed_by or "",
                    p.stripe_payment_intent_id or "",
                    p.stripe_refund_id or "",
                    str(p.original_payment_id) if p.original_payment_id else "",
                    "",
                    "",
                    "",
                    "",
                    str(p.enrollment_id) if p.enrollment_id else "",
                    "",
                    p.created_at.isoformat(),
                ]
            )
        for inv in invoices:
            snap = inv.bill_to_snapshot or {}
            w.writerow(
                [
                    "2",
                    "invoice",
                    str(inv.id),
                    "",
                    str(inv.total),
                    inv.currency,
                    "",
                    "",
                    _snap_name(snap if isinstance(snap, Mapping) else {}),
                    str(inv.tax_total),
                    "",
                    "",
                    "",
                    "",
                    inv.bill_to_kind.value,
                    inv.bill_to_email or "",
                    inv.bill_to_display_name or "",
                    inv.invoice_number or "",
                    "",
                    "",
                    # TODO: CSV invoice rows still emit record `created_at`; aligning this column
                    # with admin UI `invoice_date` is a product/export-schema decision (separate change).
                    inv.created_at.isoformat(),
                ]
            )
            for ln in lines_by_invoice.get(inv.id, []):
                w.writerow(
                    [
                        "2",
                        "invoice_line",
                        str(ln.id),
                        str(inv.id),
                        str(ln.line_total),
                        ln.currency,
                        "",
                        "",
                        (ln.description or "")[:200],
                        str(ln.tax_amount) if ln.tax_amount is not None else "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        inv.invoice_number or "",
                        str(ln.enrollment_id) if ln.enrollment_id else "",
                        str(ln.id),
                        ln.created_at.isoformat(),
                    ]
                )
        for r in receipts:
            w.writerow(
                [
                    "2",
                    "receipt",
                    str(r.id),
                    str(r.customer_payment_id),
                    str(r.total_amount),
                    r.currency,
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    r.receipt_number,
                    "",
                    "",
                    r.created_at.isoformat(),
                ]
            )
        for a in allocs:
            w.writerow(
                [
                    "2",
                    "allocation",
                    str(a.id),
                    str(a.invoice_id),
                    str(a.allocated_amount),
                    a.currency,
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    str(a.invoice_id),
                    "",
                    str(a.invoice_line_id) if a.invoice_line_id else "",
                    a.created_at.isoformat(),
                ]
            )

    next_cursor = None
    if has_more and payments_page:
        last_payment = payments_page[-1]
        next_cursor = _encode_export_cursor(last_payment.created_at, last_payment.id)

    return json_response(
        200,
        {"csv": buf.getvalue(), "next_cursor": next_cursor},
        event=event,
    )
