from __future__ import annotations

import json
from typing import Any

from app.api.assets.public_media_assets import handle_media_request


def test_media_request_rejects_non_post(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/assets/free/request")

    response = handle_media_request(event, "GET")

    assert response["statusCode"] == 405
    body = json.loads(response["body"])
    assert body["error"] == "Method not allowed"
    assert body["code"] == "method_not_allowed"


def test_media_request_requires_turnstile_header(api_gateway_event: Any) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/assets/free/request",
        body=json.dumps({"first_name": "Ida", "email": "ida@example.com"}),
    )

    response = handle_media_request(event, "POST")

    assert response["statusCode"] == 400
    body = json.loads(response["body"])
    assert body["error"] == "Missing X-Turnstile-Token header"
    assert body["code"] == "invalid_request"


def test_media_request_rejects_failed_turnstile(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/assets/free/request",
        body=json.dumps({"first_name": "Ida", "email": "ida@example.com"}),
        headers={"X-Turnstile-Token": "test-token"},
    )
    monkeypatch.setattr(
        "app.api.assets.public_media_assets.verify_turnstile_token",
        lambda *_args, **_kwargs: False,
    )

    response = handle_media_request(event, "POST")

    assert response["statusCode"] == 403
    body = json.loads(response["body"])
    assert body["error"] == "Captcha verification failed"
    assert body["code"] == "forbidden"


def test_media_request_returns_500_without_topic(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/assets/free/request",
        body=json.dumps({"first_name": "Ida", "email": "ida@example.com"}),
        headers={"X-Turnstile-Token": "test-token"},
    )
    monkeypatch.delenv("MEDIA_REQUEST_TOPIC_ARN", raising=False)
    monkeypatch.setattr(
        "app.api.assets.public_media_assets.verify_turnstile_token",
        lambda *_args, **_kwargs: True,
    )

    response = handle_media_request(event, "POST")

    assert response["statusCode"] == 500
    body = json.loads(response["body"])
    assert body["error"] == "Service configuration error. Please contact support."
    assert body["code"] == "internal_error"


def test_media_request_publishes_to_sns(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/assets/free/request",
        body=json.dumps(
            {
                "first_name": " Ida ",
                "email": "IDA@Example.com",
                "resource_key": " Public Website: Patience Free Guide ",
            }
        ),
        headers={"X-Turnstile-Token": "test-token"},
    )

    class _FakeSnsClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        def publish(self, **kwargs: Any) -> dict[str, str]:
            self.calls.append(kwargs)
            return {"MessageId": "abc123"}

    fake_sns_client = _FakeSnsClient()
    monkeypatch.setenv("DEPLOYMENT_STAGE", "production")
    monkeypatch.setenv(
        "MEDIA_REQUEST_TOPIC_ARN", "arn:aws:sns:ap-southeast-1:123:topic"
    )
    monkeypatch.setattr(
        "app.api.assets.public_media_assets.verify_turnstile_token",
        lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        "app.api.assets.public_media_assets.get_sns_client",
        lambda: fake_sns_client,
    )

    response = handle_media_request(event, "POST")

    assert response["statusCode"] == 202
    assert json.loads(response["body"]) == {"message": "Request accepted"}
    assert len(fake_sns_client.calls) == 1
    assert (
        fake_sns_client.calls[0]["TopicArn"] == "arn:aws:sns:ap-southeast-1:123:topic"
    )

    published_message = json.loads(fake_sns_client.calls[0]["Message"])
    assert published_message["event_type"] == "media_request.submitted"
    assert published_message["first_name"] == "Ida"
    assert published_message["email"] == "ida@example.com"
    assert (
        published_message["resource_key"] == "public-website-" + "patience-free-guide"
    )
    assert published_message["marketing_opt_in"] is False
    assert published_message["locale"] == "en"
