from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qs

from app.api.admin import _safe_handler
from app.api.public_reservation_payments import handle_public_reservation_payment_intent
from app.services.aws_proxy import AwsProxyError


def _valid_payment_body() -> dict[str, Any]:
    return {
        "service_tier": "3-4 years",
        "cohort_date": "2026-04",
        "price": 120.5,
    }


def test_payment_intent_rejects_non_post(api_gateway_event: Any) -> None:
    event = api_gateway_event(method="GET", path="/v1/reservations/payment-intent")

    response = handle_public_reservation_payment_intent(event, "GET")

    assert response["statusCode"] == 405
    body = json.loads(response["body"])
    assert body["error"] == "Method not allowed"
    assert body["code"] == "method_not_allowed"


def test_payment_intent_requires_turnstile_header(
    api_gateway_event: Any, monkeypatch: Any
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/reservations/payment-intent",
        body=json.dumps(_valid_payment_body()),
    )
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_SECRET_KEY", "sk_test_123")

    response = handle_public_reservation_payment_intent(event, "POST")

    assert response["statusCode"] == 400
    body = json.loads(response["body"])
    assert body["error"] == "Missing X-Turnstile-Token header"
    assert body["code"] == "invalid_request"


def test_payment_intent_rejects_failed_turnstile(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/reservations/payment-intent",
        body=json.dumps(_valid_payment_body()),
        headers={"X-Turnstile-Token": "test-token"},
    )
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(
        "app.api.public_reservation_payments.verify_turnstile_token",
        lambda *_args, **_kwargs: False,
    )

    response = handle_public_reservation_payment_intent(event, "POST")

    assert response["statusCode"] == 403
    body = json.loads(response["body"])
    assert body["error"] == "Captcha verification failed"
    assert body["code"] == "forbidden"


def test_payment_intent_maps_proxy_runtime_error_to_bad_gateway(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/reservations/payment-intent",
        body=json.dumps(_valid_payment_body()),
        headers={"X-Turnstile-Token": "test-token"},
    )
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(
        "app.api.public_reservation_payments.verify_turnstile_token",
        lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        "app.api.public_reservation_payments.http_invoke",
        lambda **_: (_ for _ in ()).throw(
            RuntimeError("AWS_PROXY_FUNCTION_ARN is not configured")
        ),
    )

    response = handle_public_reservation_payment_intent(event, "POST")

    assert response["statusCode"] == 502
    body = json.loads(response["body"])
    assert body["error"] == "Unable to initialize payment. Please try again."
    assert body["status"] == 502


def test_payment_intent_maps_proxy_error_to_bad_gateway(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/reservations/payment-intent",
        body=json.dumps(_valid_payment_body()),
        headers={"X-Turnstile-Token": "test-token"},
    )
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(
        "app.api.public_reservation_payments.verify_turnstile_token",
        lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        "app.api.public_reservation_payments.http_invoke",
        lambda **_: (_ for _ in ()).throw(AwsProxyError("ProxyError", "blocked")),
    )

    response = handle_public_reservation_payment_intent(event, "POST")

    assert response["statusCode"] == 502
    body = json.loads(response["body"])
    assert body["error"] == "Unable to initialize payment. Please try again."
    assert body["status"] == 502


def test_payment_intent_rejects_non_object_json_body(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/reservations/payment-intent",
        body=json.dumps(["not", "an", "object"]),
        headers={"X-Turnstile-Token": "test-token"},
    )
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(
        "app.api.public_reservation_payments.verify_turnstile_token",
        lambda *_args, **_kwargs: True,
    )

    response = _safe_handler(
        lambda: handle_public_reservation_payment_intent(event, "POST"), event
    )

    assert response["statusCode"] == 400
    body = json.loads(response["body"])
    assert body["error"] == "Request body must be a JSON object"
    assert body["code"] == "invalid_request"


def test_payment_intent_returns_client_secret_on_success(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/reservations/payment-intent",
        body=json.dumps(_valid_payment_body()),
        headers={"X-Turnstile-Token": "test-token"},
    )
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(
        "app.api.public_reservation_payments.verify_turnstile_token",
        lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        "app.api.public_reservation_payments.http_invoke",
        lambda **_: {
            "status": 200,
            "body": json.dumps({"id": "pi_123", "client_secret": "placeholder"}),
        },
    )

    response = handle_public_reservation_payment_intent(event, "POST")

    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {
        "payment_intent_id": "pi_123",
        "client_secret": "placeholder",
    }


