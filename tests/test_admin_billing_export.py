"""Tests for admin billing CSV export."""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest

from app.api import admin_billing
from app.db.models.enums import (
    BillingBillToKind,
    BillingPaymentDirection,
)
from app.exceptions import ValidationError

from tests.helpers.billing import patch_billing_sessions


def test_export_csv_rejects_invalid_export_version(
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
        path="/v1/admin/billing/export",
        query_params={"export_version": "9"},
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="export_version"):
        admin_billing.handle_admin_billing_request(
            ev, "GET", "/v1/admin/billing/export"
        )


def test_export_csv_returns_next_cursor_when_payment_page_is_full(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)
    p1_id, p2_id = uuid4(), uuid4()

    def _payment(pid: UUID) -> MagicMock:
        payment = MagicMock()
        payment.id = pid
        payment.amount = Decimal("10")
        payment.currency = "HKD"
        payment.stripe_payment_intent_id = None
        payment.stripe_refund_id = None
        payment.enrollment_id = None
        payment.created_at = created
        payment.direction = BillingPaymentDirection.INBOUND
        payment.method = "stripe_card"
        payment.external_reference = None
        payment.confirmed_by = None
        payment.original_payment_id = None
        return payment

    class _FakeResult:
        def __init__(self, rows: list[Any]) -> None:
            self._rows = rows

        def scalars(self) -> "_FakeResult":
            return self

        def all(self) -> list[Any]:
            return self._rows

    class _FakeSession:
        def execute(self, _stmt: Any) -> _FakeResult:
            return _FakeResult([_payment(p1_id), _payment(p2_id)])

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield _FakeSession()

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/export",
        query_params={"export_version": "1", "limit": "1"},
        authorizer_context=admin_identity,
    )
    response = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/export"
    )
    body = json.loads(response["body"])
    assert response["statusCode"] == 200
    assert "payment" in body["csv"]
    assert body["next_cursor"]


def test_export_csv_includes_auxiliary_rows_only_on_first_page(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)
    payment_id = uuid4()
    alloc_id = uuid4()
    invoice_id = uuid4()

    def _payment() -> MagicMock:
        payment = MagicMock()
        payment.id = payment_id
        payment.amount = Decimal("10")
        payment.currency = "HKD"
        payment.stripe_payment_intent_id = None
        payment.stripe_refund_id = None
        payment.enrollment_id = None
        payment.created_at = created
        payment.direction = BillingPaymentDirection.INBOUND
        payment.method = "stripe_card"
        payment.external_reference = None
        payment.confirmed_by = None
        payment.original_payment_id = None
        return payment

    def _allocation() -> MagicMock:
        alloc = MagicMock()
        alloc.id = alloc_id
        alloc.allocated_amount = Decimal("5")
        alloc.currency = "HKD"
        alloc.invoice_id = invoice_id
        alloc.invoice_line_id = None
        alloc.created_at = created
        return alloc

    def _invoice() -> MagicMock:
        inv = MagicMock()
        inv.id = invoice_id
        inv.total = Decimal("100")
        inv.currency = "HKD"
        inv.tax_total = Decimal("0")
        inv.bill_to_snapshot = {"display_name": "Client"}
        inv.bill_to_kind = BillingBillToKind.CONTACT
        inv.bill_to_email = "client@example.com"
        inv.bill_to_display_name = "Client"
        inv.invoice_number = "INV-1"
        inv.created_at = created
        return inv

    class _FakeResult:
        def __init__(self, rows: list[Any]) -> None:
            self._rows = rows

        def scalars(self) -> "_FakeResult":
            return self

        def all(self) -> list[Any]:
            return self._rows

    class _FakeSession:
        def __init__(self) -> None:
            self.execute_calls = 0

        def execute(self, stmt: Any) -> _FakeResult:
            self.execute_calls += 1
            sql = str(stmt)
            if "customer_payments" in sql:
                return _FakeResult([_payment()])
            if "payment_allocations" in sql:
                return _FakeResult([_allocation()])
            if "customer_invoices" in sql:
                return _FakeResult([_invoice()])
            if "customer_receipts" in sql:
                return _FakeResult([])
            if "customer_invoice_lines" in sql:
                return _FakeResult([])
            return _FakeResult([])

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield _FakeSession()

    patch_billing_sessions(monkeypatch, _fake_session)

    first_ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/export",
        query_params={"export_version": "2", "limit": "1"},
        authorizer_context=admin_identity,
    )
    first = admin_billing.handle_admin_billing_request(
        first_ev, "GET", "/v1/admin/billing/export"
    )
    first_body = json.loads(first["body"])
    first_csv = first_body["csv"]
    assert "allocation" in first_csv
    assert "invoice" in first_csv


def test_export_csv_paged_response_omits_auxiliary_rows(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)
    p1_id, p2_id = uuid4(), uuid4()
    alloc_id = uuid4()

    def _payment(pid: UUID) -> MagicMock:
        payment = MagicMock()
        payment.id = pid
        payment.amount = Decimal("10")
        payment.currency = "HKD"
        payment.stripe_payment_intent_id = None
        payment.stripe_refund_id = None
        payment.enrollment_id = None
        payment.created_at = created
        payment.direction = BillingPaymentDirection.INBOUND
        payment.method = "stripe_card"
        payment.external_reference = None
        payment.confirmed_by = None
        payment.original_payment_id = None
        return payment

    def _allocation() -> MagicMock:
        alloc = MagicMock()
        alloc.id = alloc_id
        alloc.allocated_amount = Decimal("5")
        alloc.currency = "HKD"
        alloc.invoice_id = uuid4()
        alloc.invoice_line_id = None
        alloc.created_at = created
        return alloc

    class _FakeResult:
        def __init__(self, rows: list[Any]) -> None:
            self._rows = rows

        def scalars(self) -> "_FakeResult":
            return self

        def all(self) -> list[Any]:
            return self._rows

    page_state = {"cursor": None}

    class _FakeSession:
        def execute(self, stmt: Any) -> _FakeResult:
            sql = str(stmt)
            if "customer_payments" in sql:
                if page_state["cursor"] is None:
                    return _FakeResult([_payment(p1_id), _payment(p2_id)])
                return _FakeResult([_payment(p2_id)])
            if page_state["cursor"] is None and "payment_allocations" in sql:
                return _FakeResult([_allocation()])
            if page_state["cursor"] is None and "customer_invoices" in sql:
                return _FakeResult([])
            if page_state["cursor"] is None and "customer_receipts" in sql:
                return _FakeResult([])
            if "customer_invoice_lines" in sql:
                return _FakeResult([])
            return _FakeResult([])

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield _FakeSession()

    patch_billing_sessions(monkeypatch, _fake_session)

    first_ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/export",
        query_params={"export_version": "1", "limit": "1"},
        authorizer_context=admin_identity,
    )
    first = admin_billing.handle_admin_billing_request(
        first_ev, "GET", "/v1/admin/billing/export"
    )
    first_body = json.loads(first["body"])
    assert first_body["csv"].count("allocation") == 1
    assert first_body["next_cursor"]

    page_state["cursor"] = first_body["next_cursor"]
    second_ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/export",
        query_params={
            "export_version": "1",
            "limit": "1",
            "cursor": first_body["next_cursor"],
        },
        authorizer_context=admin_identity,
    )
    second = admin_billing.handle_admin_billing_request(
        second_ev, "GET", "/v1/admin/billing/export"
    )
    second_body = json.loads(second["body"])
    assert "allocation" not in second_body["csv"]
    assert second_body["next_cursor"] is None
