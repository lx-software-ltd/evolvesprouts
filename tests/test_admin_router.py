from __future__ import annotations

import json

from app.api.admin import _match_handler, _requires_json_content_type, _safe_handler


def test_safe_handler_hides_internal_exception_details() -> None:
    event = {"headers": {}}

    response = _safe_handler(
        lambda: (_ for _ in ()).throw(RuntimeError("db leaked")), event
    )

    assert response["statusCode"] == 500
    body = json.loads(response["body"])
    assert body == {"error": "Internal server error"}
    assert "detail" not in body


def test_match_handler_routes_asset_prefix_paths() -> None:
    event = {"headers": {}}
    routes = (
        "/v1/admin/assets/abc",
        "/v1/admin/geographic-areas",
        "/v1/admin/locations",
        "/v1/admin/locations/abc",
        "/v1/admin/leads",
        "/v1/admin/leads/analytics",
        "/v1/admin/leads/export",
        "/v1/admin/leads/abc",
        "/v1/admin/leads/abc/notes",
        "/v1/admin/users",
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
        "/v1/assets/public/abc/download",
        "/v1/assets/free/request",
        "/v1/reservations",
        "/v1/reservations/payment-intent",
        "/v1/contact-us",
        "/v1/discounts/validate",
        "/www/v1/discounts/validate",
        "/www/v1/contact-us",
        "/v1/mailchimp/webhook",
        "/v1/whatsapp/webhook",
        "/v1/meta/webhook",
        "/v1/admin/whatsapp/conversations",
        "/v1/admin/whatsapp/conversations/abc/messages",
        "/v1/admin/meta/conversations",
        "/v1/admin/meta/conversations/abc/messages",
        "/v1/admin/api-keys",
        "/v1/admin/api-keys/abc",
        "/v1/public/whatsapp/conversations",
        "/v1/public/whatsapp/conversations/abc/messages",
        "/v1/public/meta/conversations",
        "/v1/public/meta/conversations/abc/messages",
        "/v1/calendar/public",
        "/www/v1/calendar/public",
        "/v1/calendar/availability",
        "/www/v1/calendar/availability",
        "/www/v1/assets/free/request",
        "/www/v1/reservations",
        "/www/v1/reservations/payment-intent",
        "/www/v1/polls/workshop-food-jun-26/answers",
    )
    for path in routes:
        method = "PUT" if path.endswith("/answers") else "GET"
        handler = _match_handler(event=event, method=method, path=path)
        assert handler is not None


def test_match_handler_treats_exact_public_post_routes_as_exact_path_only() -> None:
    event = {"headers": {}}
    assert (
        _match_handler(event=event, method="POST", path="/v1/reservations") is not None
    )
    assert (
        _match_handler(
            event=event, method="POST", path="/v1/reservations/payment-intent"
        )
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/assets/free/request")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/mailchimp/webhook")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/whatsapp/webhook")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/meta/webhook") is not None
    )
    assert (
        _match_handler(
            event=event, method="POST", path="/www/v1/reservations/payment-intent"
        )
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/www/v1/assets/free/request")
        is not None
    )
    assert _match_handler(event=event, method="POST", path="/v1/contact-us") is not None
    assert (
        _match_handler(event=event, method="POST", path="/v1/discounts/validate")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/www/v1/discounts/validate")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/www/v1/reservations")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/www/v1/contact-us")
        is not None
    )
    assert (
        _match_handler(event=event, method="POST", path="/v1/reservations/extra")
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
    assert _requires_json_content_type("/v1/mailchimp/webhook", "POST") is False
    assert _requires_json_content_type("/v1/whatsapp/webhook", "POST") is False
    assert _requires_json_content_type("/v1/meta/webhook", "POST") is False
    assert _requires_json_content_type("/v1/assets/free/request", "POST") is True
