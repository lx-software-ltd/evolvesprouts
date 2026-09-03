"""Tests for org-wide sales daily plan helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from app.services.aws_proxy import AwsProxyError
from app.services.sales_daily_plan import (
    PLAN_STALE_AFTER,
    _format_openrouter_failure,
    evaluate_staleness,
    normalize_plan_payload,
    parse_plan_json_object,
)


def test_parse_plan_json_object_accepts_fenced_payload() -> None:
    parsed = parse_plan_json_object(
        """```json
        {"focus": "Close consults", "priorities": [], "outreach": [],
         "product_focus": "Family Consultations", "offer_refinements": [], "risks": []}
        ```"""
    )
    assert parsed["focus"] == "Close consults"


def test_normalize_plan_payload_coerces_lists() -> None:
    lead_id = str(uuid4())
    payload = normalize_plan_payload(
        {
            "focus": "Follow up MBA leads",
            "priorities": [
                {
                    "title": "Reply to Mei",
                    "why": "Inbound yesterday",
                    "action": "Send consult CTA",
                    "lead_id": lead_id,
                },
                {"title": ""},
                "ignore-me",
            ],
            "outreach": [
                {
                    "channel": "whatsapp",
                    "lead_id": "not-a-uuid",
                    "message_excerpt": "How much?",
                    "draft_reply": "I can share the current consult options.",
                    "rationale": "Price question",
                }
            ],
            "product_focus": "Push Family Consultations",
            "offer_refinements": ["Tighten MBA intro copy", ""],
            "risks": ["Do not invent pricing"],
        }
    )
    assert payload["focus"] == "Follow up MBA leads"
    assert payload["priorities"] == [
        {
            "title": "Reply to Mei",
            "why": "Inbound yesterday",
            "action": "Send consult CTA",
            "lead_id": lead_id,
        }
    ]
    assert payload["outreach"] == [
        {
            "channel": "whatsapp",
            "lead_id": None,
            "message_excerpt": "How much?",
            "draft_reply": "I can share the current consult options.",
            "rationale": "Price question",
        }
    ]
    assert payload["offer_refinements"] == ["Tighten MBA intro copy"]
    assert payload["risks"] == ["Do not invent pricing"]


def test_evaluate_staleness_age_conversation_and_pipeline(monkeypatch: object) -> None:
    now = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    plan = SimpleNamespace(
        generated_at=now - PLAN_STALE_AFTER - timedelta(minutes=1),
        conversation_watermark_at=now - timedelta(hours=2),
        pipeline_watermark_at=now - timedelta(hours=3),
    )

    monkeypatch.setattr(
        "app.services.sales_daily_plan.latest_conversation_at",
        lambda _session: now - timedelta(minutes=5),
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan.latest_pipeline_activity_at",
        lambda _session: now - timedelta(minutes=10),
    )

    result = evaluate_staleness(
        session=SimpleNamespace(),
        plan=plan,  # type: ignore[arg-type]
        now=now,
    )
    assert result["is_stale"] is True
    assert result["stale_reasons"] == ["age", "new_conversation", "pipeline_changed"]


def test_evaluate_staleness_fresh_plan(monkeypatch: object) -> None:
    now = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    plan = SimpleNamespace(
        generated_at=now - timedelta(hours=1),
        conversation_watermark_at=now - timedelta(minutes=10),
        pipeline_watermark_at=now - timedelta(minutes=10),
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan.latest_conversation_at",
        lambda _session: now - timedelta(minutes=20),
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan.latest_pipeline_activity_at",
        lambda _session: now - timedelta(minutes=30),
    )
    result = evaluate_staleness(
        session=SimpleNamespace(),
        plan=plan,  # type: ignore[arg-type]
        now=now,
    )
    assert result["is_stale"] is False
    assert result["stale_reasons"] == []


def test_format_openrouter_failure_maps_timeout() -> None:
    message = _format_openrouter_failure(RuntimeError("Read timed out"))
    assert "too long to respond" in message
    message = _format_openrouter_failure(AwsProxyError("TimeoutError", "boom"))
    assert "too long to respond" in message
    message = _format_openrouter_failure(RuntimeError("Model JSON must be an object"))
    assert "invalid response" in message
