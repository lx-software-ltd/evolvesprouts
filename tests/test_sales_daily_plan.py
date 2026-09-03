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
    generate_and_store_plan,
    normalize_plan_payload,
    parse_plan_json_object,
    serialize_plan,
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


def test_serialize_plan_includes_operator_input(monkeypatch: object) -> None:
    monkeypatch.setattr(
        "app.services.sales_daily_plan.evaluate_staleness",
        lambda session, plan, now=None: {
            "is_stale": False,
            "stale_reasons": [],
            "stale_after": "2026-09-02T10:00:00+00:00",
            "latest_message_at": None,
            "latest_pipeline_at": None,
        },
    )
    plan_id = uuid4()
    payload = serialize_plan(
        SimpleNamespace(),
        plan=SimpleNamespace(
            id=plan_id,
            payload={
                "focus": "Close consults",
                "priorities": [],
                "outreach": [],
                "product_focus": "",
                "offer_refinements": [],
                "risks": [],
            },
            generated_at=datetime(2026, 9, 1, 10, 0, tzinfo=UTC),
            generated_by="user-1",
            model="test-model",
            operator_input="Focus on MBA",
            conversation_watermark_at=None,
            pipeline_watermark_at=None,
        ),
    )
    assert payload["id"] == str(plan_id)
    assert payload["operator_input"] == "Focus on MBA"


def test_generate_and_store_plan_persists_operator_input(monkeypatch: object) -> None:
    added: list[object] = []
    session = SimpleNamespace(add=added.append, flush=lambda: None)
    monkeypatch.setattr(
        "app.services.sales_daily_plan.build_sales_daily_plan_context",
        lambda _session: (
            {"open_leads": [], "needs_reply_threads": [], "catalogue": []},
            SimpleNamespace(
                conversation_watermark_at=None,
                pipeline_watermark_at=None,
            ),
        ),
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan.openrouter_chat_completion",
        lambda **_kwargs: {},
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan.extract_message_text",
        lambda _body: (
            '{"focus": "Go", "priorities": [], "outreach": [],'
            ' "product_focus": "", "offer_refinements": [], "risks": []}'
        ),
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan.configured_model_name",
        lambda: "test-model",
    )
    row = generate_and_store_plan(
        session,  # type: ignore[arg-type]
        actor_sub="user-1",
        operator_input="  Focus on MBA  ",
    )
    assert row.operator_input == "Focus on MBA"
    assert added[0] is row


def test_format_openrouter_failure_maps_timeout() -> None:
    message = _format_openrouter_failure(RuntimeError("Read timed out"))
    assert "too long to respond" in message
    message = _format_openrouter_failure(AwsProxyError("TimeoutError", "boom"))
    assert "too long to respond" in message
    message = _format_openrouter_failure(RuntimeError("Model JSON must be an object"))
    assert "invalid response" in message