def test_payment_intent_requests_card_only_when_no_pm_configuration(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/reservations/payment-intent",
        body=json.dumps(_valid_payment_body()),
        headers={"X-Turnstile-Token": "test-token"},
    )
    monkeypatch.delenv("STRIPE_PAYMENT_METHOD_CONFIGURATION_ID", raising=False)
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(
        "app.api.public_reservation_payments.verify_turnstile_token",
        lambda *_args, **_kwargs: True,
    )
    captured: dict[str, Any] = {}

    def capture_invoke(**kwargs: Any) -> dict[str, Any]:
        captured["body"] = kwargs.get("body")
        return {
            "status": 200,
            "body": json.dumps({"id": "pi_123", "client_secret": "placeholder"}),
        }

    monkeypatch.setattr(
        "app.api.public_reservation_payments.http_invoke",
        capture_invoke,
    )

    response = handle_public_reservation_payment_intent(event, "POST")

    assert response["statusCode"] == 200
    form = parse_qs(str(captured.get("body")))
    assert form.get("payment_method_types[0]") == ["card"]
    assert "automatic_payment_methods[enabled]" not in form


def test_payment_intent_stays_card_only_when_pm_configuration_env_set(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    """STRIPE_PAYMENT_METHOD_CONFIGURATION_ID is ignored; intents remain card-only."""
    event = api_gateway_event(
        method="POST",
        path="/v1/reservations/payment-intent",
        body=json.dumps(_valid_payment_body()),
        headers={"X-Turnstile-Token": "test-token"},
    )
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setenv("STRIPE_PAYMENT_METHOD_CONFIGURATION_ID", "pmc_test_123")
    monkeypatch.setattr(
        "app.api.public_reservation_payments.verify_turnstile_token",
        lambda *_args, **_kwargs: True,
    )
    captured: dict[str, Any] = {}

    def capture_invoke(**kwargs: Any) -> dict[str, Any]:
        captured["body"] = kwargs.get("body")
        return {
            "status": 200,
            "body": json.dumps({"id": "pi_123", "client_secret": "placeholder"}),
        }

    monkeypatch.setattr(
        "app.api.public_reservation_payments.http_invoke",
        capture_invoke,
    )

    response = handle_public_reservation_payment_intent(event, "POST")

    assert response["statusCode"] == 200
    form = parse_qs(str(captured.get("body")))
    assert form.get("payment_method_types[0]") == ["card"]
    assert "automatic_payment_methods[enabled]" not in form
    assert "payment_method_configuration" not in form


def test_payment_intent_uses_staging_secret_when_origin_matches_staging_site(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/reservations/payment-intent",
        body=json.dumps(_valid_payment_body()),
        headers={
            "X-Turnstile-Token": "test-token",
            "Origin": "https://www-staging.example.com",
        },
    )
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_SECRET_KEY", "sk_live_prod")
    monkeypatch.setenv("EVOLVESPROUTS_STRIPE_STAGING_SECRET_KEY", "sk_test_staging")
    monkeypatch.setenv(
        "PUBLIC_WWW_STAGING_SITE_ORIGIN",
        "https://www-staging.example.com",
    )
    monkeypatch.setattr(
        "app.api.public_reservation_payments.verify_turnstile_token",
        lambda *_args, **_kwargs: True,
    )
    captured: dict[str, Any] = {}

    def capture_invoke(**kwargs: Any) -> dict[str, Any]:
        captured["auth"] = (kwargs.get("headers") or {}).get("Authorization")
        return {
            "status": 200,
            "body": json.dumps({"id": "pi_123", "client_secret": "placeholder"}),
        }

    monkeypatch.setattr(
        "app.api.public_reservation_payments.http_invoke",
        capture_invoke,
    )

    response = handle_public_reservation_payment_intent(event, "POST")

    assert response["statusCode"] == 200
    assert captured.get("auth") == "Bearer sk_test_staging"
