"""Tests for the shared OpenRouter client."""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.services import openrouter_client as client


def test_openrouter_chat_completion_respects_max_attempts(
    monkeypatch: Any,
) -> None:
    calls: list[int] = []

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        calls.append(1)
        return {
            "status": 429,
            "body": '{"error":{"message":"rate limited","code":429}}',
        }

    monkeypatch.setenv(
        "OPENROUTER_CHAT_COMPLETIONS_URL",
        "https://openrouter.ai/api/v1/chat/completions",
    )
    monkeypatch.setenv("OPENROUTER_MODEL", "test-model")
    monkeypatch.setattr(client, "get_openrouter_api_key", lambda: "test-key")
    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)
    monkeypatch.setattr(client.time, "sleep", lambda _seconds: None)

    with pytest.raises(RuntimeError, match="status 429"):
        client.openrouter_chat_completion(
            system_prompt="system",
            user_content="user",
            timeout=10,
            workload="expense-parser",
            max_attempts=1,
        )

    assert len(calls) == 1


def test_openrouter_chat_completion_defaults_to_three_attempts(
    monkeypatch: Any,
) -> None:
    calls: list[int] = []

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        calls.append(1)
        return {
            "status": 429,
            "body": '{"error":{"message":"rate limited","code":429}}',
        }

    monkeypatch.setenv(
        "OPENROUTER_CHAT_COMPLETIONS_URL",
        "https://openrouter.ai/api/v1/chat/completions",
    )
    monkeypatch.setenv("OPENROUTER_MODEL", "test-model")
    monkeypatch.setattr(client, "get_openrouter_api_key", lambda: "test-key")
    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)
    monkeypatch.setattr(client.time, "sleep", lambda _seconds: None)

    with pytest.raises(RuntimeError, match="status 429"):
        client.openrouter_chat_completion(
            system_prompt="system",
            user_content="user",
            timeout=10,
            workload="expense-parser",
        )

    assert len(calls) == 3


def test_openrouter_chat_completion_tags_hidden_app_and_workload(
    monkeypatch: Any,
) -> None:
    captured: dict[str, Any] = {}

    def _fake_http_invoke(**kwargs: Any) -> dict[str, Any]:
        captured.update(kwargs)
        return {"status": 200, "body": '{"choices":[{"message":{"content":"ok"}}]}'}

    monkeypatch.setenv(
        "OPENROUTER_CHAT_COMPLETIONS_URL",
        "https://openrouter.ai/api/v1/chat/completions",
    )
    monkeypatch.setenv("OPENROUTER_MODEL", "test-model")
    monkeypatch.setattr(client, "get_openrouter_api_key", lambda: "test-key")
    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)

    client.openrouter_chat_completion(
        system_prompt="system",
        user_content="user",
        timeout=10,
        workload="sales-daily-plan",
        max_attempts=1,
    )

    headers = captured["headers"]
    assert headers["HTTP-Referer"] == "https://evolvesprouts.com"
    assert headers["X-OpenRouter-Title"] == "Evolve Sprouts"
    assert headers["X-Title"] == "Evolve Sprouts"
    assert headers["X-OpenRouter-App-Visibility"] == "hidden"
    payload = json.loads(captured["body"])
    assert payload["user"] == "evolvesprouts:sales-daily-plan"
    assert client.OPENROUTER_NAMED_KEY == "lxsoftware:evolvesprouts"


def test_attribution_user_strips_pii_from_workload() -> None:
    assert client.attribution_user("expense-parser") == "evolvesprouts:expense-parser"
    assert client.attribution_user("Ada Lovelace <ada@example.com>") == (
        "evolvesprouts:ada-lovelace-ada-example-com"
    )
    assert client.attribution_user("   ") == "evolvesprouts:unknown"
