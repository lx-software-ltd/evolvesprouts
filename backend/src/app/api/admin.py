"""Admin Lambda API entrypoint."""

from __future__ import annotations

from typing import Any
from collections.abc import Callable, Mapping

from app.api.assets import (
    handle_admin_assets_request,
    handle_email_download_request,
    handle_public_assets_request,
    handle_share_assets_request,
    handle_user_assets_request,
)
from app.api.admin_geographic_areas import handle_admin_geographic_areas_request
from app.api.admin_completion_certificates import (
    handle_admin_completion_certificates_request,
)
from app.api.admin_discount_codes import handle_admin_discount_codes_request
from app.api.admin_expenses import handle_admin_expenses_request
from app.api.admin_leads import handle_admin_leads_request
from app.api.admin_locations import handle_admin_locations_request
from app.api.admin_services import handle_admin_services_request
from app.api.admin_users import (
    handle_admin_instructors_request,
    handle_admin_users_request,
)
from app.api.admin_billing import handle_admin_billing_request
from app.api.admin_contacts import handle_admin_contacts_request
from app.api.admin_tags import handle_admin_tags_request
from app.api.admin_families import handle_admin_families_request
from app.api.admin_families_picker import handle_admin_families_picker_request
from app.api.admin_organizations import handle_admin_organizations_request
from app.api.admin_organizations_picker import handle_admin_organizations_picker_request
from app.api.admin_api_keys import handle_admin_api_keys_request
from app.api.admin_meta import handle_admin_meta_request
from app.api.admin_whatsapp import handle_admin_whatsapp_request
from app.api.public.meta_conversations import handle_public_meta_request
from app.api.public.whatsapp_conversations import handle_public_whatsapp_request
from app.api.assets.public_media_assets import handle_media_request
from app.api.public_mailchimp_webhook import handle_mailchimp_webhook
from app.api.public_meta_webhook import handle_meta_webhook
from app.api.public_whatsapp_webhook import handle_whatsapp_webhook
from app.api.assets.public_free_assets import handle_public_free_assets_list_request
from app.api.public_discount_validate import handle_public_discount_validate
from app.api.admin_audit_logs import handle_admin_audit_logs_request
from app.api.admin_calendar_manual_blocks import (
    handle_admin_calendar_manual_blocks_request,
)
from app.api.admin_forms import handle_admin_forms_request
from app.api.admin_polls import handle_admin_polls_request
from app.api.public_calendar_availability import handle_public_calendar_availability
from app.api.public_events import handle_public_events
from app.api.public_contact import handle_public_contact_us
from app.api.public_forms import handle_public_forms_request
from app.api.public_polls import handle_public_polls_request
from app.api.public_reservation_payments import handle_public_reservation_payment_intent
from app.api.public_reservations import _handle_public_reservation
from app.exceptions import AppError, ValidationError
from app.utils import json_response
from app.utils.logging import (
    clear_request_context,
    configure_logging,
    get_logger,
    set_request_context,
)
from app.utils.responses import api_gateway_http_method, validate_content_type

configure_logging()
logger = get_logger(__name__)

__all__ = ["lambda_handler"]

