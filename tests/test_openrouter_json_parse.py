"""Tests for shared OpenRouter JSON parsing helpers."""

from __future__ import annotations

import json

import pytest

from app.services import openrouter_json_parse as json_parse


def test_prepare_openrouter_json_text_strips_fence() -> None:
    text = """```json
    {"summary": "Hello"}
    ```"""
    assert json_parse.prepare_openrouter_json_text(text) == '{"summary": "Hello"}'


def test_openrouter_json_text_candidates_includes_brace_slice() -> None:
    candidates = json_parse.openrouter_json_text_candidates('prefix {"a": 1} suffix')
    assert '{"a": 1}' in candidates


def test_loads_openrouter_json_parses_valid_payload() -> None:
    parsed = json_parse.loads_openrouter_json('{"ok": true}', context="unit test")
    assert parsed == {"ok": True}


def test_loads_openrouter_json_repairs_broken_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    valid = {
        "summary": "Follow up",
        "actions": ["Call"],
        "follow_ups": [
            {
                "channel": "whatsapp",
                "message_excerpt": "Hi",
                "draft_reply": 'Thanks for the "quick" note',
                "rationale": "Acknowledge",
            }
        ],
        "risks": [],
    }
    broken = (
        '{"summary": "Follow up", "actions": ["Call"], "follow_ups": [{"channel": '
        '"whatsapp", "message_excerpt": "Hi", "draft_reply": "Thanks for the "quick" '
        'note", "rationale": "Acknowledge"}], "risks": []}'
    )
    call_count = {"n": 0}

    def _fake_repair(broken_text: str, parse_error: str, *, timeout: int) -> str:
        call_count["n"] += 1
        assert broken_text == broken
        assert "Expecting" in parse_error or "delimiter" in parse_error
        assert timeout == 45
        return json.dumps(valid)

    monkeypatch.setattr(json_parse, "repair_openrouter_json_text", _fake_repair)

    parsed = json_parse.loads_openrouter_json(
        broken,
        context="lead close suggestion",
        timeout=45,
    )
    assert parsed == valid
    assert call_count["n"] == 1


def test_loads_openrouter_json_rejects_safety_stub_without_repair(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fake_repair(_broken_text: str, _parse_error: str, *, timeout: int) -> str:
        raise AssertionError("safety stubs must not invoke JSON repair")

    monkeypatch.setattr(json_parse, "repair_openrouter_json_text", _fake_repair)

    with pytest.raises(RuntimeError, match="no JSON object"):
        json_parse.loads_openrouter_json(
            "User Safety: safe", context="sales daily plan"
        )


def test_loads_openrouter_json_raises_when_repair_still_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    broken = '{"summary": "broken "quote""}'

    def _fake_repair(_broken_text: str, _parse_error: str, *, timeout: int) -> str:
        return '{"still": broken}'

    monkeypatch.setattr(json_parse, "repair_openrouter_json_text", _fake_repair)

    with pytest.raises(RuntimeError, match="even after repair"):
        json_parse.loads_openrouter_json(broken, context="unit test")
