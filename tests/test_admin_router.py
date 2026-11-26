from __future__ import annotations

import json
import logging

import app.api.admin as admin_module
from app.api.admin import (
    _match_handler,
    _requires_json_content_type,
    _safe_handler,
    lambda_handler,
)

_PINNED_NON_AUDIENCE_CANONICAL_ROUTES = (
    "/v1/reservations",
    "/v1/reservations/payment-intent",
    "/v1/calendar/public",
    "/v1/calendar/availability",
    "/v1/discounts/validate",
    "/v1/assets/free",
    "/v1/contact-us",
    "/v1/forms",
    "/v1/polls",
    "/v1/mailchimp/webhook",
    "/v1/whatsapp/webhook",
    "/v1/meta/webhook",
    "/v1/assets/share",
    "/v1/assets/email-download",
    "/v1/assets/free/request",
    "/v1/assets/public",
)


def test_non_audience_canonical_routes_stay_pinned() -> None:
    published = tuple(
        path
        for path, _exact, _handler in admin_module._CANONICAL_ROUTES
        if not path.startswith(("/v1/admin/", "/v1/user/", "/v1/partner/"))
    )
    assert published == _PINNED_NON_AUDIENCE_CANONICAL_ROUTES


def test_lambda_handler_routes_custom_domain_base_path() -> None:
    event = {
        "httpMethod": "GET",
        "path": "/v1/webhooks/mailchimp",
        "headers": {},
        "requestContext": {"stage": "prod", "requestId": "req-custom-domain"},
    }

    response = lambda_handler(event, None)

    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"message": "ok"}
    assert event["path"] == "/v1/webhooks/mailchimp"


def test_lambda_handler_logs_gateway_path_and_domain(
    caplog: logging.LogCaptureFixture,
) -> None:
    event = {
        "httpMethod": "GET",
        "path": "/v1/webhooks/mailchimp",
        "headers": {},
        "requestContext": {
            "stage": "prod",
            "domainName": "api.example.com",
            "requestId": "req-log",
        },
    }

    with caplog.at_level(logging.INFO, logger="app.api.admin"):
        response = lambda_handler(event, None)

    assert response["statusCode"] == 200
    record = next(r for r in caplog.records if r.message.startswith("Admin request:"))
    assert record.message == "Admin request: GET /v1/webhooks/mailchimp"
    assert record.path == "/v1/webhooks/mailchimp"
    assert record.gateway_path == "/v1/webhooks/mailchimp"
    assert record.domain_name == "api.example.com"


def test_lambda_handler_reports_server_timing_and_cold_start_once(monkeypatch) -> None:
    monkeypatch.setattr(admin_module, "_first_invocation_pending", True)
    event = {"httpMethod": "GET", "path": "/v1/does-not-exist", "headers": {}}

    first = lambda_handler(event, None)
    second = lambda_handler(event, None)

    assert first["statusCode"] == 404
    first_timing = first["headers"]["Server-Timing"]
    assert first_timing.startswith("app;dur=")
    assert "cold;dur=" in first_timing
    assert (
        first["headers"]["Access-Control-Expose-Headers"]
        == "Server-Timing, x-request-id"
    )

    second_timing = second["headers"]["Server-Timing"]
    assert second_timing.startswith("app;dur=")
    assert "cold" not in second_timing


def test_safe_handler_hides_internal_exception_details() -> None:
    event = {"headers": {}}

    response = _safe_handler(
        lambda: (_ for _ in ()).throw(RuntimeError("db leaked")), event
    )

    assert response["statusCode"] == 500
    body = json.loads(response["body"])
    assert body["error"] == "Internal server error"
    assert body["code"] == "internal_error"
    assert "db leaked" not in response["body"]


