"""Tests for admin billing invoice list, detail, email, PDF, and settlement."""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest

from app.api import admin_billing
from app.api import admin_billing_invoice_queries as admin_billing_invoice_queries_mod
from app.api import admin_billing_invoices as admin_billing_invoices_mod
from app.api import admin_billing_payment_create as admin_billing_payment_create_mod
from app.api.admin_billing_invoice_serializers import parse_optional_invoice_settlement
from app.db.models import Contact
from app.db.models.customer_invoice import CustomerInvoice
from app.db.models.enums import (
    BillingBillToKind,
    BillingInvoiceStatus,
    BillingPaymentDirection,
    BillingPaymentStatus,
)
from app.exceptions import ValidationError

from tests.helpers.billing import patch_billing_sessions


def test_list_invoices_returns_items_and_cursor(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    created = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)

    class _Inv:
        id = inv_id
        status = BillingInvoiceStatus.DRAFT
        invoice_number = None
        invoice_sequence = None
        currency = "HKD"
        subtotal = Decimal("100")
        tax_total = Decimal("0")
        total = Decimal("100")
        amount_allocated = Decimal("0")
        balance_due = Decimal("100")
        paid_at = None
        bill_to_kind = BillingBillToKind.CONTACT
        bill_to_contact_id = uuid4()
        bill_to_family_id = None
        bill_to_organization_id = None
        bill_to_display_name = "Test"
        bill_to_email = "t@example.com"
        issued_at = None
        voided_at = None
        void_reason = None
        issued_pdf_sha256 = None
        invoice_date = None
        due_date = None
        created_at = created
        updated_at = created

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.execute.side_effect = [
            MagicMock(scalars=lambda: MagicMock(all=lambda: [_Inv()])),
            MagicMock(all=lambda: [(inv_id, 2)]),
        ]
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/invoices",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == str(inv_id)
    assert body["items"][0]["lineCount"] == 2
    assert body["items"][0]["amountAllocated"] == "0"
    assert body["items"][0]["balanceDue"] == "100"
    assert body["items"][0]["paidAt"] is None
    assert body["items"][0]["isPaid"] is False
    assert body["next_cursor"] is None


def test_get_invoice_returns_detail_with_lines(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    line_id = uuid4()
    en_id = uuid4()
    ts = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)

    class _Line:
        id = line_id
        invoice_id = inv_id
        enrollment_id = en_id
        line_order = 1
        description = "Course"
        quantity = Decimal("1")
        unit_amount = Decimal("100")
        line_total = Decimal("100")
        discount_amount = None
        tax_rate = None
        tax_amount = None
        currency = "HKD"
        created_at = ts
        updated_at = ts

    class _Inv:
        id = inv_id
        status = BillingInvoiceStatus.DRAFT
        invoice_number = None
        invoice_sequence = None
        currency = "HKD"
        subtotal = Decimal("100")
        tax_total = Decimal("0")
        total = Decimal("100")
        amount_allocated = Decimal("0")
        balance_due = Decimal("100")
        paid_at = None
        bill_to_kind = BillingBillToKind.CONTACT
        bill_to_contact_id = uuid4()
        bill_to_family_id = None
        bill_to_organization_id = None
        bill_to_display_name = "Test"
        bill_to_email = "t@example.com"
        issued_at = None
        voided_at = None
        void_reason = None
        bill_to_snapshot = {"kind": "contact"}
        issued_pdf_sha256 = None
        email_sent_at = None
        invoice_date = None
        due_date = None
        created_at = ts
        updated_at = ts
        lines = [_Line()]

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.execute.return_value.scalar_one_or_none.return_value = _Inv()
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="GET",
        path=f"/v1/admin/billing/invoices/{inv_id}",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", f"/v1/admin/billing/invoices/{inv_id}"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["invoice"]["id"] == str(inv_id)
    assert len(body["invoice"]["lines"]) == 1
    assert body["invoice"]["lines"][0]["id"] == str(line_id)
    assert body["invoice"]["amountAllocated"] == "0"
    assert body["invoice"]["balanceDue"] == "100"
    assert body["invoice"]["paidAt"] is None
    assert body["invoice"]["isPaid"] is False


