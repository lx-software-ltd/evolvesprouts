"""Tests for lead close AI suggestion helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from app.services.lead_close_suggestion import (
    SUGGESTION_STALE_AFTER,
    _normalize_payload,
    _parse_json_object,
    evaluate_staleness,
)


def test_parse_json_object_accepts_fenced_payload() -> None:
    parsed = _parse_json_object(
        """```json
        {"summary": "Call them", "actions": ["Book consult"], "follow_ups": [], "risks": []}
        ```"""
    )
    assert parsed["summary"] == "Call them"


def test_normalize_payload_coerces_lists() -> None:
    payload = _normalize_payload(
        {
            "summary": "Next step",
            "actions": ["Ask about ages", 12, ""],
            "follow_ups": [
                {
                    "channel": "whatsapp",
                    "message_excerpt": "Need help",
                    "draft_reply": "Happy to help — which ages?",
                    "rationale": "Clarify fit",
                },
                "ignore-me",
            ],
            "risks": ["Do not invent pricing"],
        }
    )
    assert payload["summary"] == "Next step"
    assert payload["actions"] == ["Ask about ages", "12"]
    assert payload["follow_ups"] == [
        {
            "channel": "whatsapp",
            "message_excerpt": "Need help",
            "draft_reply": "Happy to help — which ages?",
            "rationale": "Clarify fit",
        }
    ]
    assert payload["risks"] == ["Do not invent pricing"]


def test_evaluate_staleness_age_and_new_conversation(monkeypatch: object) -> None:
    now = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    suggestion = SimpleNamespace(
        generated_at=now - SUGGESTION_STALE_AFTER - timedelta(minutes=1),
        conversation_watermark_at=now - timedelta(hours=2),
    )

    def _fake_latest(_session: object, *, contact_id: object) -> datetime:
        assert contact_id is not None
        return now - timedelta(minutes=5)

    monkeypatch.setattr(
        "app.services.lead_close_suggestion._latest_contact_message_at",
        _fake_latest,
    )

    result = evaluate_staleness(
        session=SimpleNamespace(),
        suggestion=suggestion,  # type: ignore[arg-type]
        contact_id=uuid4(),
        now=now,
    )
    assert result["is_stale"] is True
    assert result["stale_reasons"] == ["age", "new_conversation"]
    assert result["latest_message_at"] is not None
