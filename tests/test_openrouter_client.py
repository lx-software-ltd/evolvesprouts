"""Tests for the shared OpenRouter client."""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.services import openrouter_client as client


@pytest.fixture(autouse=True)
def _clear_openrouter_model_cache() -> None:
    client.clear_openrouter_model_cache()
    yield
    client.clear_openrouter_model_cache()


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


def test_extract_message_text_rejects_empty_body() -> None:
    with pytest.raises(RuntimeError, match="OpenRouter response was empty"):
        client.extract_message_text("")
    with pytest.raises(RuntimeError, match="OpenRouter response was empty"):
        client.extract_message_text("   ")


def test_extract_message_text_rejects_invalid_json() -> None:
    with pytest.raises(RuntimeError, match="not valid JSON"):
        client.extract_message_text("Expecting value")
    with pytest.raises(RuntimeError, match="not valid JSON"):
        client.extract_message_text("<html>gateway timeout</html>")


def test_extract_message_text_reads_assistant_content() -> None:
    body = (
        '{"choices":[{"message":{"content":"{\\"focus\\":\\"Go\\"}"},'
        '"finish_reason":"stop"}]}'
    )
    assert client.extract_message_text(body) == '{"focus":"Go"}'


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


def test_normalize_openrouter_model_treats_auto_as_unset() -> None:
    assert client.normalize_openrouter_model(None) is None
    assert client.normalize_openrouter_model("  ") is None
    assert client.normalize_openrouter_model("Auto") is None
    assert client.normalize_openrouter_model("openrouter/auto") is None
    assert client.normalize_openrouter_model("openai/gpt-4.1-mini") == (
        "openai/gpt-4.1-mini"
    )


def test_configured_model_name_defaults_to_auto(monkeypatch: Any) -> None:
    client.clear_openrouter_model_cache()
    monkeypatch.delenv("OPENROUTER_MODEL", raising=False)
    monkeypatch.setattr(
        client, "_load_sales_settings_openrouter_model", lambda: (False, None)
    )
    assert client.configured_model_name() == client.OPENROUTER_AUTO_MODEL


def test_configured_model_name_uses_sales_settings(monkeypatch: Any) -> None:
    client.clear_openrouter_model_cache()
    monkeypatch.setenv("OPENROUTER_MODEL", "env-model")
    monkeypatch.setattr(
        client,
        "_load_sales_settings_openrouter_model",
        lambda: (True, "openai/gpt-4.1-mini"),
    )
    assert client.configured_model_name() == "openai/gpt-4.1-mini"


def test_configured_model_name_settings_auto_ignores_env(monkeypatch: Any) -> None:
    client.clear_openrouter_model_cache()
    monkeypatch.setenv("OPENROUTER_MODEL", "env-model")
    monkeypatch.setattr(
        client, "_load_sales_settings_openrouter_model", lambda: (True, None)
    )
    assert client.configured_model_name() == client.OPENROUTER_AUTO_MODEL


def test_configured_model_name_falls_back_to_env(monkeypatch: Any) -> None:
    client.clear_openrouter_model_cache()
    monkeypatch.setenv("OPENROUTER_MODEL", "test-model")
    monkeypatch.setattr(
        client, "_load_sales_settings_openrouter_model", lambda: (False, None)
    )
    assert client.configured_model_name() == "test-model"


def test_attribution_user_strips_pii_from_workload() -> None:
    assert client.attribution_user("expense-parser") == "evolvesprouts:expense-parser"
    assert client.attribution_user("Ada Lovelace <ada@example.com>") == (
        "evolvesprouts:ada-lovelace-ada-example-com"
    )
    assert client.attribution_user("   ") == "evolvesprouts:unknown"
