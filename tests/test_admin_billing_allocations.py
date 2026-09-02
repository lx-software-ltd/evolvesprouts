"""Tests for admin billing payment allocations."""

from __future__ import annotations

import json
from contextlib import contextmanager
from decimal import Decimal
from typing import Any
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest

from app.api import admin_billing
from app.api import admin_billing_allocations as admin_billing_allocations_mod
from app.db.models.enums import (
    BillingInvoiceStatus,
)
from app.services import customer_billing


def test_create_allocation_calls_recompute_invoice_settlement(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    inv_id = uuid4()
    touched: list[UUID] = []

    class _Pay:
        id = pay_id
        currency = "HKD"

    class _Inv:
        id = inv_id
        currency = "HKD"
        status = BillingInvoiceStatus.ISSUED

    def _spy_recompute(_session: Any, inv: Any) -> None:
        touched.append(inv.id)

    monkeypatch.setattr(
        admin_billing_allocations_mod,
        "recompute_invoice_settlement",
        _spy_recompute,
    )
    monkeypatch.setattr(
        admin_billing_allocations_mod,
        "maybe_confirm_enrollments_on_positive_invoice_payment_allocation",
        lambda _s, _i: None,
    )
    monkeypatch.setattr(
        admin_billing_allocations_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("500"),
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        pay_res = MagicMock()
        pay_res.scalar_one_or_none.return_value = _Pay()
        s.execute.return_value = pay_res
        s.get.return_value = _Inv()
        yield s

    monkeypatch.setattr(
        admin_billing_allocations_mod, "session_with_audit", _fake_session
    )

    body = {
        "paymentId": str(pay_id),
        "invoiceId": str(inv_id),
        "allocatedAmount": "10",
        "currency": "HKD",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/allocations",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/allocations"
    )
    assert r["statusCode"] == 201
    assert touched == [inv_id]


def test_allocate_no_enrollment_payment_to_customized_invoice(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Payment rows without enrollment_id still allocate when currency matches the invoice."""
    pay_id = uuid4()
    inv_id = uuid4()
    touched: list[UUID] = []

    class _Pay:
        id = pay_id
        currency = "HKD"
        enrollment_id = None

    class _Inv:
        id = inv_id
        currency = "HKD"
        status = BillingInvoiceStatus.ISSUED

    def _spy_recompute(_session: Any, inv: Any) -> None:
        touched.append(inv.id)

    monkeypatch.setattr(
        admin_billing_allocations_mod,
        "recompute_invoice_settlement",
        _spy_recompute,
    )
    monkeypatch.setattr(
        admin_billing_allocations_mod,
        "maybe_confirm_enrollments_on_positive_invoice_payment_allocation",
        lambda _s, _i: None,
    )
    monkeypatch.setattr(
        admin_billing_allocations_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("500"),
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        pay_res = MagicMock()
        pay_res.scalar_one_or_none.return_value = _Pay()
        s.execute.return_value = pay_res
        s.get.return_value = _Inv()
        yield s

    monkeypatch.setattr(
        admin_billing_allocations_mod, "session_with_audit", _fake_session
    )

    body = {
        "paymentId": str(pay_id),
        "invoiceId": str(inv_id),
        "allocatedAmount": "10",
        "currency": "HKD",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/allocations",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/allocations"
    )
    assert r["statusCode"] == 201
    assert touched == [inv_id]


def test_create_allocation_triggers_refresh_invoice_pdf_when_invoice_becomes_paid(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    inv_id = uuid4()
    touched: list[UUID] = []
    refresh_ids: list[UUID] = []

    class _Pay:
        id = pay_id
        currency = "HKD"

    inv = SimpleNamespace(
        id=inv_id,
        currency="HKD",
        status=BillingInvoiceStatus.ISSUED,
        total=Decimal("100"),
        amount_allocated=Decimal("0"),
        balance_due=Decimal("100"),
        paid_at=None,
        issued_pdf_s3_key="billing/invoices/existing.pdf",
    )

    def _spy_recompute(_session: Any, iv: Any) -> None:
        touched.append(iv.id)
        customer_billing.recompute_invoice_settlement(_session, iv)

    def _spy_refresh(_session: Any, iv: Any) -> None:
        refresh_ids.append(iv.id)

    monkeypatch.setattr(
        admin_billing_allocations_mod,
        "recompute_invoice_settlement",
        _spy_recompute,
    )
    monkeypatch.setattr(customer_billing, "refresh_invoice_pdf", _spy_refresh)
    monkeypatch.setattr(
        admin_billing_allocations_mod,
        "maybe_confirm_enrollments_on_positive_invoice_payment_allocation",
        lambda _s, _i: None,
    )
    monkeypatch.setattr(
        admin_billing_allocations_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("500"),
    )

    exec_n = {"n": 0}

    def _exec(_stmt: Any, *_a: Any, **_k: Any) -> Any:
        exec_n["n"] += 1
        m = MagicMock()
        if exec_n["n"] == 1:
            m.scalar_one_or_none.return_value = _Pay()
        elif exec_n["n"] == 2:
            m.scalar_one.return_value = inv
        elif exec_n["n"] == 3:
            m.scalar_one.return_value = Decimal("100")
        else:
            raise AssertionError(f"unexpected session.execute call {exec_n['n']}")
        return m

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.execute.side_effect = _exec
        s.get.return_value = inv
        yield s

    monkeypatch.setattr(
        admin_billing_allocations_mod, "session_with_audit", _fake_session
    )

    body = {
        "paymentId": str(pay_id),
        "invoiceId": str(inv_id),
        "allocatedAmount": "100",
        "currency": "HKD",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/allocations",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/allocations"
    )
    assert r["statusCode"] == 201
    assert touched == [inv_id]
    assert refresh_ids == [inv_id]
