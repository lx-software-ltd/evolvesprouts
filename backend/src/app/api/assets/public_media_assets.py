"""Public media lead capture endpoint handlers."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import re
from typing import Any
from collections.abc import Mapping

from app.api.admin_request import parse_body
from app.api.validators import validate_email, validate_string_length
from app.exceptions import ValidationError
from app.services.aws_clients import get_sns_client
from app.services.turnstile import (
    extract_client_ip,
    extract_turnstile_token,
    verify_turnstile_token,
)
from app.utils import json_response, method_not_allowed
from app.utils.deployment import is_production
from app.utils.logging import get_logger, mask_email

logger = get_logger(__name__)

_MAX_FIRST_NAME_LENGTH = 100
_MAX_RESOURCE_KEY_LENGTH = 64
_EVENT_TYPE = "media_request.submitted"
_RESOURCE_KEY_SANITIZE_PATTERN = re.compile(r"[^a-z0-9]+")


def handle_media_request(
    event: Mapping[str, Any],
    method: str,
) -> dict[str, Any]:
    """Handle POST /v1/assets/free/request (and /www/... website proxy path)."""
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

    body = parse_body(event)
    first_name = _validate_first_name(body.get("first_name"))
    email = _validate_required_email(body.get("email"))
    resource_key = _validate_optional_resource_key(body.get("resource_key"))
    marketing_opt_in = _parse_marketing_opt_in(body.get("marketing_opt_in"))
    locale = _normalize_locale(body.get("locale"))

    topic_arn = os.getenv("MEDIA_REQUEST_TOPIC_ARN", "").strip()
    if not topic_arn:
        logger.error("MEDIA_REQUEST_TOPIC_ARN is not configured")
        return json_response(
            500,
            {"error": "Service configuration error. Please contact support."},
            event=event,
        )

    request_id = str(event.get("requestContext", {}).get("requestId", "")).strip()
    message_payload = {
        "event_type": _EVENT_TYPE,
        "first_name": first_name,
        "email": email,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "request_id": request_id,
        "marketing_opt_in": marketing_opt_in,
        "locale": locale,
    }
    if resource_key is not None:
        message_payload["resource_key"] = resource_key

    if not is_production():
        logger.info(
            "Staging SNS publish skipped for media request",
            extra={
                "lead_email": mask_email(email),
                "message_payload": message_payload,
            },
        )
    else:
        try:
            get_sns_client().publish(
                TopicArn=topic_arn,
                Message=json.dumps(message_payload),
                MessageAttributes={
                    "event_type": {
                        "DataType": "String",
                        "StringValue": _EVENT_TYPE,
                    },
                },
            )
        except Exception:
            logger.exception(
                "Failed to publish media request",
                extra={"lead_email": mask_email(email)},
            )
            return json_response(
                500,
                {"error": "Failed to submit request. Please try again."},
                event=event,
            )

    logger.info(
        "Media request accepted",
        extra={
            "lead_email": mask_email(email),
            "request_id": request_id,
        },
    )
    return json_response(
        202,
        {"message": "Request accepted"},
        event=event,
    )


def _validate_first_name(value: Any) -> str:
    normalized_value = validate_string_length(
        value,
        field_name="first_name",
        max_length=_MAX_FIRST_NAME_LENGTH,
        required=True,
    )
    if normalized_value is None:
        raise ValidationError("first_name is required", field="first_name")
    return normalized_value


def _validate_required_email(value: Any) -> str:
    normalized_value = validate_email(value)
    if normalized_value is None:
        raise ValidationError("email is required", field="email")
    return normalized_value


def _slugify_resource_key(value: str) -> str:
    slug = _RESOURCE_KEY_SANITIZE_PATTERN.sub("-", value.lower()).strip("-")
    return slug[:_MAX_RESOURCE_KEY_LENGTH].strip("-")


def _parse_marketing_opt_in(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes"}
    if isinstance(value, (int, float)):
        return bool(value)
    return False


def _normalize_locale(value: Any) -> str:
    if not isinstance(value, str):
        return "en"
    s = value.strip()
    return s if s in {"en", "zh-CN", "zh-HK"} else "en"


def _validate_optional_resource_key(value: Any) -> str | None:
    normalized_value = validate_string_length(
        value,
        field_name="resource_key",
        max_length=200,
        required=False,
    )
    if normalized_value is None:
        return None

    resource_key = _slugify_resource_key(normalized_value)
    if not resource_key:
        raise ValidationError("resource_key is invalid", field="resource_key")
    return resource_key
