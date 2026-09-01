"""Tests for Meta Graph HTTP client error handling."""

from __future__ import annotations

import json

import pytest

from app.services import meta_graph_client as client
from app.services.meta_graph_client import MetaGraphApiError


@pytest.fixture(autouse=True)
def _reset_page_token_cache() -> None:
    client.reset_page_access_token_cache()


def test_graph_get_401_hints_page_token_not_verify_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_PAGE_ACCESS_TOKEN", "handshake-string")

    def _fake_http_invoke(**_kwargs: object) -> dict[str, object]:
        return {
            "status": 401,
            "body": json.dumps(
                {
                    "error": {
                        "message": "Invalid OAuth access token - Cannot parse access token"
                    }
                }
            ),
        }

    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)

    with pytest.raises(MetaGraphApiError) as exc_info:
        client.graph_get("me")

    assert exc_info.value.status_code == 401
    message = str(exc_info.value)
    assert "Cannot parse access token" in message
    assert "webhook verify string" in message


def test_resolve_page_access_token_exchanges_system_user_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_PAGE_ACCESS_TOKEN", "system-user-token")
    monkeypatch.setenv("META_PAGE_ID", "page-1")
    captured: dict[str, object] = {}

    def _fake_http_invoke(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {
            "status": 200,
            "body": json.dumps({"id": "page-1", "access_token": "page-token"}),
        }

    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)

    assert client.resolve_page_access_token() == "page-token"
    headers = captured.get("headers")
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer system-user-token"
    url = str(captured.get("url") or "")
    assert "page-1" in url
    assert "access_token" in url
    assert client.resolve_page_access_token() == "page-token"


def test_resolve_page_access_token_keeps_existing_page_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_PAGE_ACCESS_TOKEN", "already-page-token")
    monkeypatch.setenv("META_PAGE_ID", "page-1")

    def _fake_http_invoke(**_kwargs: object) -> dict[str, object]:
        return {"status": 200, "body": json.dumps({"id": "page-1"})}

    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)

    assert client.resolve_page_access_token() == "already-page-token"


def test_graph_get_400_hints_page_token_exchange(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_PAGE_ACCESS_TOKEN", "system-user-token")

    def _fake_http_invoke(**_kwargs: object) -> dict[str, object]:
        return {
            "status": 400,
            "body": json.dumps(
                {
                    "error": {
                        "code": 190,
                        "message": "This method must be called with a Page Access Token",
                    }
                }
            ),
        }

    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)

    with pytest.raises(MetaGraphApiError) as exc_info:
        client.graph_get("page-1/conversations")

    assert exc_info.value.status_code == 400
    assert "Page Access Token" in str(exc_info.value)
    assert "fields=access_token" in str(exc_info.value)


def test_graph_get_payload_too_large_is_not_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_PAGE_ACCESS_TOKEN", "page-token")
    calls = {"count": 0}

    def _fake_http_invoke(**_kwargs: object) -> dict[str, object]:
        calls["count"] += 1
        return {
            "status": 500,
            "body": json.dumps(
                {
                    "error": {
                        "message": (
                            "Please reduce the amount of data you're asking "
                            "for, then retry your request"
                        )
                    }
                }
            ),
        }

    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)

    with pytest.raises(MetaGraphApiError) as exc_info:
        client.graph_get("page-1/conversations")

    assert exc_info.value.status_code == 500
    assert "reduce the amount of data" in str(exc_info.value).lower()
    assert "smaller limit" in str(exc_info.value)
    assert calls["count"] == 1