def test_match_handler_routes_asset_prefix_paths() -> None:
    event = {"headers": {}}
    routes = (
        "/v1/admin/assets/abc",
        "/v1/admin/geographic-areas",
        "/v1/admin/locations",
        "/v1/admin/locations/abc",
        "/v1/admin/leads",
        "/v1/admin/leads/analytics",
        "/v1/admin/leads/abc",
        "/v1/admin/leads/abc/notes",
        "/v1/admin/users",
        "/v1/admin/cognito-users",
        "/v1/admin/cognito-users/ada@example.com",
        "/v1/admin/audit-logs",
        "/v1/admin/audit-logs/abc",
        "/v1/admin/tags",
        "/v1/admin/tags/abc",
        "/v1/admin/contacts",
        "/v1/admin/contacts/tags",
        "/v1/admin/contacts/abc",
        "/v1/admin/families",
        "/v1/admin/families/abc",
        "/v1/admin/families/abc/members",
        "/v1/admin/families/abc/members/def",
        "/v1/admin/organizations",
        "/v1/admin/organizations/abc",
        "/v1/admin/organizations/abc/members",
        "/v1/admin/organizations/abc/members/def",
        "/v1/user/assets/abc/download",
        "/v1/assets/share/token-123",
        "/v1/assets/email-download/token-456",
        "/v1/public/assets/abc/download",
        "/v1/public/assets/free/request",
        "/v1/public/reservations",
        "/v1/public/reservations/payment-intent",
        "/v1/public/contact-us",
        "/v1/public/discounts/validate",
        "/v1/webhooks/mailchimp",
        "/v1/webhooks/whatsapp",
        "/v1/webhooks/meta",
        "/v1/admin/whatsapp/conversations",
        "/v1/admin/whatsapp/conversations/abc/messages",
        "/v1/admin/whatsapp/import-jobs",
        "/v1/admin/meta/conversations",
        "/v1/admin/meta/conversations/abc/messages",
        "/v1/admin/meta/import-jobs",
        "/v1/admin/api-keys",
        "/v1/admin/api-keys/abc",
        "/v1/partner/whatsapp/conversations",
        "/v1/partner/whatsapp/conversations/abc/messages",
        "/v1/partner/meta/conversations",
        "/v1/partner/meta/conversations/abc/messages",
        "/v1/partner/contacts",
        "/v1/partner/contacts/abc",
        "/v1/partner/services",
        "/v1/partner/services/instances",
        "/v1/partner/services/abc",
        "/v1/partner/services/abc/instances",
        "/v1/partner/services/abc/instances/def",
        "/v1/public/calendar",
        "/v1/public/calendar/availability",
        "/v1/public/polls/workshop-food-jun-26/answers",
        "/v1/public/reservations",
        "/v1/public/assets/abc/download",
        "/v1/webhooks/mailchimp",
    )
    for path in routes:
        method = "PUT" if path.endswith("/answers") else "GET"
        handler = _match_handler(event=event, method=method, path=path)
        assert handler is not None


def test_match_handler_treats_exact_public_post_routes_as_exact_path_only() -> None:
    event = {"headers": {}}
    assert (
        _match_handler(event=event, method="POST", path="/v1/public/reservations")
        is not None
    )
    assert (
        _match_handler(
            event=event, method="POST", path="/v1/public/reservations/payment-intent"
        )
        is not None
    )
    assert (
        _match_handler(
            event=event, method="POST", path="/v1/public/assets/free/request"
        )
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/webhooks/mailchimp")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/webhooks/whatsapp")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/webhooks/meta") is not None
    )
    assert _match_handler(event=event, method="POST", path="/v1/contact-us") is None
    assert _match_handler(event=event, method="POST", path="/www/v1/contact-us") is None
    assert (
        _match_handler(event=event, method="POST", path="/v1/public/contact-us")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/public/discounts/validate")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/public/reservations/extra")
        is None
    )
    assert (
        _match_handler(
            event=event, method="POST", path="/v1/reservations/payment-intent/extra"
        )
        is None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/assets/free/request/extra")
        is None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/mailchimp/webhook/extra")
        is None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/whatsapp/webhook/extra")
        is None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/meta/webhook/extra")
        is None
    )
    assert (
        _match_handler(
            event=event, method="POST", path="/www/v1/assets/free/request/extra"
        )
        is None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/contact-us/extra") is None
    )
    assert (
        _match_handler(event=event, method="POST", path="/www/v1/contact-us/extra")
        is None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/discounts/validate/extra")
        is None
    )
    assert (
        _match_handler(
            event=event, method="POST", path="/www/v1/discounts/validate/extra"
        )
        is None
    )
    assert (
        _match_handler(
            event=event, method="POST", path="/www/v1/reservations/payment-intent/extra"
        )
        is None
    )


def test_requires_json_content_type_skips_mailchimp_webhook() -> None:
    assert _requires_json_content_type("/v1/webhooks/mailchimp", "POST") is False
    assert _requires_json_content_type("/v1/webhooks/whatsapp", "POST") is False
    assert _requires_json_content_type("/v1/webhooks/meta", "POST") is False
    assert _requires_json_content_type("/v1/public/assets/free/request", "POST") is True
