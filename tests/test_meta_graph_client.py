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


def test_graph_post_sends_form_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_PAGE_ACCESS_TOKEN", "page-token")
    captured: dict[str, object] = {}

    def _fake_http_invoke(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"status": 200, "body": json.dumps({"success": True})}

    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)

    payload = client.graph_post(
        "page-1/subscribed_apps",
        params={"subscribed_fields": "messages"},
        token="page-token",
    )

    assert payload == {"success": True}
    assert captured.get("method") == "POST"
    url = str(captured.get("url") or "")
    assert "page-1/subscribed_apps" in url
    assert "subscribed_fields=messages" in url
    headers = captured.get("headers")
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer page-token"


def test_is_graph_skippable_failure_includes_proxy_timeout() -> None:
    timeout = MetaGraphApiError(
        status_code=502,
        message="Meta Graph proxy call failed: TimeoutError",
    )
    assert client.is_graph_skippable_failure(timeout) is True
    assert (
        client.is_graph_skippable_failure(
            MetaGraphApiError(status_code=401, message="nope")
        )
        is False
    )


def test_graph_get_parses_fatal_error_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("META_PAGE_ACCESS_TOKEN", "page-token")

    def _fake_http_invoke(**_kwargs: object) -> dict[str, object]:
        return {
            "status": 400,
            "body": json.dumps(
                {
                    "error": {
                        "message": "Fatal",
                        "type": "OAuthException",
                        "code": -1,
                        "error_subcode": 2207085,
                        "is_transient": False,
                        "fbtrace_id": "trace-abc",
                    }
                }
            ),
        }

    monkeypatch.setattr(client, "http_invoke", _fake_http_invoke)

    with pytest.raises(MetaGraphApiError) as exc_info:
        client.graph_get("conv-1/messages")

    err = exc_info.value
    assert err.status_code == 400
    assert err.code == -1
    assert err.error_subcode == 2207085
    assert err.is_transient is False
    assert err.fbtrace_id == "trace-abc"
    assert client.is_graph_skippable_failure(err) is True


def test_is_graph_skippable_failure_keeps_auth_fatal() -> None:
    auth = MetaGraphApiError(
        status_code=400,
        message="expired",
        code=190,
        error_subcode=None,
        is_transient=False,
    )
    permission = MetaGraphApiError(
        status_code=403,
        message="denied",
        code=200,
    )
    assert client.is_graph_auth_or_permission_failure(auth) is True
    assert client.is_graph_skippable_failure(auth) is False
    assert client.is_graph_skippable_failure(permission) is False
    assert (
        client.is_graph_skippable_failure(
            MetaGraphApiError(status_code=401, message="nope")
        )
        is False
    )
