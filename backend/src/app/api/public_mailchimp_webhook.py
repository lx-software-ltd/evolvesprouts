"""Public Mailchimp webhook endpoint handler."""

from __future__ import annotations

import base64
import hmac
import os
from typing import Any
from urllib.parse import parse_qs
from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.db.engine import get_engine
from app.db.models import MailchimpSyncStatus
from app.db.repositories.contact import ContactRepository
from app.utils import json_response, method_not_allowed
from app.utils.logging import get_logger, mask_email

logger = get_logger(__name__)

_SUPPORTED_EVENT_TYPES = frozenset(
    {"subscribe", "unsubscribe", "cleaned", "profile", "upemail"}
)
_WEBHOOK_TOKEN_QUERY_KEY = "token"  # nosec B105 - static query parameter name
_WEBHOOK_SECRET_ENV_NAME = (  # nosec B105 - env var key, not a secret value
    "MAILCHIMP_WEBHOOK_SECRET"
)
_TOKEN_HEADER_CANDIDATES = ("x-mailchimp-webhook-token", "x-webhook-token")


def handle_mailchimp_webhook(
    event: Mapping[str, Any],
    method: str,
) -> dict[str, Any]:
    """Handle Mailchimp webhook events and reconcile contact sync status."""
    if method in {"GET", "HEAD"}:
        return json_response(200, {"message": "ok"}, event=event)
    if method != "POST":
        return method_not_allowed(event)

    expected_secret = os.getenv(_WEBHOOK_SECRET_ENV_NAME, "").strip()
    if not expected_secret:
        logger.error("MAILCHIMP_WEBHOOK_SECRET is not configured")
        return json_response(
            500,
            {"error": "Service configuration error. Please contact support."},
            event=event,
        )

    provided_secret = _extract_webhook_secret(event)
    if not provided_secret or not hmac.compare_digest(provided_secret, expected_secret):
        logger.warning("Rejected Mailchimp webhook due to invalid secret")
        return json_response(401, {"error": "Unauthorized"}, event=event)

    payload = _parse_form_payload(event)
    event_type = _optional_text(payload.get("type"))
    if event_type not in _SUPPORTED_EVENT_TYPES:
        logger.info(
            "Ignoring unsupported Mailchimp webhook event",
            extra={"event_type": event_type},
        )
        return json_response(
            200,
            {"message": "ignored", "reason": "unsupported_event_type"},
            event=event,
        )

    resolved_email = _resolve_webhook_email(payload, event_type=event_type)
    if not resolved_email:
        logger.warning(
            "Ignoring Mailchimp webhook without an email",
            extra={"event_type": event_type},
        )
        return json_response(
            200,
            {"message": "ignored", "reason": "missing_email"},
            event=event,
        )

    updated = _apply_mailchimp_status_update(
        email=resolved_email,
        event_type=event_type,
        payload=payload,
    )
    return json_response(
        200,
        {"message": "ok" if updated else "ignored"},
        event=event,
    )


def _apply_mailchimp_status_update(
    *,
    email: str,
    event_type: str,
    payload: Mapping[str, str],
) -> bool:
    with Session(get_engine()) as session:
        contact_repo = ContactRepository(session)
        contact = contact_repo.find_by_email(email)
        if contact is None and event_type == "upemail":
            old_email = _optional_email(payload.get("data[old_email]"))
            if old_email:
                contact = contact_repo.find_by_email(old_email)
                if (
                    contact is not None
                    and old_email != email
                    and contact_repo.find_by_email(email) is None
                ):
                    contact.email = email
        if contact is None:
            logger.info(
                "Mailchimp webhook contact not found",
                extra={"event_type": event_type, "lead_email": mask_email(email)},
            )
            return False

        contact.mailchimp_status = _status_for_event(event_type)
        subscriber_id = _optional_text(payload.get("data[id]"))
        if subscriber_id:
            contact.mailchimp_subscriber_id = subscriber_id
        session.commit()

    logger.info(
        "Processed Mailchimp webhook",
        extra={"event_type": event_type, "lead_email": mask_email(email)},
    )
    return True


def _status_for_event(event_type: str) -> MailchimpSyncStatus:
    if event_type in {"unsubscribe", "cleaned"}:
        return MailchimpSyncStatus.UNSUBSCRIBED
    return MailchimpSyncStatus.SYNCED


def _extract_webhook_secret(event: Mapping[str, Any]) -> str:
    query_params = event.get("queryStringParameters") or {}
    query_secret = _optional_text(query_params.get(_WEBHOOK_TOKEN_QUERY_KEY))
    if query_secret:
        return query_secret

    headers = event.get("headers") or {}
    for key, value in headers.items():
        if str(key).lower() in _TOKEN_HEADER_CANDIDATES:
            header_secret = _optional_text(value)
            if header_secret:
                return header_secret
    return ""


def _parse_form_payload(event: Mapping[str, Any]) -> dict[str, str]:
    raw_body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        try:
            raw_body = base64.b64decode(raw_body).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            raw_body = ""

    if not isinstance(raw_body, str) or not raw_body:
        return {}

    parsed = parse_qs(raw_body, keep_blank_values=True)
    return {key: values[0] if values else "" for key, values in parsed.items()}


def _resolve_webhook_email(
    payload: Mapping[str, str], *, event_type: str
) -> str | None:
    if event_type == "upemail":
        return _optional_email(payload.get("data[new_email]")) or _optional_email(
            payload.get("data[email]")
        )
    return _optional_email(payload.get("data[email]"))


def _optional_email(value: Any) -> str | None:
    normalized = _optional_text(value)
    if not normalized:
        return None
    lowered = normalized.lower()
    if "@" not in lowered:
        return None
    return lowered


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None