def test_delete_draft_invoice_succeeds(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    inv = MagicMock()
    inv.id = inv_id
    inv.status = BillingInvoiceStatus.DRAFT

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerInvoice and pk == inv_id:
                return inv
            return None

        s.get.side_effect = _get
        ex = MagicMock()
        ex.scalar_one.return_value = 0
        s.execute.return_value = ex
        yield s

    class _FakeAudit:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            pass

        def log_custom(self, **_kw: Any) -> None:
            return None

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(admin_billing_invoices_mod, "AuditService", _FakeAudit)

    ev = api_gateway_event(
        method="DELETE",
        path=f"/v1/admin/billing/invoices/{inv_id}",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "DELETE", f"/v1/admin/billing/invoices/{inv_id}"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["invoiceId"] == str(inv_id)
    assert body["deleted"] is True


def test_delete_draft_invoice_rejects_issued(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    inv = MagicMock()
    inv.id = inv_id
    inv.status = BillingInvoiceStatus.ISSUED

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerInvoice and pk == inv_id:
                return inv
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="DELETE",
        path=f"/v1/admin/billing/invoices/{inv_id}",
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="Only draft"):
        admin_billing.handle_admin_billing_request(
            ev, "DELETE", f"/v1/admin/billing/invoices/{inv_id}"
        )


def test_delete_draft_invoice_rejects_when_allocations_exist(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    inv = MagicMock()
    inv.id = inv_id
    inv.status = BillingInvoiceStatus.DRAFT

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerInvoice and pk == inv_id:
                return inv
            return None

        s.get.side_effect = _get
        ex = MagicMock()
        ex.scalar_one.return_value = 1
        s.execute.return_value = ex
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="DELETE",
        path=f"/v1/admin/billing/invoices/{inv_id}",
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="allocations"):
        admin_billing.handle_admin_billing_request(
            ev, "DELETE", f"/v1/admin/billing/invoices/{inv_id}"
        )


def test_get_invoice_pdf_returns_signed_url(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()

    class _Inv:
        id = inv_id
        status = BillingInvoiceStatus.DRAFT
        lines = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.execute.return_value.scalar_one_or_none.return_value = _Inv()
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    monkeypatch.setattr(
        admin_billing_invoice_queries_mod,
        "ensure_invoice_pdf_storage",
        lambda _session, _inv: "billing/invoices/preview/x.pdf",
    )

    def _fake_download(
        *, s3_key: str, cache_bust_key: str | None = None
    ) -> dict[str, str]:
        assert s3_key == "billing/invoices/preview/x.pdf"
        assert cache_bust_key is not None and cache_bust_key.isdigit()
        return {
            "download_url": "https://cdn.example.com/signed",
            "expires_at": "2026-12-31T00:00:00+00:00",
        }

    monkeypatch.setattr(
        admin_billing_invoice_queries_mod,
        "generate_download_url",
        _fake_download,
    )

    ev = api_gateway_event(
        method="GET",
        path=f"/v1/admin/billing/invoices/{inv_id}/pdf",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", f"/v1/admin/billing/invoices/{inv_id}/pdf"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["downloadUrl"] == "https://cdn.example.com/signed"
    assert body["expiresAt"] == "2026-12-31T00:00:00+00:00"


def test_list_invoices_rejects_invalid_currency_length(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/invoices",
        query_params={"currency": "HK"},
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="currency"):
        admin_billing.handle_admin_billing_request(
            ev, "GET", "/v1/admin/billing/invoices"
        )


def test_list_invoices_returns_next_cursor_when_has_more(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv1, inv2 = uuid4(), uuid4()
    created = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)

    def _make_inv(iid: UUID) -> MagicMock:
        inv = MagicMock()
        inv.id = iid
        inv.status = BillingInvoiceStatus.DRAFT
        inv.invoice_number = None
        inv.invoice_sequence = None
        inv.currency = "HKD"
        inv.subtotal = Decimal("1")
        inv.tax_total = Decimal("0")
        inv.total = Decimal("1")
        inv.amount_allocated = Decimal("0")
        inv.balance_due = Decimal("1")
        inv.paid_at = None
        inv.bill_to_kind = BillingBillToKind.CONTACT
        inv.bill_to_contact_id = None
        inv.bill_to_family_id = None
        inv.bill_to_organization_id = None
        inv.bill_to_display_name = None
        inv.bill_to_email = None
        inv.issued_at = None
        inv.voided_at = None
        inv.void_reason = None
        inv.issued_pdf_sha256 = None
        inv.created_at = created
        inv.updated_at = created
        return inv

    row1, row2 = _make_inv(inv1), _make_inv(inv2)

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.execute.side_effect = [
            MagicMock(scalars=lambda: MagicMock(all=lambda: [row1, row2])),
            MagicMock(all=lambda: []),
        ]
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/invoices",
        query_params={"limit": "1"},
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert len(body["items"]) == 1
    assert body["next_cursor"] is not None


def test_list_invoices_filters_by_currency_and_status(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            captured.append(stmt)
            out = MagicMock()
            out.scalars.return_value.all.return_value = []
            out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/invoices",
        query_params={"currency": "HKD", "status": "draft"},
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 200
    assert captured
    stmt_text = str(captured[0]).lower()
    assert "customer_invoices.currency" in stmt_text
    assert "customer_invoices.status" in stmt_text


@pytest.mark.parametrize(
    ("settlement", "needles"),
    [
        (
            "open",
            ("customer_invoices.balance_due", "customer_invoices.status"),
        ),
        (
            "partially_paid",
            (
                "customer_invoices.amount_allocated",
                "customer_invoices.balance_due",
                "customer_invoices.status",
            ),
        ),
        (
            "paid",
            (
                "customer_invoices.balance_due",
                "customer_invoices.amount_allocated",
                "customer_invoices.total",
                "customer_invoices.status",
            ),
        ),
        (
            "no_charge",
            (
                "customer_invoices.total",
                "customer_invoices.status",
            ),
        ),
        (
            "not_completed",
            (
                ":status_1",
                " or customer_invoices.status = :status_2",
                "customer_invoices.total",
                "customer_invoices.balance_due",
                "customer_invoices.amount_allocated",
            ),
        ),
    ],
)
def test_list_invoices_filters_by_settlement_slice_sql(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    settlement: str,
    needles: tuple[str, ...],
) -> None:
    captured: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            captured.append(stmt)
            out = MagicMock()
            out.scalars.return_value.all.return_value = []
            out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/invoices",
        query_params={"settlement": settlement},
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 200
    assert captured
    stmt_text = str(captured[0]).lower()
    for needle in needles:
        assert needle in stmt_text, (settlement, needle, stmt_text[:500])


def test_list_invoices_combined_settlement_currency_and_q_sql(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            captured.append(stmt)
            out = MagicMock()
            out.scalars.return_value.all.return_value = []
            out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/invoices",
        query_params={"settlement": "open", "currency": "HKD", "q": "INV-9"},
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 200
    assert captured
    stmt_text = str(captured[0]).lower()
    assert "customer_invoices.balance_due" in stmt_text
    assert "customer_invoices.currency" in stmt_text
    assert "customer_invoices.invoice_number" in stmt_text


def test_list_invoices_filters_by_contact_id(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            captured.append(stmt)
            out = MagicMock()
            out.scalars.return_value.all.return_value = []
            out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    contact_id = "11111111-1111-1111-1111-111111111111"
    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/invoices",
        query_params={"contact_id": contact_id},
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 200
    list_stmt = next(
        stmt
        for stmt in captured
        if "customer_invoices.bill_to_contact_id" in str(stmt).lower()
    )
    assert "customer_invoices.bill_to_contact_id" in str(list_stmt).lower()


def test_list_invoices_applies_free_text_query_param(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            captured.append(stmt)
            out = MagicMock()
            out.scalars.return_value.all.return_value = []
            out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/invoices",
        query_params={"q": "Acme"},
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/invoices"
    )
    assert r["statusCode"] == 200
    assert captured
    stmt_text = str(captured[0]).lower()
    assert "customer_invoices.invoice_number" in stmt_text
    assert "to_char" in stmt_text


def test_email_invoice_accepts_comma_separated_recipients(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    captured: dict[str, Any] = {}

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield MagicMock()

    def _fake_send_invoice_email(
        _session: Any, *, invoice_id: UUID, to_addresses: list[str]
    ) -> None:
        captured["invoice_id"] = invoice_id
        captured["to_addresses"] = to_addresses

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        "app.api.admin_billing_invoices.send_invoice_email",
        _fake_send_invoice_email,
    )

    ev = api_gateway_event(
        method="POST",
        path=f"/v1/admin/billing/invoices/{inv_id}/email",
        body=json.dumps({"toEmail": " a@example.com ; b@example.com "}),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", f"/v1/admin/billing/invoices/{inv_id}/email"
    )
    assert r["statusCode"] == 200
    assert captured["invoice_id"] == inv_id
    assert captured["to_addresses"] == ["a@example.com", "b@example.com"]


def test_email_invoice_rejects_invalid_email(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield MagicMock()

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="POST",
        path=f"/v1/admin/billing/invoices/{inv_id}/email",
        body=json.dumps({"toEmail": "not-an-email"}),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="toEmail"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", f"/v1/admin/billing/invoices/{inv_id}/email"
        )


def test_parse_optional_invoice_settlement_accepts_known_values() -> None:
    assert parse_optional_invoice_settlement(None) is None
    assert parse_optional_invoice_settlement("") is None
    assert parse_optional_invoice_settlement("OPEN") == "open"
    assert parse_optional_invoice_settlement("partially_paid") == "partially_paid"


def test_parse_optional_invoice_settlement_accepts_no_charge() -> None:
    assert parse_optional_invoice_settlement("no_charge") == "no_charge"
    assert parse_optional_invoice_settlement("NO_CHARGE") == "no_charge"


def test_parse_optional_invoice_settlement_accepts_not_completed() -> None:
    assert parse_optional_invoice_settlement("not_completed") == "not_completed"
    assert parse_optional_invoice_settlement("NOT_COMPLETED") == "not_completed"


def test_parse_optional_invoice_settlement_rejects_unknown() -> None:
    with pytest.raises(ValidationError) as exc_info:
        parse_optional_invoice_settlement("overdue")
    msg = str(exc_info.value)
    assert "settlement" in msg.lower()
    assert "no_charge" in msg


def test_list_invoices_rejects_invalid_settlement_query_param(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield MagicMock()

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/invoices",
        query_params={"settlement": "bogus"},
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="settlement"):
        admin_billing.handle_admin_billing_request(
            ev, "GET", "/v1/admin/billing/invoices"
        )


def test_void_invoice_calls_recompute_invoice_settlement(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    touched: list[UUID] = []

    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        voided_at=None,
        void_reason=None,
    )

    def _spy_recompute(_session: Any, iv: Any) -> None:
        touched.append(iv.id)

    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "recompute_invoice_settlement",
        _spy_recompute,
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerInvoice and pk == inv_id:
                return inv
            return None

        s.get.side_effect = _get
        yield s

    monkeypatch.setattr(admin_billing_invoices_mod, "session_with_audit", _fake_session)

    ev = api_gateway_event(
        method="POST",
        path=f"/v1/admin/billing/invoices/{inv_id}/void",
        body=json.dumps({"reason": "customer request"}),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", f"/v1/admin/billing/invoices/{inv_id}/void"
    )
    assert r["statusCode"] == 200
    assert touched == [inv_id]


def test_issue_invoice_calls_recompute_invoice_settlement(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INVOICE_PAYMENT_TERMS_DAYS", "7")
    inv_id = uuid4()
    bill_cid = uuid4()
    touched: list[UUID] = []

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

    def _spy_recompute(_session: Any, iv: Any) -> None:
        touched.append(iv.id)

    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "recompute_invoice_settlement",
        _spy_recompute,
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "next_invoice_number",
        lambda _session: ("INV-SPY-1", 1),
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod, "refresh_invoice_pdf", lambda *_a, **_k: None
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "maybe_confirm_enrollments_on_zero_total_invoice_issue",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "create_pending_payment_for_issued_invoice",
        lambda *_a, **_k: None,
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

    monkeypatch.setattr(admin_billing_invoices_mod, "session_with_audit", _fake_session)

    ev = api_gateway_event(
        method="POST",
        path=f"/v1/admin/billing/invoices/{inv_id}/issue",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", f"/v1/admin/billing/invoices/{inv_id}/issue"
    )
    assert r["statusCode"] == 200
    assert touched == [inv_id]


def _issued_invoice_for_payment_stub(
    *,
    total: Decimal,
    currency: str = "HKD",
    bill_to_kind: BillingBillToKind = BillingBillToKind.CONTACT,
    bill_to_contact_id: UUID | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        total=total,
        currency=currency,
        bill_to_kind=bill_to_kind,
        bill_to_contact_id=bill_to_contact_id,
    )


def test_create_pending_payment_for_issued_invoice_links_single_enrollment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    en_id = uuid4()
    contact_id = uuid4()
    inv = _issued_invoice_for_payment_stub(
        total=Decimal("250.5000"),
        currency="hkd",
        bill_to_contact_id=contact_id,
    )
    session = MagicMock()

    def _add(obj: Any) -> None:
        obj.id = uuid4()

    session.add.side_effect = _add
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "distinct_enrollment_ids_on_invoice",
        lambda _s, _i: [en_id],
    )
    audit = MagicMock()
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "AuditService",
        lambda *_a, **_k: audit,
    )

    pay = admin_billing_payment_create_mod.create_pending_payment_for_issued_invoice(
        session,
        inv,
        user_sub="user-1",
        request_id="req-1",  # type: ignore[arg-type]
    )
    assert pay is not None
    assert pay.direction == BillingPaymentDirection.INBOUND
    assert pay.status == BillingPaymentStatus.PENDING
    assert pay.method == "fps"
    assert pay.amount == Decimal("250.5000")
    assert pay.currency == "HKD"
    assert pay.enrollment_id == en_id
    assert pay.contact_id == contact_id
    assert pay.succeeded_at is None
    assert pay.confirmed_by is None
    session.add.assert_called_once_with(pay)
    audit.log_custom.assert_called_once()
    logged = audit.log_custom.call_args.kwargs
    assert logged["action"] == "INVOICE_ISSUE_PAYMENT_CREATED"
    assert logged["new_values"]["invoice_id"] == str(inv.id)
    assert logged["new_values"]["enrollment_id"] == str(en_id)


def test_create_pending_payment_for_issued_invoice_customized_has_no_enrollment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contact_id = uuid4()
    inv = _issued_invoice_for_payment_stub(
        total=Decimal("80"),
        bill_to_contact_id=contact_id,
    )
    session = MagicMock()
    session.add.side_effect = lambda obj: setattr(obj, "id", uuid4())
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "distinct_enrollment_ids_on_invoice",
        lambda _s, _i: [],
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(),
    )

    pay = admin_billing_payment_create_mod.create_pending_payment_for_issued_invoice(
        session,
        inv,
        user_sub="user-1",
        request_id=None,  # type: ignore[arg-type]
    )
    assert pay is not None
    assert pay.enrollment_id is None
    assert pay.contact_id == contact_id
    assert pay.amount == Decimal("80")
    assert pay.currency == "HKD"
    assert pay.status == BillingPaymentStatus.PENDING


def test_create_pending_payment_for_issued_invoice_multi_enrollment_unsets_enrollment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv = _issued_invoice_for_payment_stub(
        total=Decimal("40"),
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_contact_id=None,
    )
    session = MagicMock()
    session.add.side_effect = lambda obj: setattr(obj, "id", uuid4())
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "distinct_enrollment_ids_on_invoice",
        lambda _s, _i: [uuid4(), uuid4()],
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(),
    )

    pay = admin_billing_payment_create_mod.create_pending_payment_for_issued_invoice(
        session,
        inv,
        user_sub="user-1",
        request_id=None,  # type: ignore[arg-type]
    )
    assert pay is not None
    assert pay.enrollment_id is None
    assert pay.contact_id is None
    assert pay.method == "fps"


def test_create_pending_payment_for_issued_invoice_skips_zero_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv = _issued_invoice_for_payment_stub(total=Decimal("0"))
    session = MagicMock()
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "distinct_enrollment_ids_on_invoice",
        lambda *_a, **_k: pytest.fail("should not query enrollments"),
    )

    pay = admin_billing_payment_create_mod.create_pending_payment_for_issued_invoice(
        session,
        inv,
        user_sub="user-1",
        request_id=None,  # type: ignore[arg-type]
    )
    assert pay is None
    session.add.assert_not_called()


def test_issue_invoice_returns_created_payment_id(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    pay_id = uuid4()
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

    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "recompute_invoice_settlement",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "next_invoice_number",
        lambda _session: ("INV-PAY-1", 1),
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod, "refresh_invoice_pdf", lambda *_a, **_k: None
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "maybe_confirm_enrollments_on_zero_total_invoice_issue",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_billing_invoices_mod,
        "create_pending_payment_for_issued_invoice",
        lambda *_a, **_k: SimpleNamespace(id=pay_id),
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

    monkeypatch.setattr(admin_billing_invoices_mod, "session_with_audit", _fake_session)

    ev = api_gateway_event(
        method="POST",
        path=f"/v1/admin/billing/invoices/{inv_id}/issue",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", f"/v1/admin/billing/invoices/{inv_id}/issue"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["paymentId"] == str(pay_id)
    assert body["invoiceId"] == str(inv_id)
