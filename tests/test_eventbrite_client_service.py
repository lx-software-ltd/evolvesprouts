from __future__ import annotations

import json
from typing import Any

import pytest
from app.services import eventbrite_client
from app.services.aws_proxy import AwsProxyError
from app.services.eventbrite_client import EventbriteApiError, eventbrite_request


def test_eventbrite_request_returns_parsed_json(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        eventbrite_client,
        "run_with_retry",
        lambda func, **_: func(),
    )
    monkeypatch.setattr(
        eventbrite_client,
        "http_invoke",
        lambda **_: {"status": 200, "body": json.dumps({"events": []})},
    )

    result = eventbrite_request(
        method="GET",
        base_url="https://www.eventbriteapi.com/v3",
        path="/users/me/events/",
        token="token-value",
    )

    assert result == {"events": []}


def test_eventbrite_request_sets_json_content_type_only_with_a_body(
    monkeypatch: Any,
) -> None:
    captured: list[dict[str, Any]] = []

    def _invoke(**kwargs: Any) -> dict[str, Any]:
        captured.append(kwargs)
        return {"status": 200, "body": "{}"}

    monkeypatch.setattr(eventbrite_client, "http_invoke", _invoke)

    eventbrite_request(
        method="GET",
        base_url="https://www.eventbriteapi.com/v3",
        path="/media/upload/",
        token="token-value",
    )
    eventbrite_request(
        method="POST",
        base_url="https://www.eventbriteapi.com/v3",
        path="/events/1001/",
        token="token-value",
        payload={"event": {"name": {"html": "Mealtime"}}},
    )

    assert "Content-Type" not in captured[0]["headers"]
    assert captured[0]["body"] is None
    assert captured[1]["headers"]["Content-Type"] == "application/json"
    assert captured[1]["body"] == '{"event": {"name": {"html": "Mealtime"}}}'


def test_eventbrite_request_raises_on_proxy_error(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        eventbrite_client,
        "run_with_retry",
        lambda func, **_: func(),
    )

    def _raise_proxy_error(**_: Any) -> dict[str, Any]:
        raise AwsProxyError("ProxyError", "blocked")

    monkeypatch.setattr(eventbrite_client, "http_invoke", _raise_proxy_error)

    with pytest.raises(EventbriteApiError) as exc_info:
        eventbrite_request(
            method="GET",
            base_url="https://www.eventbriteapi.com/v3",
            path="/users/me/",
            token="token-value",
        )

    assert exc_info.value.status_code == 502
    assert "proxy call failed" in str(exc_info.value).lower()


def test_eventbrite_request_raises_on_non_success_status(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        eventbrite_client,
        "run_with_retry",
        lambda func, **_: func(),
    )
    monkeypatch.setattr(
        eventbrite_client,
        "http_invoke",
        lambda **_: {
            "status": 404,
            "body": json.dumps({"error": "NOT_FOUND", "error_description": "missing"}),
        },
    )

    with pytest.raises(EventbriteApiError) as exc_info:
        eventbrite_request(
            method="GET",
            base_url="https://www.eventbriteapi.com/v3",
            path="/events/unknown/",
            token="token-value",
        )

    assert exc_info.value.status_code == 404
    assert "missing" in str(exc_info.value)


@pytest.mark.parametrize(
    ("status_code", "expected"),
    [
        (429, True),
        (500, True),
        (404, False),
        (502, True),
    ],
)
def test_is_retryable_eventbrite_error(status_code: int, expected: bool) -> None:
    error = EventbriteApiError(status_code=status_code, message="failed")
    assert eventbrite_client._is_retryable_eventbrite_error(error) is expected


def test_is_retryable_eventbrite_error_retries_connection_errors() -> None:
    assert eventbrite_client._is_retryable_eventbrite_error(ConnectionError()) is True
    assert eventbrite_client._is_retryable_eventbrite_error(TimeoutError()) is True
