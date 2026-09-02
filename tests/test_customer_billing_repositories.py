"""Customer invoice and payment repositories: filters, cursors, and linkage lookups."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from app.db.models.enums import BillingInvoiceStatus
from app.db.repositories.customer_invoice import (
    INVOICE_SETTLEMENT_FILTERS,
    CustomerInvoiceRepository,
)
from app.db.repositories.customer_payment import CustomerPaymentRepository


def _compiled(stmt: object) -> str:
    return str(
        stmt.compile(  # type: ignore[attr-defined]
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


def _session() -> MagicMock:
    session = MagicMock()
    session.execute.return_value.scalars.return_value.all.return_value = []
    session.execute.return_value.all.return_value = []
    session.execute.return_value.scalar_one.return_value = False
    return session


def test_invoice_list_newest_orders_by_created_then_id_and_applies_limit() -> None:
    session = _session()
    CustomerInvoiceRepository(session).list_newest(limit=26)
    sql = _compiled(session.execute.call_args[0][0])
    assert (
        "ORDER BY customer_invoices.created_at DESC, customer_invoices.id DESC" in sql
    )
    assert "LIMIT 26" in sql
    assert "WHERE" not in sql


def test_invoice_list_newest_applies_cursor_status_currency_and_search() -> None:
    session = _session()
    cursor_id = uuid4()
    CustomerInvoiceRepository(session).list_newest(
        limit=10,
        cursor_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        cursor_id=cursor_id,
        status=BillingInvoiceStatus.DRAFT,
        currency="HKD",
        search="50%_off",
    )
    sql = _compiled(session.execute.call_args[0][0])
    assert "customer_invoices.status = 'draft'" in sql
    assert "customer_invoices.currency = 'HKD'" in sql
    assert "customer_invoices.created_at <" in sql
    assert str(cursor_id) in sql
    # ``%`` and ``_`` in user input are escaped so they match literally
    # (the psycopg dialect doubles ``%`` and ``\\`` when rendering literals).
    assert "ILIKE '%%50\\\\%%\\\\_off%%' ESCAPE '\\\\'" in sql


@pytest.mark.parametrize("settlement", INVOICE_SETTLEMENT_FILTERS)
def test_invoice_list_newest_settlement_filters_compile(settlement: str) -> None:
    session = _session()
    CustomerInvoiceRepository(session).list_newest(limit=5, settlement=settlement)
    sql = _compiled(session.execute.call_args[0][0])
    assert "WHERE" in sql
    if settlement == "not_completed":
        assert "customer_invoices.status = 'draft'" in sql
    else:
        assert "customer_invoices.status = 'issued'" in sql


def test_invoice_line_counts_short_circuit_and_group() -> None:
    session = _session()
    repo = CustomerInvoiceRepository(session)
    assert repo.line_counts_by_invoice_id([]) == {}
    session.execute.assert_not_called()

    inv_id = uuid4()
    session.execute.return_value.all.return_value = [(inv_id, 3)]
    assert repo.line_counts_by_invoice_id([inv_id]) == {inv_id: 3}
    assert "GROUP BY customer_invoice_lines.invoice_id" in _compiled(
        session.execute.call_args[0][0]
    )


def test_payment_list_newest_joins_allocations_when_invoice_filter_given() -> None:
    session = _session()
    invoice_id = uuid4()
    CustomerPaymentRepository(session).list_newest(limit=26, invoice_id=invoice_id)
    sql = _compiled(session.execute.call_args[0][0])
    assert "JOIN (SELECT DISTINCT payment_allocations.payment_id" in sql
    assert str(invoice_id) in sql
    assert (
        "ORDER BY customer_payments.created_at DESC, customer_payments.id DESC" in sql
    )
    assert "LIMIT 26" in sql


def test_payment_linkage_lookups_return_sets_and_skip_null_refund_parents() -> None:
    session = _session()
    repo = CustomerPaymentRepository(session)
    pay_a, pay_b = uuid4(), uuid4()

    session.execute.return_value.all.return_value = [(pay_a,)]
    assert repo.payment_ids_with_allocations([pay_a, pay_b]) == {pay_a}
    assert repo.payment_ids_with_receipts([pay_a, pay_b]) == {pay_a}

    session.execute.return_value.all.return_value = [(pay_b,), (None,)]
    assert repo.refunded_payment_ids([pay_a, pay_b]) == {pay_b}
    assert "customer_payments.direction = 'refund'" in _compiled(
        session.execute.call_args[0][0]
    )


def test_payment_enrollment_status_lookup_short_circuits_on_empty() -> None:
    session = _session()
    assert CustomerPaymentRepository(session).enrollment_status_by_id([]) == {}
    session.execute.assert_not_called()


def test_payment_exists_checks_coerce_scalar_to_bool() -> None:
    session = _session()
    repo = CustomerPaymentRepository(session)
    pay_id = uuid4()
    session.execute.return_value.scalar_one.return_value = 1
    assert repo.has_allocations(pay_id) is True
    assert repo.has_receipt(pay_id) is True
    assert repo.has_refunds(pay_id) is True
    session.execute.return_value.scalar_one.return_value = 0
    assert repo.has_allocations(pay_id) is False
