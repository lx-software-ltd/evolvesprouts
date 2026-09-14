"""Tests for insight-board comparison, trends, and lead aging."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from app.services.sales_daily_plan_context_enrichment import (
    _days_between,
    build_week_over_week_trends,
    enrich_open_leads,
)
from app.services.sales_daily_plan_insights import apply_comparison, stale_activity_counts
from app.services.sales_daily_plan_payload import compact_priority_memory


def test_stale_activity_counts_zero_without_scalar() -> None:
    counts = stale_activity_counts(
        SimpleNamespace(),
        plan=SimpleNamespace(
            conversation_watermark_at=None,
            pipeline_watermark_at=None,
        ),  # type: ignore[arg-type]
    )
    assert counts == {
        "new_conversation": 0,
        "pipeline_changed": 0,
        "contacts_changed": 0,
    }


def test_apply_comparison_marks_new_without_previous() -> None:
    priorities = [{"title": "Reply", "lead_id": None, "invoice_id": None, "item_key": "Reply\n\n"}]
    dropped = apply_comparison(
        SimpleNamespace(),
        plan=SimpleNamespace(id=uuid4()),  # type: ignore[arg-type]
        priorities=priorities,
    )
    assert dropped == []
    assert priorities[0]["compare_status"] == "new"


def test_compact_priority_memory_keeps_titles() -> None:
    items = compact_priority_memory(
        {
            "priorities": [
                {"title": "Reply to Mei", "lead_id": "lead-1"},
                {"title": ""},
                "ignore",
            ]
        }
    )
    assert items == [{"title": "Reply to Mei", "lead_id": "lead-1", "invoice_id": None}]


def test_enrich_open_leads_adds_day_counts() -> None:
    now = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    leads = [
        {
            "id": str(uuid4()),
            "created_at": "2026-09-01T10:00:00+00:00",
            "last_note_at": "2026-09-08T10:00:00+00:00",
        }
    ]
    enrich_open_leads(SimpleNamespace(), leads, now=now)
    assert leads[0]["days_in_stage"] == 9
    assert leads[0]["days_since_last_contact"] == 2


def test_days_between_and_trends_without_db() -> None:
    now = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    assert _days_between(now, datetime(2026, 9, 8, 9, 0, tzinfo=UTC)) == 2
    trends = build_week_over_week_trends(
        SimpleNamespace(), now=now, funnel={"open_count": 4}
    )
    assert trends["open_count"] == 4
    assert trends["leads_this_week"] == 0
