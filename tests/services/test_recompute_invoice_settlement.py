"""Tests for ``recompute_invoice_settlement``."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.db.models.enums import BillingInvoiceStatus
from app.services import customer_billing
from app.services.customer_billing import recompute_invoice_settlement


def _mock_result(scalar_one_value):
    m = MagicMock()
    m.scalar_one.return_value = scalar_one_value
    return m


def test_recompute_zero_allocations_open_balance() -> None:
    inv_id = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        total=Decimal("100.0000"),
        amount_allocated=Decimal("0"),
        balance_due=Decimal("0"),
        paid_at=None,
        issued_pdf_s3_key=None,
    )
    calls = {"n": 0}

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("0"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.amount_allocated == Decimal("0")
    assert inv.balance_due == Decimal("100.0000")
    assert inv.paid_at is None


def test_recompute_partial_allocation_no_paid_at() -> None:
    inv_id = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("0"),
        balance_due=Decimal("0"),
        paid_at=None,
        issued_pdf_s3_key=None,
    )
    calls = {"n": 0}

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("40"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.amount_allocated == Decimal("40")
    assert inv.balance_due == Decimal("60")
    assert inv.paid_at is None


def test_recompute_full_allocation_sets_paid_at() -> None:
    inv_id = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("0"),
        balance_due=Decimal("50"),
        paid_at=None,
        issued_pdf_s3_key=None,
    )
    calls = {"n": 0}

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("100"))

    session = MagicMock()
    session.execute.side_effect = _exec

    before = datetime.now(UTC)
    recompute_invoice_settlement(session, inv)
    after = datetime.now(UTC)

    assert inv.amount_allocated == Decimal("100")
    assert inv.balance_due == Decimal("0")
    assert inv.paid_at is not None
    assert before <= inv.paid_at <= after


def test_recompute_over_allocation_clamps_balance_due() -> None:
    inv_id = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("0"),
        balance_due=Decimal("0"),
        paid_at=None,
        issued_pdf_s3_key=None,
    )
    calls = {"n": 0}

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("120"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.amount_allocated == Decimal("120")
    assert inv.balance_due == Decimal("0")
    assert inv.paid_at is not None


def test_recompute_void_clears_paid_at() -> None:
    inv_id = uuid4()
    ts = datetime(2026, 1, 1, tzinfo=UTC)
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.VOID,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("100"),
        balance_due=Decimal("0"),
        paid_at=ts,
        issued_pdf_s3_key=None,
    )
    calls = {"n": 0}

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("100"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.paid_at is None


def test_recompute_triggers_refresh_invoice_pdf_on_transition_to_paid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("0"),
        balance_due=Decimal("0"),
        paid_at=None,
        issued_pdf_s3_key="billing/invoices/existing.pdf",
    )
    calls = {"n": 0}
    refreshed: list[object] = []

    def _spy_refresh(_session, invoice):
        refreshed.append(invoice.id)

    monkeypatch.setattr(customer_billing, "refresh_invoice_pdf", _spy_refresh)

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("100"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.paid_at is not None
    assert refreshed == [inv_id]


def test_recompute_converts_leads_on_transition_to_paid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("0"),
        balance_due=Decimal("0"),
        paid_at=None,
        issued_pdf_s3_key=None,
    )
    converted: list[object] = []

    def _spy_convert(_session, invoice):
        converted.append(invoice.id)

    monkeypatch.setattr(
        "app.services.lead_invoice_convert.convert_leads_for_paid_invoice",
        _spy_convert,
    )

    session = MagicMock()
    calls = {"n": 0}

    def _exec_counted(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("100"))

    session.execute.side_effect = _exec_counted

    recompute_invoice_settlement(session, inv)

    assert inv.paid_at is not None
    assert converted == [inv_id]


def test_recompute_does_not_convert_on_transition_to_unpaid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    ts = datetime(2026, 1, 1, tzinfo=UTC)
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.VOID,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("100"),
        balance_due=Decimal("0"),
        paid_at=ts,
        issued_pdf_s3_key=None,
    )
    converted: list[object] = []
    monkeypatch.setattr(
        "app.services.lead_invoice_convert.convert_leads_for_paid_invoice",
        lambda *_a, **_k: converted.append("called"),
    )

    calls = {"n": 0}

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("100"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.paid_at is None
    assert converted == []


def test_recompute_triggers_refresh_invoice_pdf_on_transition_to_unpaid_via_void(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    ts = datetime(2026, 1, 1, tzinfo=UTC)
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.VOID,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("100"),
        balance_due=Decimal("0"),
        paid_at=ts,
        issued_pdf_s3_key="billing/invoices/existing.pdf",
    )
    calls = {"n": 0}
    refreshed: list[object] = []

    def _spy_refresh(_session, invoice):
        refreshed.append(invoice.id)

    monkeypatch.setattr(customer_billing, "refresh_invoice_pdf", _spy_refresh)

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("100"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.paid_at is None
    assert refreshed == [inv_id]


def test_recompute_does_not_refresh_when_paid_at_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    ts = datetime(2026, 2, 1, tzinfo=UTC)
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("100"),
        balance_due=Decimal("0"),
        paid_at=ts,
        issued_pdf_s3_key="billing/invoices/existing.pdf",
    )
    calls = {"n": 0}
    refreshed: list[object] = []

    def _spy_refresh(_session, invoice):
        refreshed.append(invoice.id)

    monkeypatch.setattr(customer_billing, "refresh_invoice_pdf", _spy_refresh)

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("100"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.paid_at == ts
    assert refreshed == []


def test_recompute_does_not_refresh_when_no_issued_pdf_yet(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv_id = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        total=Decimal("100"),
        amount_allocated=Decimal("0"),
        balance_due=Decimal("0"),
        paid_at=None,
        issued_pdf_s3_key=None,
    )
    calls = {"n": 0}
    refreshed: list[object] = []

    def _spy_refresh(_session, invoice):
        refreshed.append(invoice.id)

    monkeypatch.setattr(customer_billing, "refresh_invoice_pdf", _spy_refresh)

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("100"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.paid_at is not None
    assert refreshed == []


def test_recompute_zero_total_issued_clears_paid_at() -> None:
    inv_id = uuid4()
    inv = SimpleNamespace(
        id=inv_id,
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        total=Decimal("0"),
        amount_allocated=Decimal("0"),
        balance_due=Decimal("0"),
        paid_at=None,
        issued_pdf_s3_key=None,
    )
    calls = {"n": 0}

    def _exec(_stmt, *_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _mock_result(inv)
        return _mock_result(Decimal("0"))

    session = MagicMock()
    session.execute.side_effect = _exec

    recompute_invoice_settlement(session, inv)

    assert inv.balance_due == Decimal("0")
    assert inv.paid_at is None
