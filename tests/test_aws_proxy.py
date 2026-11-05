from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

import pytest
from app.services import aws_proxy
from botocore.exceptions import ReadTimeoutError


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


def test_handle_http_caps_timeout_at_90_seconds(monkeypatch: Any) -> None:
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
            "timeout": 240,
        }
    )

    assert captured["timeout"] == aws_proxy._MAX_HTTP_TIMEOUT_SECONDS
    assert captured["timeout"] == 90


def test_handle_http_sends_base64_body_as_bytes(monkeypatch: Any) -> None:
    monkeypatch.setenv("ALLOWED_HTTP_URLS", "https://api.example.com/")
    aws_proxy._ALLOWED_HTTP_URLS = None
    captured: dict[str, bytes | None] = {}

    class _FakeResponse:
        status = 204

        def read(self) -> bytes:
            return b""

        def getheaders(self) -> list[tuple[str, str]]:
            return []

        def __enter__(self) -> "_FakeResponse":
            return self

        def __exit__(self, *_: object) -> None:
            pass

    def _fake_urlopen(req: Any, *, timeout: int = 10) -> _FakeResponse:
        captured["data"] = req.data
        captured["timeout"] = timeout
        return _FakeResponse()

    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)
    payload = b"\x89PNG-bytes"

    response = aws_proxy._handle_http(
        {
            "type": "http",
            "method": "POST",
            "url": "https://api.example.com/upload",
            "body_base64": base64.b64encode(payload).decode("ascii"),
        }
    )

    assert response["result"]["status"] == 204
    assert captured["data"] == payload


def test_handle_http_keeps_text_body(monkeypatch: Any) -> None:
    monkeypatch.setenv("ALLOWED_HTTP_URLS", "https://api.example.com/")
    aws_proxy._ALLOWED_HTTP_URLS = None
    captured: dict[str, bytes | None] = {}

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

    def _fake_urlopen(req: Any, *, timeout: int = 10) -> _FakeResponse:
        captured["data"] = req.data
        return _FakeResponse()

    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)

    response = aws_proxy._handle_http(
        {
            "type": "http",
            "method": "POST",
            "url": "https://api.example.com/v1/test",
            "body": '{"ok":true}',
        }
    )

    assert response["result"]["status"] == 200
    assert captured["data"] == b'{"ok":true}'


def test_handle_http_rejects_both_body_forms(monkeypatch: Any) -> None:
    monkeypatch.setenv("ALLOWED_HTTP_URLS", "https://api.example.com/")
    aws_proxy._ALLOWED_HTTP_URLS = None

    response = aws_proxy._handle_http(
        {
            "type": "http",
            "method": "POST",
            "url": "https://api.example.com/v1/test",
            "body": "text",
            "body_base64": base64.b64encode(b"file").decode("ascii"),
        }
    )

    assert response["error"]["code"] == "InvalidBody"


def test_handle_http_rejects_oversized_file_body(monkeypatch: Any) -> None:
    monkeypatch.setenv("ALLOWED_HTTP_URLS", "https://api.example.com/")
    aws_proxy._ALLOWED_HTTP_URLS = None
    oversized = b"x" * (aws_proxy._MAX_HTTP_BODY_BYTES + 1)

    response = aws_proxy._handle_http(
        {
            "type": "http",
            "method": "POST",
            "url": "https://api.example.com/upload",
            "body_base64": base64.b64encode(oversized).decode("ascii"),
        }
    )

    assert response["error"]["code"] == "BodyTooLarge"


def test_http_invoke_sends_file_as_base64(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}

    def _invoke(payload: dict[str, Any]) -> dict[str, Any]:
        captured.update(payload)
        return {"status": 204, "headers": {}, "body": ""}

    monkeypatch.setattr(aws_proxy, "_invoke_proxy", _invoke)

    aws_proxy.http_invoke(
        method="POST",
        url="https://api.example.com/upload",
        body_bytes=b"png",
    )

    assert captured["body_base64"] == base64.b64encode(b"png").decode("ascii")
    assert "body" not in captured

    with pytest.raises(ValueError, match="both"):
        aws_proxy.http_invoke(
            method="POST",
            url="https://api.example.com/upload",
            body="text",
            body_bytes=b"png",
        )


def test_proxy_handler_routes_http_requests(monkeypatch: Any) -> None:
    marker = {"result": {"status": 200}}
    monkeypatch.setattr(aws_proxy, "_handle_http", lambda *_: marker)

    response = aws_proxy.proxy_handler({"type": "http", "url": "https://a"}, None)
    assert response is marker


def test_invoke_proxy_rejects_empty_payload(monkeypatch: Any) -> None:
    class _FakeLambda:
        def invoke(self, **_kwargs: Any) -> dict[str, Any]:
            return {"Payload": BytesIO(b"")}

    monkeypatch.setattr(aws_proxy, "_lambda_client", _FakeLambda())
    monkeypatch.setattr(
        aws_proxy, "_proxy_arn", "arn:aws:lambda:us-east-1:1:function:proxy"
    )

    with pytest.raises(aws_proxy.AwsProxyError) as exc_info:
        aws_proxy._invoke_proxy({"type": "http"})
    assert exc_info.value.code == "EmptyProxyResponse"


def test_invoke_proxy_rejects_invalid_json_payload(monkeypatch: Any) -> None:
    class _FakeLambda:
        def invoke(self, **_kwargs: Any) -> dict[str, Any]:
            return {"Payload": BytesIO(b"<html>timeout</html>")}

    monkeypatch.setattr(aws_proxy, "_lambda_client", _FakeLambda())
    monkeypatch.setattr(
        aws_proxy, "_proxy_arn", "arn:aws:lambda:us-east-1:1:function:proxy"
    )

    with pytest.raises(aws_proxy.AwsProxyError) as exc_info:
        aws_proxy._invoke_proxy({"type": "http"})
    assert exc_info.value.code == "InvalidProxyResponse"
    assert "invalid JSON" in str(exc_info.value)


def test_proxy_lambda_client_waits_past_default_read_timeout(
    monkeypatch: Any,
) -> None:
    aws_proxy._lambda_client = None
    captured: dict[str, Any] = {}

    def _fake_client(service: str, **kwargs: Any) -> object:
        captured["service"] = service
        captured["config"] = kwargs.get("config")
        return object()

    monkeypatch.setattr(aws_proxy.boto3, "client", _fake_client)
    aws_proxy._get_lambda_client()
    config = captured["config"]
    assert captured["service"] == "lambda"
    assert config is not None
    assert config.read_timeout == aws_proxy._LAMBDA_INVOKE_READ_TIMEOUT_SECONDS
    assert config.read_timeout > 60
    assert config.retries["max_attempts"] == 1
    aws_proxy._lambda_client = None


def test_invoke_proxy_maps_read_timeout(monkeypatch: Any) -> None:
    class _FakeLambda:
        def invoke(self, **_kwargs: Any) -> dict[str, Any]:
            raise ReadTimeoutError(
                endpoint_url="https://lambda.example.com",
                error="read timed out",
            )

    monkeypatch.setattr(aws_proxy, "_lambda_client", _FakeLambda())
    monkeypatch.setattr(
        aws_proxy, "_proxy_arn", "arn:aws:lambda:us-east-1:1:function:proxy"
    )

    with pytest.raises(aws_proxy.AwsProxyError) as exc_info:
        aws_proxy._invoke_proxy({"type": "http"})
    assert exc_info.value.code == "TimeoutError"