_ROUTES: tuple[
    tuple[str, bool, Callable[[Mapping[str, Any], str, str], dict[str, Any]]],
    ...,
] = (
    (
        "/v1/reservations",
        True,
        lambda event, method, _path: _handle_public_reservation(event, method),
    ),
    (
        "/v1/reservations/payment-intent",
        True,
        lambda event, method, _path: handle_public_reservation_payment_intent(
            event, method
        ),
    ),
    (
        "/www/v1/reservations",
        True,
        lambda event, method, _path: _handle_public_reservation(event, method),
    ),
    (
        "/www/v1/reservations/payment-intent",
        True,
        lambda event, method, _path: handle_public_reservation_payment_intent(
            event, method
        ),
    ),
    (
        "/v1/calendar/public",
        True,
        lambda event, method, _path: handle_public_events(event, method),
    ),
    (
        "/www/v1/calendar/public",
        True,
        lambda event, method, _path: handle_public_events(event, method),
    ),
    (
        "/v1/calendar/availability",
        True,
        lambda event, method, _path: handle_public_calendar_availability(event, method),
    ),
    (
        "/www/v1/calendar/availability",
        True,
        lambda event, method, _path: handle_public_calendar_availability(event, method),
    ),
    (
        "/v1/discounts/validate",
        True,
        lambda event, method, _path: handle_public_discount_validate(event, method),
    ),
    (
        "/www/v1/discounts/validate",
        True,
        lambda event, method, _path: handle_public_discount_validate(event, method),
    ),
    (
        "/v1/assets/free",
        True,
        lambda event, method, path: handle_public_free_assets_list_request(
            event, method, path
        ),
    ),
    (
        "/www/v1/assets/free",
        True,
        lambda event, method, path: handle_public_free_assets_list_request(
            event, method, path
        ),
    ),
    (
        "/v1/contact-us",
        True,
        lambda event, method, _path: handle_public_contact_us(event, method),
    ),
    (
        "/v1/forms",
        False,
        handle_public_forms_request,
    ),
    (
        "/www/v1/forms",
        False,
        handle_public_forms_request,
    ),
    (
        "/v1/polls",
        False,
        handle_public_polls_request,
    ),
    (
        "/www/v1/polls",
        False,
        handle_public_polls_request,
    ),
    (
        "/www/v1/contact-us",
        True,
        lambda event, method, _path: handle_public_contact_us(event, method),
    ),
    (
        "/v1/mailchimp/webhook",
        True,
        lambda event, method, _path: handle_mailchimp_webhook(event, method),
    ),
    (
        "/v1/whatsapp/webhook",
        True,
        lambda event, method, _path: handle_whatsapp_webhook(event, method),
    ),
    (
        "/v1/meta/webhook",
        True,
        lambda event, method, _path: handle_meta_webhook(event, method),
    ),
    (
        "/v1/public/whatsapp",
        False,
        handle_public_whatsapp_request,
    ),
    (
        "/v1/public/meta",
        False,
        handle_public_meta_request,
    ),
    (
        "/v1/admin/api-keys",
        False,
        handle_admin_api_keys_request,
    ),
    (
        "/v1/admin/whatsapp",
        False,
        handle_admin_whatsapp_request,
    ),
    (
        "/v1/admin/meta",
        False,
        handle_admin_meta_request,
    ),
    (
        "/v1/admin/geographic-areas",
        False,
        handle_admin_geographic_areas_request,
    ),
    (
        "/v1/admin/locations",
        False,
        handle_admin_locations_request,
    ),
    (
        "/v1/admin/leads",
        False,
        handle_admin_leads_request,
    ),
    (
        "/v1/admin/users",
        False,
        handle_admin_users_request,
    ),
    (
        "/v1/admin/instructors",
        False,
        handle_admin_instructors_request,
    ),
    (
        "/v1/admin/audit-logs",
        False,
        handle_admin_audit_logs_request,
    ),
    (
        "/v1/admin/services",
        False,
        handle_admin_services_request,
    ),
    (
        "/v1/admin/discount-codes",
        False,
        handle_admin_discount_codes_request,
    ),
    (
        "/v1/admin/completion-certificates",
        False,
        handle_admin_completion_certificates_request,
    ),
    (
        "/v1/admin/expenses",
        False,
        handle_admin_expenses_request,
    ),
    (
        "/v1/admin/billing",
        False,
        handle_admin_billing_request,
    ),
    (
        "/v1/admin/tags",
        False,
        handle_admin_tags_request,
    ),
    (
        "/v1/admin/calendar/manual-blocks",
        False,
        handle_admin_calendar_manual_blocks_request,
    ),
    (
        "/v1/admin/contacts",
        False,
        handle_admin_contacts_request,
    ),
    (
        "/v1/admin/families/picker",
        False,
        handle_admin_families_picker_request,
    ),
    (
        "/v1/admin/families",
        False,
        handle_admin_families_request,
    ),
    (
        "/v1/admin/organizations/picker",
        False,
        handle_admin_organizations_picker_request,
    ),
    (
        "/v1/admin/organizations",
        False,
        handle_admin_organizations_request,
    ),
    (
        "/v1/admin/forms",
        False,
        handle_admin_forms_request,
    ),
    (
        "/v1/admin/polls",
        False,
        handle_admin_polls_request,
    ),
    ("/v1/admin/assets", False, handle_admin_assets_request),
    ("/v1/user/assets", False, handle_user_assets_request),
    ("/v1/assets/share", False, handle_share_assets_request),
    ("/v1/assets/email-download", False, handle_email_download_request),
    (
        "/v1/assets/free/request",
        True,
        lambda event, method, _path: handle_media_request(event, method),
    ),
    (
        "/www/v1/assets/free/request",
        True,
        lambda event, method, _path: handle_media_request(event, method),
    ),
    ("/v1/assets/public", False, handle_public_assets_request),
)


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Handle requests routed to the admin Lambda."""
    request_id = event.get("requestContext", {}).get("requestId", "")
    set_request_context(req_id=request_id)
    try:
        method = api_gateway_http_method(event)
        path = event.get("path", "")

        try:
            if _requires_json_content_type(path, method):
                validate_content_type(event)
        except ValidationError as exc:
            logger.warning(f"Content-Type validation failed: {exc.message}")
            return json_response(exc.status_code, exc.to_dict(), event=event)

        logger.info(
            f"Admin request: {method} {path}",
            extra={
                "path": path,
                "method": method,
            },
        )

        handler = _match_handler(event=event, method=method, path=path)
        if handler is not None:
            return _safe_handler(handler, event)

        return json_response(404, {"error": "Not found"}, event=event)
    finally:
        clear_request_context()


def _safe_handler(
    handler: Any,
    event: Mapping[str, Any],
) -> dict[str, Any]:
    """Execute a handler with common error handling."""
    try:
        return handler()
    except AppError as exc:
        logger.warning(f"Application error: {exc.message}")
        return json_response(exc.status_code, exc.to_dict(), event=event)
    except ValueError as exc:
        logger.warning(f"Value error: {exc}")
        return json_response(400, {"error": str(exc)}, event=event)
    except Exception:  # pragma: no cover
        logger.exception("Unexpected error in handler")
        return json_response(500, {"error": "Internal server error"}, event=event)


def _match_handler(
    *,
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> Any:
    """Return the request handler for a known route, if any.

    Exact routes take precedence over prefix routes. When multiple routes match,
    the longest ``route_path`` wins so nested paths are not swallowed by shorter
    prefix handlers (for example ``/v1/assets/public`` vs ``/v1/assets/free``).
    """
    normalized_path = path.rstrip("/")
    exact_candidates: list[tuple[str, Callable[..., dict[str, Any]]]] = []
    prefix_candidates: list[tuple[str, Callable[..., dict[str, Any]]]] = []
    for route_path, exact, route_handler in _ROUTES:
        if exact:
            if normalized_path == route_path:
                exact_candidates.append((route_path, route_handler))
        elif _path_matches_prefix(normalized_path, route_path):
            prefix_candidates.append((route_path, route_handler))

    if exact_candidates:
        route_path, route_handler = max(exact_candidates, key=lambda t: len(t[0]))
        return lambda handler=route_handler: handler(event, method, normalized_path)

    if prefix_candidates:
        route_path, route_handler = max(prefix_candidates, key=lambda t: len(t[0]))
        return lambda handler=route_handler: handler(event, method, normalized_path)

    return None


def _path_matches_prefix(path: str, route_path: str) -> bool:
    """True if path equals route_path or extends it with further segments."""
    return path == route_path or path.startswith(route_path + "/")


def _requires_json_content_type(path: str, method: str) -> bool:
    """Return whether route requires application/json body validation."""
    if method not in ("POST", "PUT", "PATCH"):
        return False

    normalized_path = path.rstrip("/")
    non_json_routes = {
        "/v1/mailchimp/webhook",
        "/v1/whatsapp/webhook",
        "/v1/meta/webhook",
    }
    return normalized_path not in non_json_routes
