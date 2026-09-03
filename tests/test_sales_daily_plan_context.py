"""Unit tests for sales daily plan context helpers."""

from datetime import UTC, datetime
from types import SimpleNamespace

from app.services.sales_daily_plan_context import (
    MAX_MESSAGE_CHARS,
    _display_name,
    _earliest_slot_start,
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
