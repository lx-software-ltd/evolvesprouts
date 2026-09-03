"""Unit tests for sales daily plan context helpers."""

from app.services.sales_daily_plan_context import (
    MAX_MESSAGE_CHARS,
    _display_name,
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
