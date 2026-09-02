"""Serialization helpers for customer invoices."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.enums import BillingInvoiceStatus
from app.db.repositories.customer_invoice import INVOICE_SETTLEMENT_FILTERS
from app.exceptions import ValidationError


def serialize_invoice_line(line: CustomerInvoiceLine) -> dict[str, Any]:
    return {
        "id": str(line.id),
        "invoiceId": str(line.invoice_id),
        "enrollmentId": str(line.enrollment_id) if line.enrollment_id else None,
        "lineOrder": line.line_order,
        "description": line.description,
        "quantity": str(line.quantity),
        "unitAmount": str(line.unit_amount),
        "lineTotal": str(line.line_total),
        "discountAmount": str(line.discount_amount)
        if line.discount_amount is not None
        else None,
        "taxRate": str(line.tax_rate) if line.tax_rate is not None else None,
        "taxAmount": str(line.tax_amount) if line.tax_amount is not None else None,
        "currency": line.currency,
        "createdAt": line.created_at.isoformat(),
        "updatedAt": line.updated_at.isoformat(),
    }


def serialize_invoice_summary(
    inv: CustomerInvoice, *, line_count: int
) -> dict[str, Any]:
    """Summary row; ``lineCount`` is an aggregate over ``customer_invoice_lines``."""
    balance_due = Decimal(str(inv.balance_due))
    total_amt = Decimal(str(inv.total))
    is_paid = (
        inv.status == BillingInvoiceStatus.ISSUED
        and balance_due == Decimal("0")
        and total_amt > Decimal("0")
    )
    return {
        "id": str(inv.id),
        "status": inv.status.value,
        "invoiceNumber": inv.invoice_number,
        "invoiceSequence": inv.invoice_sequence,
        "currency": inv.currency,
        "subtotal": str(inv.subtotal),
        "taxTotal": str(inv.tax_total),
        "total": str(inv.total),
        "amountAllocated": str(inv.amount_allocated),
        "balanceDue": str(inv.balance_due),
        "paidAt": inv.paid_at.isoformat() if inv.paid_at else None,
        "isPaid": is_paid,
        "billToKind": inv.bill_to_kind.value,
        "billToContactId": str(inv.bill_to_contact_id)
        if inv.bill_to_contact_id
        else None,
        "billToFamilyId": str(inv.bill_to_family_id) if inv.bill_to_family_id else None,
        "billToOrganizationId": str(inv.bill_to_organization_id)
        if inv.bill_to_organization_id
        else None,
        "billToDisplayName": inv.bill_to_display_name,
        "billToEmail": inv.bill_to_email,
        "billToLocationText": getattr(inv, "bill_to_location_text", None),
        "issuedAt": inv.issued_at.isoformat() if inv.issued_at else None,
        "invoiceDate": inv.invoice_date.isoformat() if inv.invoice_date else None,
        "dueDate": inv.due_date.isoformat() if inv.due_date else None,
        "voidedAt": inv.voided_at.isoformat() if inv.voided_at else None,
        "issuedPdfSha256": inv.issued_pdf_sha256,
        "lineCount": line_count,
        "createdAt": inv.created_at.isoformat(),
        "updatedAt": inv.updated_at.isoformat(),
    }


def serialize_invoice_detail(inv: CustomerInvoice) -> dict[str, Any]:
    lines = sorted(inv.lines, key=lambda ln: (ln.line_order, ln.id))
    return {
        **serialize_invoice_summary(inv, line_count=len(lines)),
        "voidReason": inv.void_reason,
        "billToSnapshot": inv.bill_to_snapshot,
        "emailSentAt": inv.email_sent_at.isoformat() if inv.email_sent_at else None,
        "lines": [serialize_invoice_line(ln) for ln in lines],
    }


def parse_optional_invoice_status(raw: str | None) -> BillingInvoiceStatus | None:
    if raw is None or str(raw).strip() == "":
        return None
    key = str(raw).strip().lower()
    try:
        return BillingInvoiceStatus(key)
    except ValueError as exc:
        raise ValidationError(
            "status must be one of: draft, issued, void",
            field="status",
        ) from exc


def parse_optional_invoice_settlement(raw: str | None) -> str | None:
    if raw is None or str(raw).strip() == "":
        return None
    key = str(raw).strip().lower()
    if key in INVOICE_SETTLEMENT_FILTERS:
        return key
    raise ValidationError(
        "settlement must be one of: " + ", ".join(INVOICE_SETTLEMENT_FILTERS),
        field="settlement",
    )
