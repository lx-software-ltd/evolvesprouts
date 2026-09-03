"""Native public contact-us handler (Aurora + post-success hooks)."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.api.admin_request import parse_body
from app.api.validators import (
    validate_email,
    validate_phone_fields,
    validate_phone_region,
    validate_string_length,
)
from app.api.public_form_hooks import run_contact_us_post_success
from app.utils.phone import default_phone_region
from app.db.engine import get_engine
from app.db.models.enums import (
    ContactSource,
    ContactType,
    LeadEventType,
    LeadType,
)
from app.db.repositories.contact import ContactRepository
from app.exceptions import ValidationError
from app.services.lead_funnel_automation import ensure_contact_lead
from app.services.turnstile import (
    extract_client_ip,
    extract_turnstile_token,
    verify_turnstile_token,
)
from app.utils import json_response, method_not_allowed
from app.utils.logging import get_logger

logger = get_logger(__name__)

_MAX_FIRST_NAME = 100
_MAX_EMAIL_LEN = 320
_MAX_PHONE = 40
_MAX_MESSAGE = 2000
_SIGNUP_INTENTS = frozenset(
    {"contact_inquiry", "community_newsletter", "event_notification"}
)
_ALLOWED_LOCALES = frozenset({"en", "zh-CN", "zh-HK"})


def handle_public_contact_us(
    event: Mapping[str, Any],
    method: str,
) -> dict[str, Any]:
    """Handle POST /v1/contact-us and /www/v1/contact-us."""
    if method != "POST":
        return method_not_allowed(event)

    turnstile_token = extract_turnstile_token(event)
    if not turnstile_token:
        return json_response(
            400,
            {"error": "Missing X-Turnstile-Token header"},
            event=event,
        )
    remote_ip = extract_client_ip(event)
    if not verify_turnstile_token(turnstile_token, remote_ip=remote_ip):
        return json_response(
            403,
            {"error": "Captcha verification failed"},
            event=event,
        )

    try:
        body = parse_body(event)
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    try:
        normalized = _validate_contact_body(body)
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    try:
        with Session(get_engine()) as session:
            contact_repo = ContactRepository(session)
            contact, _created = contact_repo.upsert_by_email(
                normalized["email_address"],
                first_name=normalized["first_name"],
                source=ContactSource.CONTACT_FORM,
                source_detail=normalized["signup_intent"],
                contact_type=ContactType.PARENT,
            )
            if (
                normalized["phone_number"] is not None
                and str(normalized["phone_number"]).strip()
            ):
                region = normalized["phone_country"] or default_phone_region()
                contact.phone_region, contact.phone_national_number = (
                    validate_phone_fields(region, normalized["phone_number"])
                )
            contact_repo.update(contact)
            lead_type = _lead_type_for_intent(normalized["signup_intent"])
            ensure_contact_lead(
                session,
                contact_id=contact.id,
                contact=contact,
                lead_type=lead_type,
                metadata={
                    "signup_intent": normalized["signup_intent"],
                    "locale": normalized["locale"],
                },
                attach_event_type=LeadEventType.ACTION_RECORDED,
            )
            session.commit()
    except Exception:
        logger.exception("Contact us Aurora persistence failed")
        return json_response(
            500,
            {"error": "Unable to save submission. Please try again."},
            event=event,
        )

    payload_for_hooks = _body_for_hooks(normalized)
    try:
        run_contact_us_post_success(event=event, payload=payload_for_hooks)
    except Exception:
        logger.exception("Contact us post-success hooks failed after commit")

    return json_response(
        202,
        {"message": "Contact submission accepted"},
        event=event,
    )


def _validate_contact_body(body: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(body, Mapping):
        raise ValidationError("Request body must be a JSON object")

    first_name = validate_string_length(
        body.get("first_name"),
        field_name="first_name",
        max_length=_MAX_FIRST_NAME,
        required=True,
    )
    if first_name is None:
        raise ValidationError("first_name is required", field="first_name")

    email_address = validate_email(body.get("email_address"))
    if email_address is None:
        raise ValidationError("email_address is required", field="email_address")
    if len(email_address) > _MAX_EMAIL_LEN:
        raise ValidationError("email_address is too long", field="email_address")

    phone_number = validate_string_length(
        body.get("phone_number"),
        field_name="phone_number",
        max_length=_MAX_PHONE,
        required=False,
    )
    phone_country_raw = body.get("phone_country")
    phone_country: str | None = None
    if phone_country_raw is not None and str(phone_country_raw).strip() != "":
        phone_country = validate_phone_region(phone_country_raw)
        if phone_country is None:
            raise ValidationError(
                "phone_country must be a valid ISO region code",
                field="phone_country",
            )

    message = validate_string_length(
        body.get("message"),
        field_name="message",
        max_length=_MAX_MESSAGE,
        required=False,
    )

    marketing_opt_in = _parse_bool_opt(body.get("marketing_opt_in"), default=False)

    raw_intent = body.get("signup_intent")
    if not isinstance(raw_intent, str) or not raw_intent.strip():
        raise ValidationError("signup_intent is required", field="signup_intent")
    signup_intent = raw_intent.strip()
    if signup_intent not in _SIGNUP_INTENTS:
        raise ValidationError("signup_intent is invalid", field="signup_intent")

    locale = _normalize_locale(body.get("locale"))

    phone_region_parsed: str | None = None
    phone_national_parsed: str | None = None
    if phone_number is not None and str(phone_number).strip():
        region = phone_country or default_phone_region()
        phone_region_parsed, phone_national_parsed = validate_phone_fields(
            region, phone_number
        )

    return {
        "first_name": first_name,
        "email_address": email_address,
        "phone_number": phone_number,
        "phone_country": phone_country,
        "phone_region": phone_region_parsed,
        "phone_national_number": phone_national_parsed,
        "message": message,
        "marketing_opt_in": marketing_opt_in,
        "signup_intent": signup_intent,
        "locale": locale,
    }


def _lead_type_for_intent(signup_intent: str) -> LeadType:
    """Map a public form intent to a sales lead type."""
    if signup_intent == "event_notification":
        return LeadType.EVENT_INQUIRY
    return LeadType.OTHER


def _normalize_locale(value: Any) -> str:
    if not isinstance(value, str):
        return "en"
    s = value.strip()
    return s if s in _ALLOWED_LOCALES else "en"


def _parse_bool_opt(value: Any, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    if isinstance(value, (int, float)):
        return bool(value)
    return default


def _body_for_hooks(normalized: Mapping[str, Any]) -> dict[str, Any]:
    """Shape expected by ``run_contact_us_post_success`` (snake_case keys)."""
    out: dict[str, Any] = {
        "first_name": normalized["first_name"],
        "email_address": normalized["email_address"],
        "marketing_opt_in": normalized["marketing_opt_in"],
        "signup_intent": normalized["signup_intent"],
        "locale": normalized["locale"],
    }
    phone = normalized.get("phone_number")
    if phone:
        out["phone_number"] = phone
    if normalized.get("phone_country"):
        out["phone_country"] = normalized["phone_country"]
    if normalized.get("phone_region") and normalized.get("phone_national_number"):
        out["phone_region"] = normalized["phone_region"]
        out["phone_national_number"] = normalized["phone_national_number"]
    msg = normalized.get("message")
    if msg:
        out["message"] = msg
    return out
