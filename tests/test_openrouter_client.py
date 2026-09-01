"""Tests for the shared OpenRouter client."""

from __future__ import annotations

from typing import Any

import pytest

from app.services import openrouter_client as client


def test_openrouter_chat_completion_respects_max_attempts(
    monkeypatch: Any,
) -> None:
    calls: list[int] = []

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        calls.append(1)
        return {"status": 429, "body": '{"error":{"message":"rate limited","code":429}}'}

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
            max_attempts=1,
        )

    assert len(calls) == 1


def test_openrouter_chat_completion_defaults_to_three_attempts(
    monkeypatch: Any,
) -> None:
    calls: list[int] = []

    def _fake_http_invoke(**_kwargs: Any) -> dict[str, Any]:
        calls.append(1)
        return {"status": 429, "body": '{"error":{"message":"rate limited","code":429}}'}

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
        )

    assert len(calls) == 3
