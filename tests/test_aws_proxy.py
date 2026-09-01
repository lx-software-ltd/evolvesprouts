from __future__ import annotations

from typing import Any

from app.services import aws_proxy


def test_handle_aws_blocks_actions_not_in_allow_list(monkeypatch: Any) -> None:
    monkeypatch.setenv("ALLOWED_ACTIONS", "cognito-idp:list_users")
    aws_proxy._ALLOWED_ACTIONS = None

    response = aws_proxy._handle_aws(
        {
            "service": "s3",
            "action": "list_buckets",
            "params": {},
        }
    )

    assert response["error"]["code"] == "ActionNotAllowed"


def test_handle_http_rejects_disallowed_urls(monkeypatch: Any) -> None:
    monkeypatch.setenv("ALLOWED_HTTP_URLS", "https://api.example.com/v1/")
    aws_proxy._ALLOWED_HTTP_URLS = None

    response = aws_proxy._handle_http(
        {
            "type": "http",
            "method": "GET",
            "url": "https://blocked.example.com/v1/test",
        }
    )

    assert response["error"]["code"] == "URLNotAllowed"


def test_handle_http_injects_default_user_agent(monkeypatch: Any) -> None:
    """When no User-Agent header is supplied, the proxy adds a default one."""
    monkeypatch.setenv("ALLOWED_HTTP_URLS", "https://api.example.com/")
    aws_proxy._ALLOWED_HTTP_URLS = None

    captured_headers: dict[str, str] = {}

    class _FakeResponse:
        status = 200

        def read(self) -> bytes:
            return b'{"ok":true}'

        def getheaders(self) -> list[tuple[str, str]]:
            return [("content-type", "application/json")]

        def __enter__(self) -> "_FakeResponse":
            return self

        def __exit__(self, *_: object) -> None:
            pass

    def _fake_urlopen(req: Any, *, timeout: int = 10) -> _FakeResponse:
        captured_headers.update(dict(req.headers))
        return _FakeResponse()

    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)

    response = aws_proxy._handle_http(
        {
            "type": "http",
            "method": "GET",
            "url": "https://api.example.com/v1/test",
        }
    )

    assert response["result"]["status"] == 200
    assert "User-agent" in captured_headers
    assert captured_headers["User-agent"] == aws_proxy._HTTP_PROXY_USER_AGENT


def test_handle_http_preserves_caller_user_agent(monkeypatch: Any) -> None:
    """When the caller provides a User-Agent, the proxy does not override it."""
    monkeypatch.setenv("ALLOWED_HTTP_URLS", "https://api.example.com/")
    aws_proxy._ALLOWED_HTTP_URLS = None

    captured_headers: dict[str, str] = {}

    class _FakeResponse:
        status = 200

        def read(self) -> bytes:
            return b'{"ok":true}'

        def getheaders(self) -> list[tuple[str, str]]:
            return [("content-type", "application/json")]

        def __enter__(self) -> "_FakeResponse":
            return self

        def __exit__(self, *_: object) -> None:
            pass

    def _fake_urlopen(req: Any, *, timeout: int = 10) -> _FakeResponse:
        captured_headers.update(dict(req.headers))
        return _FakeResponse()

    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)

    response = aws_proxy._handle_http(
        {
            "type": "http",
            "method": "GET",
            "url": "https://api.example.com/v1/test",
            "headers": {"User-Agent": "CustomAgent/2.0"},
        }
    )

    assert response["result"]["status"] == 200
    assert captured_headers["User-agent"] == "CustomAgent/2.0"


def test_handle_http_caps_timeout_at_60_seconds(monkeypatch: Any) -> None:
    monkeypatch.setenv("ALLOWED_HTTP_URLS", "https://api.example.com/")
    aws_proxy._ALLOWED_HTTP_URLS = None
    captured: dict[str, int] = {}

    class _FakeResponse:
        status = 200

        def read(self) -> bytes:
            return b"{}"

        def getheaders(self) -> list[tuple[str, str]]:
            return []

        def __enter__(self) -> "_FakeResponse":
            return self

        def __exit__(self, *_: object) -> None:
            pass

    def _fake_urlopen(_req: Any, *, timeout: int = 10) -> _FakeResponse:
        captured["timeout"] = timeout
        return _FakeResponse()

    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)

    aws_proxy._handle_http(
        {
            "type": "http",
            "method": "GET",
            "url": "https://api.example.com/v1/test",
            "timeout": 90,
        }
    )

    assert captured["timeout"] == 60


def test_proxy_handler_routes_http_requests(monkeypatch: Any) -> None:
    marker = {"result": {"status": 200}}
    monkeypatch.setattr(aws_proxy, "_handle_http", lambda *_: marker)

    response = aws_proxy.proxy_handler({"type": "http", "url": "https://a"}, None)
    assert response is marker
