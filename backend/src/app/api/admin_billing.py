"""Admin customer billing (AR) API — router and re-exports."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping

from app.api.admin_billing_allocations import _create_allocation
from app.api.admin_billing_export import _export_csv
from app.api.admin_billing_invoice_queries import (
    get_invoice,
    get_invoice_pdf_download,
    list_invoices,
)
from app.api.admin_billing_dashboard import resolve_bill_to_primary_contacts
from app.api.admin_billing_enrollment_queries import (
    list_recent_enrollments_for_invoicing,
)
from app.api.admin_billing_invoice_drafts import _create_invoice_draft
from app.api.admin_billing_invoices import (
    _delete_draft_invoice,
    _email_invoice,
    _issue_invoice,
    _void_invoice,
)
from app.api.admin_billing_payments import (
    CustomerPayment,
    CustomerReceipt,
    _confirm_payment,
    _create_payment,
    _delete_payment,
    _get_payment,
    _list_payments,
    _unapplied,
    _update_manual_inbound_payment,
)
from app.api.admin_request import (
    parse_uuid,
    request_id,
    require_admin_identity,
    split_route_parts,
)
from app.exceptions import ValidationError
from app.utils import json_response

__all__ = [
    "CustomerPayment",
    "CustomerReceipt",
    "handle_admin_billing_request",
]


def handle_admin_billing_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Route /v1/admin/billing/*."""
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "billing":
        return json_response(404, {"error": "Not found"}, event=event)

    identity = require_admin_identity(event)

    req = request_id(event)

    if len(parts) < 3:
        return json_response(404, {"error": "Not found"}, event=event)

    sub = parts[2]

    if sub == "export" and method == "GET" and len(parts) == 3:
        return _export_csv(event, user_sub=identity.user_sub, request_id=req)

    if sub == "payments" and len(parts) == 3:
        if method == "GET":
            return _list_payments(event, user_sub=identity.user_sub, request_id=req)
        if method == "POST":
            return _create_payment(event, user_sub=identity.user_sub, request_id=req)

    if sub == "payments" and len(parts) == 4:
        pid = parse_uuid(parts[3])
        if method == "GET":
            return _get_payment(event, pid, user_sub=identity.user_sub, request_id=req)
        if method == "PATCH":
            return _update_manual_inbound_payment(
                event, pid, user_sub=identity.user_sub, request_id=req
            )
        if method == "DELETE":
            return _delete_payment(
                event, pid, user_sub=identity.user_sub, request_id=req
            )

    if sub == "payments" and len(parts) == 5 and parts[4] == "unapplied":
        pid = parse_uuid(parts[3])
        if method == "GET":
            return _unapplied(event, pid, user_sub=identity.user_sub, request_id=req)

    if sub == "payments" and len(parts) == 5 and parts[4] == "confirm":
        pid = parse_uuid(parts[3])
        if method == "POST":
            return _confirm_payment(
                event, pid, user_sub=identity.user_sub, request_id=req
            )

    if sub == "invoices" and len(parts) == 3:
        if method == "GET":
            return list_invoices(event, user_sub=identity.user_sub, request_id=req)
        if method == "POST":
            return _create_invoice_draft(
                event, user_sub=identity.user_sub, request_id=req
            )

    if (
        sub == "enrollments"
        and len(parts) == 4
        and parts[3] == "recent-for-invoicing"
        and method == "GET"
    ):
        return list_recent_enrollments_for_invoicing(
            event, user_sub=identity.user_sub, request_id=req
        )

    if (
        sub == "dashboard"
        and len(parts) == 4
        and parts[3] == "resolve-bill-to-primary-contacts"
        and method == "POST"
    ):
        return resolve_bill_to_primary_contacts(
            event, user_sub=identity.user_sub, request_id=req
        )

    if sub == "invoices" and len(parts) == 4:
        inv_id = parse_uuid(parts[3])
        if method == "GET":
            return get_invoice(
                event, inv_id, user_sub=identity.user_sub, request_id=req
            )
        if method == "DELETE":
            return _delete_draft_invoice(
                event, inv_id, user_sub=identity.user_sub, request_id=req
            )

    if sub == "invoices" and len(parts) == 5:
        inv_id = parse_uuid(parts[3])
        action = parts[4]
        if action == "issue" and method == "POST":
            return _issue_invoice(
                event, inv_id, user_sub=identity.user_sub, request_id=req
            )
        if action == "void" and method == "POST":
            return _void_invoice(
                event, inv_id, user_sub=identity.user_sub, request_id=req
            )
        if action == "email" and method == "POST":
            return _email_invoice(
                event, inv_id, user_sub=identity.user_sub, request_id=req
            )
        if action == "pdf" and method == "GET":
            return get_invoice_pdf_download(
                event, inv_id, user_sub=identity.user_sub, request_id=req
            )

    if sub == "allocations" and len(parts) == 3 and method == "POST":
        return _create_allocation(event, user_sub=identity.user_sub, request_id=req)

    return json_response(404, {"error": "Not found"}, event=event)
