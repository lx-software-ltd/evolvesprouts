"""Admin billing: draft invoice creation (enrollment merge and customized lines)."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.admin_billing_common import effective_enrollment_bill_to_fks
from app.api.admin_billing_invoice_draft_helpers import (
    _build_enrollment_merge_line_description,
    _decimal_field,
    _enrollment_merge_key,
    _first_present,
    _parse_bill_to_block,
    _resolve_bill_to_party_for_draft,
    _resolve_bill_to_party_from_invoice_fks,
)
from app.api.admin_expenses_common import parse_optional_date
from app.api.admin_request import parse_body
from app.config import get_default_currency_code
from app.db.audit import AuditService, session_with_audit
from app.db.models import Contact, Enrollment, Family, Organization
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.enums import BillingBillToKind, BillingInvoiceStatus
from app.db.models.service_instance import ServiceInstance
from app.exceptions import ValidationError
from app.services.customer_invoice_pdf import today_in_invoice_display_tz_or_utc
from app.utils import json_response

_CUSTOMIZED_DRAFT_MAX_LINES = 50
_DESC_MAX_LEN = 500

_INVOICE_DATE_MIN = date(2000, 1, 1)


def _resolve_draft_invoice_date(body: Mapping[str, Any]) -> date:
    raw = _first_present(body, "invoiceDate", "invoice_date")
    if raw is not None:
        try:
            parsed = parse_optional_date(raw)
        except ValidationError as exc:
            raise ValidationError(str(exc), field="invoiceDate") from exc
    else:
        parsed = None
    today = today_in_invoice_display_tz_or_utc()
    chosen = parsed if parsed is not None else today
    if chosen < _INVOICE_DATE_MIN:
        raise ValidationError("invoiceDate is too far in the past", field="invoiceDate")
    if chosen > today + timedelta(days=365):
        raise ValidationError(
            "invoiceDate is too far in the future", field="invoiceDate"
        )
    return chosen


def _create_customized_invoice_draft(
    event: Mapping[str, Any],
    body: Mapping[str, Any],
    *,
    user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    raw_ids = _first_present(body, "enrollmentIds", "enrollment_ids")
    if isinstance(raw_ids, list) and len(raw_ids) > 0:
        raise ValidationError(
            "enrollmentIds must not be sent when draftKind is customized_manual",
            field="enrollmentIds",
        )
    bill_kind, bill_cid, bill_fid, bill_oid = _parse_bill_to_block(body)
    raw_ccy = body.get("currency")
    if raw_ccy is None or str(raw_ccy).strip() == "":
        raise ValidationError("currency is required", field="currency")
    currency = str(raw_ccy).strip().upper()
    if len(currency) != 3:
        raise ValidationError("currency must be a 3-letter ISO code", field="currency")

    raw_lines = body.get("lines")
    if not isinstance(raw_lines, list) or not raw_lines:
        raise ValidationError("lines must be a non-empty array", field="lines")
    if len(raw_lines) > _CUSTOMIZED_DRAFT_MAX_LINES:
        raise ValidationError(
            f"At most {_CUSTOMIZED_DRAFT_MAX_LINES} lines are allowed",
            field="lines",
        )

    inv_date = _resolve_draft_invoice_date(body)

    with session_with_audit(user_sub, request_id) as session:
        if bill_kind == BillingBillToKind.CONTACT:
            if bill_cid is None:
                raise ValidationError("billTo.contactId is required", field="billTo")
            if session.get(Contact, bill_cid) is None:
                raise ValidationError("Contact not found", field="billTo")
        elif bill_kind == BillingBillToKind.FAMILY:
            if bill_fid is None:
                raise ValidationError("billTo.familyId is required", field="billTo")
            if session.get(Family, bill_fid) is None:
                raise ValidationError("Family not found", field="billTo")
        else:
            if bill_oid is None:
                raise ValidationError(
                    "billTo.organizationId is required", field="billTo"
                )
            if session.get(Organization, bill_oid) is None:
                raise ValidationError("Organization not found", field="billTo")

        inv = CustomerInvoice(
            status=BillingInvoiceStatus.DRAFT,
            currency=currency,
            subtotal=Decimal("0"),
            tax_total=Decimal("0"),
            total=Decimal("0"),
            bill_to_kind=bill_kind,
            bill_to_contact_id=bill_cid,
            bill_to_family_id=bill_fid,
            bill_to_organization_id=bill_oid,
            invoice_date=inv_date,
        )
        _resolve_bill_to_party_from_invoice_fks(session, inv=inv)

        session.add(inv)
        session.flush()

        subtotal_pre_tax = Decimal("0")
        tax_sum = Decimal("0")
        for order, raw_ln in enumerate(raw_lines):
            if not isinstance(raw_ln, Mapping):
                raise ValidationError(
                    "Each line must be an object", field=f"lines[{order}]"
                )
            desc = str(raw_ln.get("description") or "").strip()
            if not desc:
                raise ValidationError(
                    "description is required on each line", field=f"lines[{order}]"
                )
            if len(desc) > _DESC_MAX_LEN:
                raise ValidationError(
                    "description must be at most 500 characters",
                    field=f"lines[{order}].description",
                )
            qty = _decimal_field(
                _first_present(raw_ln, "quantity"),
                field=f"lines[{order}].quantity",
            )
            unit_raw = _first_present(raw_ln, "unitAmount", "unit_amount")
            unit_amt = _decimal_field(
                unit_raw,
                field=f"lines[{order}].unitAmount",
            )
            if qty <= 0:
                raise ValidationError(
                    "quantity must be positive", field=f"lines[{order}].quantity"
                )
            extended = qty * unit_amt
            disc_raw = _first_present(raw_ln, "discountAmount", "discount_amount")
            discount = (
                _decimal_field(disc_raw, field=f"lines[{order}].discountAmount")
                if disc_raw is not None and str(disc_raw).strip() != ""
                else Decimal("0")
            )
            if discount < 0 or discount > extended:
                raise ValidationError(
                    "discountAmount must be between 0 and quantity × unitAmount",
                    field=f"lines[{order}].discountAmount",
                )
            taxable = extended - discount
            tax_amt_raw = _first_present(raw_ln, "taxAmount", "tax_amount")
            tax_rate_raw = _first_present(raw_ln, "taxRate", "tax_rate")
            has_tax_amt = tax_amt_raw is not None and str(tax_amt_raw).strip() != ""
            has_tax_rate = tax_rate_raw is not None and str(tax_rate_raw).strip() != ""
            if has_tax_amt and has_tax_rate:
                raise ValidationError(
                    "Provide either taxAmount or taxRate, not both",
                    field=f"lines[{order}].taxAmount",
                )
            if has_tax_amt:
                tax_part = _decimal_field(
                    tax_amt_raw, field=f"lines[{order}].taxAmount"
                )
                tax_rate_val: Decimal | None = None
            elif has_tax_rate:
                rate = _decimal_field(tax_rate_raw, field=f"lines[{order}].taxRate")
                tax_rate_val = rate
                tax_part = (taxable * rate).quantize(
                    Decimal("0.0001"), rounding=ROUND_HALF_UP
                )
            else:
                tax_part = Decimal("0")
                tax_rate_val = None
            if tax_part < 0:
                raise ValidationError(
                    "tax amount must not be negative", field=f"lines[{order}].taxAmount"
                )
            line_total = taxable + tax_part
            disc_val = discount if discount != 0 else None
            tax_amt_val = tax_part if tax_part != 0 else None

            line = CustomerInvoiceLine(
                invoice_id=inv.id,
                enrollment_id=None,
                line_order=order,
                description=desc,
                quantity=qty,
                unit_amount=unit_amt,
                line_total=line_total,
                discount_amount=disc_val,
                tax_rate=tax_rate_val,
                tax_amount=tax_amt_val,
                currency=currency,
            )
            session.add(line)
            subtotal_pre_tax += taxable
            tax_sum += tax_part

        inv.subtotal = subtotal_pre_tax
        inv.tax_total = tax_sum
        inv.total = subtotal_pre_tax + tax_sum
        session.flush()

        audit = AuditService(session, user_id=user_sub, request_id=request_id)
        audit.log_custom(
            table_name="customer_invoices",
            record_id=inv.id,
            action="DRAFT_CREATED_CUSTOMIZED",
            new_values={
                "currency": currency,
                "line_count": len(raw_lines),
                "bill_to_kind": bill_kind.value,
                "bill_to_contact_id": str(bill_cid) if bill_cid else None,
                "bill_to_family_id": str(bill_fid) if bill_fid else None,
                "bill_to_organization_id": str(bill_oid) if bill_oid else None,
                "total": str(inv.total),
                "invoice_date": inv_date.isoformat(),
            },
        )

        return json_response(
            201,
            {"invoiceId": str(inv.id), "status": inv.status.value},
            event=event,
        )


def _create_invoice_draft(
    event: Mapping[str, Any], *, user_sub: str, request_id: str | None
) -> dict[str, Any]:
    body = parse_body(event)
    draft_raw = _first_present(body, "draftKind", "draft_kind")
    if draft_raw is None or str(draft_raw).strip() == "":
        raise ValidationError("draftKind is required", field="draftKind")
    draft_kind = str(draft_raw).strip()
    if draft_kind == "customized_manual":
        return _create_customized_invoice_draft(
            event, body, user_sub=user_sub, request_id=request_id
        )
    if draft_kind != "enrollment_merge":
        raise ValidationError(
            "draftKind must be enrollment_merge or customized_manual",
            field="draftKind",
        )

    bill_to_raw = _first_present(body, "billTo", "bill_to")
    if isinstance(bill_to_raw, Mapping) and len(bill_to_raw) > 0:
        raise ValidationError(
            "billTo must not be sent when draftKind is enrollment_merge",
            field="billTo",
        )
    lines_raw = body.get("lines")
    if isinstance(lines_raw, list) and len(lines_raw) > 0:
        raise ValidationError(
            "lines must not be sent when draftKind is enrollment_merge",
            field="lines",
        )

    raw_ids = _first_present(body, "enrollmentIds", "enrollment_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise ValidationError("enrollmentIds is required", field="enrollmentIds")
    eids: list[UUID] = []
    for x in raw_ids:
        try:
            eids.append(UUID(str(x)))
        except (ValueError, TypeError) as exc:
            raise ValidationError(
                "enrollmentIds must be a list of UUID strings",
                field="enrollmentIds",
            ) from exc
    raw_currency = body.get("currency")
    if raw_currency is None:
        currency_raw = ""
    else:
        currency_raw = str(raw_currency).strip().upper()
    if currency_raw != "" and len(currency_raw) != 3:
        raise ValidationError(
            "currency must be a 3-letter ISO code when provided",
            field="currency",
        )

    overrides_raw = _first_present(
        body, "lineTotalsByEnrollmentId", "line_totals_by_enrollment_id"
    )
    line_overrides: dict[UUID, Decimal] = {}
    if isinstance(overrides_raw, Mapping):
        for k, v in overrides_raw.items():
            try:
                eid_key = UUID(str(k))
                line_overrides[eid_key] = Decimal(str(v))
            except (ValueError, TypeError, InvalidOperation):
                raise ValidationError(
                    "lineTotalsByEnrollmentId must map enrollment UUID strings to amounts",
                    field="lineTotalsByEnrollmentId",
                ) from None

    inv_date = _resolve_draft_invoice_date(body)

    with session_with_audit(user_sub, request_id) as session:
        rows = list(
            session.execute(
                select(Enrollment)
                .where(Enrollment.id.in_(eids))
                .options(
                    joinedload(Enrollment.instance).joinedload(ServiceInstance.service),
                    joinedload(Enrollment.contact),
                    joinedload(Enrollment.ticket_tier),
                )
            )
            .unique()
            .scalars()
            .all()
        )
        by_id = {row.id: row for row in rows}
        missing = [eid for eid in eids if eid not in by_id]
        if missing:
            raise ValidationError(
                f"Enrollment not found: {missing[0]}",
                field="enrollmentIds",
            )
        enrollments = [by_id[eid] for eid in eids]

        default_ccy = get_default_currency_code()
        derived_currencies = {
            (en.currency or default_ccy).upper()[:3] for en in enrollments
        }
        if len(derived_currencies) != 1:
            raise ValidationError(
                "All enrollments must use the same currency",
                field="enrollmentIds",
            )
        derived_currency = next(iter(derived_currencies))
        if currency_raw != "" and currency_raw != derived_currency:
            raise ValidationError(
                "currency must match all enrollments",
                field="currency",
            )
        currency = derived_currency

        keys = {_enrollment_merge_key(e) for e in enrollments}
        if len(keys) != 1:
            raise ValidationError(
                "Merged invoice requires identical bill-to on all enrollments",
                field="enrollmentIds",
            )

        first = enrollments[0]
        bill_kind, bill_cid, bill_fid, bill_oid = effective_enrollment_bill_to_fks(
            first
        )
        inv = CustomerInvoice(
            status=BillingInvoiceStatus.DRAFT,
            currency=currency,
            subtotal=Decimal("0"),
            tax_total=Decimal("0"),
            total=Decimal("0"),
            bill_to_kind=bill_kind,
            bill_to_contact_id=bill_cid,
            bill_to_family_id=bill_fid,
            bill_to_organization_id=bill_oid,
            invoice_date=inv_date,
        )
        _resolve_bill_to_party_for_draft(session, inv=inv, first=first)

        session.add(inv)
        session.flush()

        subtotal = Decimal("0")
        tax_total = Decimal("0")
        for order, en in enumerate(enrollments):
            if en.id in line_overrides:
                line_total = line_overrides[en.id]
            else:
                line_total = en.amount_paid or Decimal("0")
            line_desc = _build_enrollment_merge_line_description(en)
            line = CustomerInvoiceLine(
                invoice_id=inv.id,
                enrollment_id=en.id,
                line_order=order,
                description=line_desc,
                quantity=Decimal("1"),
                unit_amount=line_total,
                line_total=line_total,
                currency=currency,
            )
            session.add(line)
            subtotal += line_total

        inv.subtotal = subtotal
        inv.tax_total = tax_total
        inv.total = subtotal + tax_total
        session.flush()

        audit = AuditService(session, user_id=user_sub, request_id=request_id)
        audit.log_custom(
            table_name="customer_invoices",
            record_id=inv.id,
            action="DRAFT_CREATED",
            new_values={
                "enrollment_ids": [str(x) for x in eids],
                "invoice_date": inv_date.isoformat(),
            },
        )

        return json_response(
            201,
            {"invoiceId": str(inv.id), "status": inv.status.value},
            event=event,
        )
