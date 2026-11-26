from __future__ import annotations

import importlib
import json
import logging
import re
from pathlib import Path

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


def test_legacy_partner_alias_reaches_the_partner_handler(
    api_gateway_event,
) -> None:
    event = api_gateway_event(
        method="POST",
        path="/v1/public/whatsapp/conversations",
        authorizer_context={
            "apiKeyId": "11111111-1111-1111-1111-111111111111",
            "scope": "admin",
            "userSub": "api-key:11111111-1111-1111-1111-111111111111",
        },
    )
    response = lambda_handler(event, None)
    assert response["statusCode"] == 405


def test_lambda_handler_routes_custom_domain_base_path() -> None:
    event = {
        "httpMethod": "GET",
        "path": "/prod/v1/mailchimp/webhook",
        "headers": {},
        "requestContext": {"stage": "prod", "requestId": "req-custom-domain"},
    }

    response = lambda_handler(event, None)

    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"message": "ok"}
    assert event["path"] == "/prod/v1/mailchimp/webhook"


def test_lambda_handler_logs_gateway_path_and_domain(
    caplog: logging.LogCaptureFixture,
) -> None:
    event = {
        "httpMethod": "GET",
        "path": "/prod/v1/mailchimp/webhook",
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
    assert record.message == (
        "Admin request: GET /v1/mailchimp/webhook"
        " gateway_path=/prod/v1/mailchimp/webhook"
    )
    assert record.path == "/v1/mailchimp/webhook"
    assert record.gateway_path == "/prod/v1/mailchimp/webhook"
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
        "/v1/calendar/public",
        "/www/v1/calendar/public",
        "/v1/calendar/availability",
        "/www/v1/calendar/availability",
        "/www/v1/assets/free/request",
        "/www/v1/reservations",
        "/www/v1/reservations/payment-intent",
        "/www/v1/polls/workshop-food-jun-26/answers",
        "/v1/public/calendar",
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


_REPO_ROOT = Path(__file__).resolve().parents[1]
_HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
_PATH_SAMPLES = {
    "id": "11111111-1111-4111-8111-111111111111",
    "token": "abcdefghijklmnopqrstuvwx",
    "form_slug": "workshop",
    "poll_slug": "workshop",
    "question_id": "food",
}


def _concrete_path(template: str) -> str:
    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        sample = _PATH_SAMPLES.get(name)
        if sample is None:
            raise AssertionError(f"no sample for path parameter {name}")
        return sample

    return re.sub(r"\{([^}]+)\}", _replace, template)


def _public_yaml_operations() -> list[tuple[str, str]]:
    spec = (_REPO_ROOT / "docs/api/public.yaml").read_text()
    operations: list[tuple[str, str]] = []
    in_paths = False
    current = ""
    for line in spec.splitlines():
        if line == "paths:":
            in_paths = True
            continue
        if in_paths and line.startswith("components:"):
            break
        if not in_paths:
            continue
        path_match = re.match(r"^ {2}(/[^:]+):\s*$", line)
        if path_match:
            current = _concrete_path(path_match.group(1))
            continue
        method_match = re.match(r"^ {4}([a-z]+):\s*$", line)
        if current and method_match and method_match.group(1) in _HTTP_METHODS:
            operations.append((method_match.group(1).upper(), current))
    if not operations:
        raise AssertionError("docs/api/public.yaml has no operations")
    return operations


def _media_rewrite_operations() -> list[tuple[str, str]]:
    """Paths the CloudFront media and allow-list functions hand to the API."""
    source = (
        _REPO_ROOT / "backend/infrastructure/lib/cloudfront-www-proxy-functions.ts"
    ).read_text()
    operations: list[tuple[str, str]] = []
    for uri in re.findall(r"request\.uri = '(/[^']+)'", source):
        method = "POST" if uri.endswith("/request") else "GET"
        operations.append((method, uri))

    entries = source.split("PROXY_ALLOWLIST_ENTRIES", 1)[1].split(
        "function quoteJs", 1
    )[0]
    for block in re.findall(r"\{[^{}]+\}", entries):
        methods_match = re.search(r"methods: \[([^\]]+)\]", block)
        kind = re.search(r'kind: "([^"]+)"', block)
        www_path = re.search(r'wwwPath: "([^"]+)"', block)
        api_path = re.search(r'apiPath: "([^"]+)"', block)
        suffix = re.search(r'suffix: "([^"]+)"', block)
        contains = re.search(r'contains: "([^"]+)"', block)
        if (
            methods_match is None
            or kind is None
            or www_path is None
            or api_path is None
        ):
            continue
        methods = re.findall(r'"([A-Z]+)"', methods_match.group(1))
        tail = ""
        if kind.group(1) == "prefix":
            middle = contains.group(1) + "food" if contains else ""
            tail = "workshop" + middle + (suffix.group(1) if suffix else "")
        for raw in (www_path.group(1), api_path.group(1)):
            produced = raw[4:] + tail
            for method in methods:
                if method == "OPTIONS":
                    continue
                operations.append((method, produced))
    return operations


def _stop_external_calls(monkeypatch) -> None:
    def _boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("stopped before a dependency")

    for module_name in (
        "app.api.assets.public_assets",
        "app.api.assets.public_free_assets",
        "app.api.assets.share_assets",
        "app.api.public_events",
        "app.api.public_calendar_availability",
        "app.api.public_forms_contact",
        "app.api.public_discount_validate",
        "app.api.public_contact",
        "app.api.public_reservations",
        "app.api.public_reservation_payments",
    ):
        module = importlib.import_module(module_name)
        if hasattr(module, "get_engine"):
            monkeypatch.setattr(module, "get_engine", _boom)
    polls = importlib.import_module("app.api.public_polls")
    for name in (
        "get_poll_control_state",
        "put_poll_control_state",
        "list_poll_answers_for_session",
        "aggregate_poll_question_results",
        "upsert_poll_answer",
        "upsert_form_answer",
    ):
        if hasattr(polls, name):
            monkeypatch.setattr(polls, name, _boom)
    forms = importlib.import_module("app.api.public_forms")
    if hasattr(forms, "upsert_form_answer"):
        monkeypatch.setattr(forms, "upsert_form_answer", _boom)


def test_public_spec_and_media_rewrites_are_not_404(monkeypatch) -> None:
    _stop_external_calls(monkeypatch)
    seen: set[tuple[str, str]] = set()
    failures: list[str] = []
    for method, path in _public_yaml_operations() + _media_rewrite_operations():
        if (method, path) in seen:
            continue
        seen.add((method, path))
        event = {
            "httpMethod": method,
            "path": path,
            "headers": {"Content-Type": "application/json", "host": "example.com"},
            "body": "{}" if method in {"POST", "PUT", "PATCH"} else None,
            "requestContext": {"requestId": "router-public"},
        }
        response = lambda_handler(event, None)
        if response["statusCode"] == 404:
            failures.append(f"{method} {path}")
    assert failures == []
