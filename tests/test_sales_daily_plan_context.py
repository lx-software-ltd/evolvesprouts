"""Unit tests for sales daily plan context helpers."""

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

from app.services.sales_daily_plan_context import (
    MAX_MESSAGE_CHARS,
    _display_name,
    _earliest_slot_start,
    _serialize_unpaid_invoice,
    _summarize_unpaid_invoices,
    _truncate,
)


def test_truncate_adds_ellipsis_when_over_limit() -> None:
    text = "x" * (MAX_MESSAGE_CHARS + 10)
    trimmed = _truncate(text, MAX_MESSAGE_CHARS)
    assert trimmed is not None
    assert len(trimmed) == MAX_MESSAGE_CHARS
    assert trimmed.endswith("…")


def test_truncate_returns_none_for_blank() -> None:
    assert _truncate("   ", 20) is None
    assert _truncate(None, 20) is None


def test_display_name_prefers_contact_names() -> None:
    assert _display_name("Mei", "Chen", "IG Name") == "Mei Chen"
    assert _display_name(None, None, "IG Name") == "IG Name"
    assert _display_name(None, None, None) is None


def test_earliest_slot_start_picks_soonest_in_horizon() -> None:
    now = datetime(2026, 9, 3, 12, 0, tzinfo=UTC)
    horizon = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)
    slots = [
        SimpleNamespace(starts_at=datetime(2026, 9, 20, 10, 0, tzinfo=UTC)),
        SimpleNamespace(starts_at=datetime(2026, 9, 10, 9, 0, tzinfo=UTC)),
        SimpleNamespace(starts_at=datetime(2026, 9, 5, 8, 0, tzinfo=UTC)),
    ]
    assert _earliest_slot_start(slots, now=now, horizon=horizon) == datetime(
        2026, 9, 5, 8, 0, tzinfo=UTC
    )
    assert _earliest_slot_start([], now=now, horizon=horizon) is None


def test_serialize_unpaid_invoice_marks_overdue_and_masks_email() -> None:
    today = date(2026, 9, 3)
    invoice = SimpleNamespace(
        id="11111111-1111-1111-1111-111111111111",
        invoice_number="INV-1001",
        bill_to_display_name="Mei Chen",
        bill_to_email="mei@example.com",
        currency="HKD",
        total=Decimal("1500.0000"),
        amount_allocated=Decimal("500.0000"),
        balance_due=Decimal("1000.0000"),
        issued_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        due_date=date(2026, 8, 20),
    )
    payload = _serialize_unpaid_invoice(invoice, today=today)  # type: ignore[arg-type]
    assert payload["is_overdue"] is True
    assert payload["days_overdue"] == 14
    assert payload["is_partially_paid"] is True
    assert payload["bill_to_email"] != "mei@example.com"
    assert "@" in (payload["bill_to_email"] or "")


def test_summarize_unpaid_invoices_totals_by_currency() -> None:
    summary = _summarize_unpaid_invoices(
        [
            {
                "currency": "hkd",
                "balance_due": "100.00",
                "is_overdue": True,
            },
            {
                "currency": "HKD",
                "balance_due": "50.50",
                "is_overdue": False,
            },
            {
                "currency": "USD",
                "balance_due": "20",
                "is_overdue": False,
            },
        ]
    )
    assert summary["count"] == 3
    assert summary["overdue_count"] == 1
    assert summary["total_balance_due_by_currency"] == {
        "HKD": "150.50",
        "USD": "20",
    }
