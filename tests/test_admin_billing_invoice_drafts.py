"""Tests for admin billing invoice draft creation and issue."""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.api import admin_billing
from app.api import admin_billing_invoice_drafts as admin_billing_invoice_drafts_mod
from app.api import admin_billing_invoices as admin_billing_invoices_mod
from app.db.models import Contact
from app.db.models.customer_invoice import CustomerInvoice
from app.db.models.enums import (
    BillingBillToKind,
    BillingInvoiceStatus,
)
from app.exceptions import ValidationError
from app.services import customer_billing

from tests.helpers.billing import patch_billing_sessions


def test_next_invoice_number_increments_per_year(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _CounterRow:
        last_number = 0

    row = _CounterRow()
    n_calls = {"n": 0}

    def _exec(*_a: Any, **_k: Any) -> MagicMock:
        n_calls["n"] += 1
        out = MagicMock()
        out.scalar_one.return_value = row
        return out

    session = MagicMock()
    session.execute.side_effect = _exec
    num, seq = customer_billing.next_invoice_number(session)
    assert seq == 1
    assert row.last_number == 1
    assert num.startswith("INV-")
    assert num.count("-") == 2
    assert n_calls["n"] == 2


def test_create_invoice_draft_rejects_currency_mismatch(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    body = {
        "draftKind": "enrollment_merge",
        "enrollmentIds": [str(eid)],
        "currency": "USD",
    }
    fake_en = MagicMock()
    fake_en.id = eid
    fake_en.currency = "HKD"
    fake_en.instance = None
    fake_en.contact = None
    fake_en.bill_to_kind = None
    fake_en.bill_to_contact_id = None
    fake_en.bill_to_family_id = None
    fake_en.bill_to_organization_id = None

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(_stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            out.unique.return_value.scalars.return_value.all.return_value = [fake_en]
            return out

        s.execute.side_effect = _exec
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="currency"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_invoice_draft_rejects_billto_mismatch(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    e1, e2 = uuid4(), uuid4()
    fam1, fam2 = uuid4(), uuid4()

    def _make_en(eid: Any, fam_id: Any) -> MagicMock:
        en = MagicMock()
        en.id = eid
        en.currency = "HKD"
        en.instance = MagicMock(title="T")
        en.contact = MagicMock(email="a@example.com", first_name="A", last_name="B")
        en.bill_to_kind = BillingBillToKind.FAMILY
        en.bill_to_contact_id = None
        en.bill_to_family_id = fam_id
        en.bill_to_organization_id = None
        return en

    en1 = _make_en(e1, fam1)
    en2 = _make_en(e2, fam2)

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(_stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            out.unique.return_value.scalars.return_value.all.return_value = [en1, en2]
            return out

        s.execute.side_effect = _exec
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    body = {
        "draftKind": "enrollment_merge",
        "enrollmentIds": [str(e1), str(e2)],
        "currency": "HKD",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="bill-to"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_invoice_draft_derives_currency_when_omitted(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()

    fake_en = MagicMock()
    fake_en.id = eid
    fake_en.currency = "USD"
    fake_en.amount_paid = Decimal("10")
    fake_en.instance = MagicMock(title="Inst")
    fake_en.contact = MagicMock(email="u@example.com", first_name="U", last_name="Ser")
    fake_en.bill_to_kind = BillingBillToKind.CONTACT
    fake_en.bill_to_contact_id = None
    fake_en.bill_to_family_id = None
    fake_en.bill_to_organization_id = None

    fake_inv = MagicMock()
    fake_inv.id = uuid4()
    fake_inv.status = MagicMock(value="draft")

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(_stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            out.unique.return_value.scalars.return_value.all.return_value = [fake_en]
            return out

        s.execute.side_effect = _exec
        s.get.side_effect = (
            lambda model, pk: fake_inv if model is CustomerInvoice else None
        )

        def _flush() -> None:
            pass

        s.flush = _flush
        return (yield s)

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "_resolve_bill_to_party_for_draft",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )

    body = {"draftKind": "enrollment_merge", "enrollmentIds": [str(eid)]}
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 201
    payload = json.loads(r["body"])
    assert payload["invoiceId"]


def test_create_invoice_draft_rejects_invalid_currency_length(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    fake_en = MagicMock()
    fake_en.id = eid
    fake_en.currency = "HKD"
    fake_en.instance = None
    fake_en.contact = None
    fake_en.bill_to_kind = None
    fake_en.bill_to_contact_id = None
    fake_en.bill_to_family_id = None
    fake_en.bill_to_organization_id = None

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(_stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            out.unique.return_value.scalars.return_value.all.return_value = [fake_en]
            return out

        s.execute.side_effect = _exec
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )

    body = {
        "draftKind": "enrollment_merge",
        "enrollmentIds": [str(eid)],
        "currency": "US",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="currency"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_invoice_draft_currency_empty_string_derives(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()

    fake_en = MagicMock()
    fake_en.id = eid
    fake_en.currency = "HKD"
    fake_en.amount_paid = Decimal("10")
    fake_en.instance = MagicMock(title="Inst")
    fake_en.contact = MagicMock(email="u@example.com", first_name="U", last_name="Ser")
    fake_en.bill_to_kind = BillingBillToKind.CONTACT
    fake_en.bill_to_contact_id = None
    fake_en.bill_to_family_id = None
    fake_en.bill_to_organization_id = None

    fake_inv = MagicMock()
    fake_inv.id = uuid4()
    fake_inv.status = MagicMock(value="draft")

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(_stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            out.unique.return_value.scalars.return_value.all.return_value = [fake_en]
            return out

        s.execute.side_effect = _exec
        s.get.side_effect = (
            lambda model, pk: fake_inv if model is CustomerInvoice else None
        )

        def _flush() -> None:
            pass

        s.flush = _flush
        return (yield s)

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "_resolve_bill_to_party_for_draft",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )

    body = {
        "draftKind": "enrollment_merge",
        "enrollmentIds": [str(eid)],
        "currency": "",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 201


def test_create_customized_invoice_draft_rejects_missing_currency(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    body = {
        "draftKind": "customized_manual",
        "billTo": {"kind": "contact", "contactId": str(uuid4())},
        "lines": [{"description": "A", "quantity": "1", "unitAmount": "10"}],
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="currency"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_customized_invoice_draft_rejects_contact_not_found(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = uuid4()

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(_model: Any, _pk: Any) -> None:
            return None

        s.get.side_effect = _get
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )

    body = {
        "draftKind": "customized_manual",
        "billTo": {"kind": "contact", "contactId": str(cid)},
        "currency": "HKD",
        "lines": [{"description": "A", "quantity": "1", "unitAmount": "10"}],
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="Contact not found"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_invoice_draft_rejects_enrollment_ids_with_bill_to(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    body = {
        "draftKind": "enrollment_merge",
        "enrollmentIds": [str(uuid4())],
        "billTo": {"kind": "contact", "contactId": str(uuid4())},
        "currency": "HKD",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="billTo must not"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_invoice_draft_requires_draft_kind(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    body = {"enrollmentIds": [str(uuid4())]}
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="draftKind"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_customized_invoice_draft_rejects_description_over_500(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = uuid4()
    fake_c = MagicMock()
    fake_c.first_name = "A"
    fake_c.last_name = "B"
    fake_c.email = "a@example.com"

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: fake_c
            if model.__name__ == "Contact" and pk == cid
            else None
        )
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )

    body = {
        "draftKind": "customized_manual",
        "billTo": {"kind": "contact", "contactId": str(cid)},
        "currency": "HKD",
        "lines": [{"description": "x" * 501, "quantity": "1", "unitAmount": "1"}],
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="500"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_customized_invoice_draft_rejects_both_tax_amount_and_rate(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = uuid4()
    fake_c = MagicMock()
    fake_c.first_name = "A"
    fake_c.last_name = "B"
    fake_c.email = "a@example.com"

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: fake_c
            if model.__name__ == "Contact" and pk == cid
            else None
        )
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )

    body = {
        "draftKind": "customized_manual",
        "billTo": {"kind": "contact", "contactId": str(cid)},
        "currency": "HKD",
        "lines": [
            {
                "description": "A",
                "quantity": "1",
                "unitAmount": "10",
                "taxRate": "0.1",
                "taxAmount": "1",
            }
        ],
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="not both"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_first_present_and_decimal_accepts_numeric_zero() -> None:
    from app.api.admin_billing_invoice_draft_helpers import (
        _decimal_field,
        _first_present,
    )

    raw_ln: dict[str, Any] = {"unitAmount": 0}
    v = _first_present(raw_ln, "unitAmount", "unit_amount")
    assert _decimal_field(v, field="unitAmount") == Decimal("0")


def test_create_customized_invoice_draft_rejects_more_than_50_lines(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    cid = uuid4()
    lines = [
        {"description": "L", "quantity": "1", "unitAmount": "1"} for _ in range(51)
    ]
    body = {
        "draftKind": "customized_manual",
        "billTo": {"kind": "contact", "contactId": str(cid)},
        "currency": "HKD",
        "lines": lines,
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="50"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_customized_invoice_draft_rejects_discount_exceeding_extended(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = uuid4()
    fake_c = MagicMock()
    fake_c.first_name = "A"
    fake_c.last_name = "B"
    fake_c.email = "a@example.com"

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: fake_c
            if model.__name__ == "Contact" and pk == cid
            else None
        )
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )

    body = {
        "draftKind": "customized_manual",
        "billTo": {"kind": "contact", "contactId": str(cid)},
        "currency": "HKD",
        "lines": [
            {
                "description": "A",
                "quantity": "1",
                "unitAmount": "10",
                "discountAmount": "11",
            }
        ],
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="discountAmount"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )


def test_create_customized_invoice_draft_tax_rate_rounds_half_up(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """0.1 * 0.0125 = 0.00125 -> 0.0013 with HALF_UP at 4dp; 0.0012 with HALF_EVEN."""
    from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP

    cid = uuid4()
    fake_c = MagicMock(email="c@example.com", first_name="A", last_name="B")
    fake_inv = MagicMock()
    fake_inv.id = uuid4()
    fake_inv.status = MagicMock(value="draft")
    line_kwargs: list[dict[str, Any]] = []

    def _make_line(**kwargs: Any) -> MagicMock:
        line_kwargs.append(kwargs)
        return MagicMock()

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if getattr(model, "__name__", "") == "Contact" and pk == cid:
                return fake_c
            if model is CustomerInvoice:
                return fake_inv
            return None

        s.get.side_effect = _get

        def _flush() -> None:
            pass

        s.flush = _flush
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "_resolve_bill_to_party_from_invoice_fks",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "CustomerInvoiceLine",
        MagicMock(side_effect=_make_line),
    )

    body = {
        "draftKind": "customized_manual",
        "billTo": {"kind": "contact", "contactId": str(cid)},
        "currency": "HKD",
        "lines": [
            {
                "description": "Tax rounding",
                "quantity": "0.1",
                "unitAmount": "1",
                "taxRate": "0.0125",
            }
        ],
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 201
    assert len(line_kwargs) == 1
    tax_amt = line_kwargs[0]["tax_amount"]
    expected_half_up = (Decimal("0.1") * Decimal("0.0125")).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )
    expected_half_even = (Decimal("0.1") * Decimal("0.0125")).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_EVEN
    )
    assert tax_amt == expected_half_up
    assert expected_half_up != expected_half_even


def test_create_invoice_draft_accepts_invoice_date(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    saved: dict[str, Any] = {}

    fake_en = MagicMock()
    fake_en.id = eid
    fake_en.currency = "USD"
    fake_en.amount_paid = Decimal("10")
    fake_en.instance = MagicMock(title="Inst")
    fake_en.contact = MagicMock(email="u@example.com", first_name="U", last_name="Ser")
    fake_en.bill_to_kind = BillingBillToKind.CONTACT
    fake_en.bill_to_contact_id = None
    fake_en.bill_to_family_id = None
    fake_en.bill_to_organization_id = None

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(_stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            out.unique.return_value.scalars.return_value.all.return_value = [fake_en]
            return out

        def _add(obj: Any) -> None:
            if isinstance(obj, CustomerInvoice):
                saved["inv"] = obj

        s.execute.side_effect = _exec
        s.add.side_effect = _add
        s.get.return_value = None
        s.flush = MagicMock()
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "_resolve_bill_to_party_for_draft",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )

    body = {
        "draftKind": "enrollment_merge",
        "enrollmentIds": [str(eid)],
        "invoiceDate": "2024-12-31",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 201
    assert saved["inv"].invoice_date == date(2024, 12, 31)


def test_create_invoice_draft_accepts_invoice_date_at_upper_bound_in_display_tz(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INVOICE_DISPLAY_TIMEZONE", "Asia/Hong_Kong")
    fixed_today = date(2026, 6, 15)
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "today_in_invoice_display_tz_or_utc",
        lambda: fixed_today,
    )
    eid = uuid4()
    saved: dict[str, Any] = {}

    fake_en = MagicMock()
    fake_en.id = eid
    fake_en.currency = "USD"
    fake_en.amount_paid = Decimal("10")
    fake_en.instance = MagicMock(title="Inst")
    fake_en.contact = MagicMock(email="u@example.com", first_name="U", last_name="Ser")
    fake_en.bill_to_kind = BillingBillToKind.CONTACT
    fake_en.bill_to_contact_id = None
    fake_en.bill_to_family_id = None
    fake_en.bill_to_organization_id = None

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(_stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            out.unique.return_value.scalars.return_value.all.return_value = [fake_en]
            return out

        def _add(obj: Any) -> None:
            if isinstance(obj, CustomerInvoice):
                saved["inv"] = obj

        s.execute.side_effect = _exec
        s.add.side_effect = _add
        s.get.return_value = None
        s.flush = MagicMock()
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "_resolve_bill_to_party_for_draft",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )

    upper = (fixed_today + timedelta(days=365)).isoformat()
    body = {
        "draftKind": "enrollment_merge",
        "enrollmentIds": [str(eid)],
        "invoiceDate": upper,
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 201
    assert saved["inv"].invoice_date == fixed_today + timedelta(days=365)


def test_create_invoice_draft_defaults_invoice_date_to_today(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    saved: dict[str, Any] = {}

    fake_en = MagicMock()
    fake_en.id = eid
    fake_en.currency = "USD"
    fake_en.amount_paid = Decimal("10")
    fake_en.instance = MagicMock(title="Inst")
    fake_en.contact = MagicMock(email="u@example.com", first_name="U", last_name="Ser")
    fake_en.bill_to_kind = BillingBillToKind.CONTACT
    fake_en.bill_to_contact_id = None
    fake_en.bill_to_family_id = None
    fake_en.bill_to_organization_id = None

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(_stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            out.unique.return_value.scalars.return_value.all.return_value = [fake_en]
            return out

        def _add(obj: Any) -> None:
            if isinstance(obj, CustomerInvoice):
                saved["inv"] = obj

        s.execute.side_effect = _exec
        s.add.side_effect = _add
        s.get.return_value = None
        s.flush = MagicMock()
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "_resolve_bill_to_party_for_draft",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )

    body = {"draftKind": "enrollment_merge", "enrollmentIds": [str(eid)]}
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 201
    assert saved["inv"].invoice_date is not None
    assert saved["inv"].invoice_date == datetime.now(UTC).date()


def test_create_customized_invoice_draft_accepts_invoice_date(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = uuid4()
    saved: dict[str, Any] = {}

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is Contact and pk == cid:
                return MagicMock()
            return None

        def _add(obj: Any) -> None:
            if isinstance(obj, CustomerInvoice):
                saved["inv"] = obj

        s.get.side_effect = _get
        s.add.side_effect = _add
        s.flush = MagicMock()
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "_resolve_bill_to_party_from_invoice_fks",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )

    body = {
        "draftKind": "customized_manual",
        "billTo": {"kind": "contact", "contactId": str(cid)},
        "currency": "HKD",
        "lines": [{"description": "A", "quantity": "1", "unitAmount": "10"}],
        "invoiceDate": "2024-06-15",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 201
    assert saved["inv"].invoice_date == date(2024, 6, 15)


def test_create_invoice_draft_rejects_invalid_invoice_date(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    fake_en = MagicMock()
    fake_en.id = eid
    fake_en.currency = "HKD"
    fake_en.instance = None
    fake_en.contact = None
    fake_en.bill_to_kind = None
    fake_en.bill_to_contact_id = None
    fake_en.bill_to_family_id = None
    fake_en.bill_to_organization_id = None

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(_stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            out.unique.return_value.scalars.return_value.all.return_value = [fake_en]
            return out

        s.execute.side_effect = _exec
        yield s

    monkeypatch.setattr(
        admin_billing_invoice_drafts_mod, "session_with_audit", _fake_session
    )

    body = {
        "draftKind": "enrollment_merge",
        "enrollmentIds": [str(eid)],
        "invoiceDate": "not-a-date",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/invoices",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError) as excinfo:
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/invoices"
        )
    assert getattr(excinfo.value, "field", None) == "invoiceDate"


def test_issue_preserves_draft_invoice_date_and_derives_due_date(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INVOICE_PAYMENT_TERMS_DAYS", "7")
    inv_id = uuid4()
    bill_cid = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.DRAFT,
        currency="HKD",
        total=Decimal("100"),
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=bill_cid,
        bill_to_family_id=None,
        bill_to_organization_id=None,
        bill_to_display_name="Pat",
        bill_to_email="p@example.com",
        bill_to_snapshot=None,
        invoice_date=date(2024, 3, 10),
        due_date=None,
        invoice_number=None,
        invoice_sequence=None,
        issued_at=None,
        issued_pdf_sha256="abc",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerInvoice and pk == inv_id:
                return inv
            if model is Contact and pk == bill_cid:
                return SimpleNamespace(
                    id=bill_cid,
                    first_name="P",
                    last_name="N",
                    email="p@example.com",
                )
            return None

        s.get.side_effect = _get
        s.flush = MagicMock()
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "next_invoice_number",
        lambda _session: ("INV-TEST-1", 1),
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod, "refresh_invoice_pdf", lambda *_a, **_k: None
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "recompute_invoice_settlement",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "create_pending_payment_for_issued_invoice",
        lambda *_a, **_k: None,
    )

    ev = api_gateway_event(
        method="POST",
        path=f"/v1/admin/billing/invoices/{inv_id}/issue",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", f"/v1/admin/billing/invoices/{inv_id}/issue"
    )
    assert r["statusCode"] == 200
    assert inv.invoice_date == date(2024, 3, 10)
    assert inv.due_date == date(2024, 3, 17)


def test_issue_legacy_draft_without_invoice_date_uses_snapshot(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INVOICE_DISPLAY_TIMEZONE", "UTC")
    monkeypatch.setenv("INVOICE_PAYMENT_TERMS_DAYS", "7")
    fixed_issue = datetime(2026, 6, 15, 14, 0, 0, tzinfo=UTC)

    class _DateTimeShim:
        UTC = UTC

        @staticmethod
        def now(tz: Any = None) -> datetime:
            return fixed_issue

    monkeypatch.setattr(admin_billing_invoices_mod, "datetime", _DateTimeShim)

    inv_id = uuid4()
    bill_cid = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.DRAFT,
        currency="HKD",
        total=Decimal("100"),
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=bill_cid,
        bill_to_family_id=None,
        bill_to_organization_id=None,
        bill_to_display_name="Pat",
        bill_to_email="p@example.com",
        bill_to_snapshot=None,
        invoice_date=None,
        due_date=None,
        invoice_number=None,
        invoice_sequence=None,
        issued_at=None,
        issued_pdf_sha256="abc",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerInvoice and pk == inv_id:
                return inv
            if model is Contact and pk == bill_cid:
                return SimpleNamespace(
                    id=bill_cid,
                    first_name="P",
                    last_name="N",
                    email="p@example.com",
                )
            return None

        s.get.side_effect = _get
        s.flush = MagicMock()
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "next_invoice_number",
        lambda _session: ("INV-TEST-2", 2),
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod, "refresh_invoice_pdf", lambda *_a, **_k: None
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "recompute_invoice_settlement",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "create_pending_payment_for_issued_invoice",
        lambda *_a, **_k: None,
    )

    ev = api_gateway_event(
        method="POST",
        path=f"/v1/admin/billing/invoices/{inv_id}/issue",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", f"/v1/admin/billing/invoices/{inv_id}/issue"
    )
    assert r["statusCode"] == 200
    assert inv.invoice_date == date(2026, 6, 15)
    assert inv.due_date == date(2026, 6, 22)
