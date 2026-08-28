"""Public Meta Messenger/Instagram webhook endpoint handler."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any
from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.db.engine import get_engine
from app.services.meta_ingest import ingest_webhook_payload
from app.utils import json_response
from app.utils.logging import get_logger
from app.utils.responses import get_security_headers

logger = get_logger(__name__)

_VERIFY_TOKEN_ENV_NAME = (  # nosec B105 - env var key, not a secret value
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN"
)
_APP_SECRET_ENV_NAME = "META_APP_SECRET"  # nosec B105 - env var key
_SIGNATURE_HEADER = "x-hub-signature-256"
_SIGNATURE_PREFIX = "sha256="


def handle_meta_webhook(
    event: Mapping[str, Any],
    method: str,
) -> dict[str, Any]:
    """Handle Meta webhook verification and Messenger/Instagram deliveries."""
    if method == "GET":
        return _handle_verification(event)
    if method != "POST":
        return json_response(405, {"error": "Method not allowed"}, event=event)

    app_secret = os.getenv(_APP_SECRET_ENV_NAME, "").strip()
    if not app_secret:
        logger.error("META_APP_SECRET is not configured")
        return json_response(
            500,
            {"error": "Service configuration error. Please contact support."},
            event=event,
        )

    raw_body = _raw_body_bytes(event)
    if not _is_signature_valid(event, raw_body=raw_body, app_secret=app_secret):
        logger.warning("Rejected Meta webhook due to invalid signature")
        return json_response(401, {"error": "Unauthorized"}, event=event)

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.warning("Rejected Meta webhook with non-JSON body")
        return json_response(400, {"error": "Invalid payload"}, event=event)
    if not isinstance(payload, Mapping):
        return json_response(400, {"error": "Invalid payload"}, event=event)

    try:
        with Session(get_engine()) as session:
            counters = ingest_webhook_payload(session, payload)
            session.commit()
    except Exception:
        logger.exception("Meta webhook ingestion failed")
        return json_response(
            500,
            {"error": "Unable to process webhook. Please retry."},
            event=event,
        )

    logger.info("Meta webhook processed", extra=dict(counters))
    return json_response(200, {"message": "ok", **counters}, event=event)


def _handle_verification(event: Mapping[str, Any]) -> dict[str, Any]:
    """Answer Meta's webhook subscription handshake with the raw challenge."""
    expected_token = os.getenv(_VERIFY_TOKEN_ENV_NAME, "").strip()
    if not expected_token:
        logger.error("WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured")
        return json_response(
            500,
            {"error": "Service configuration error. Please contact support."},
            event=event,
        )

    params = event.get("queryStringParameters") or {}
    mode = str(params.get("hub.mode") or "")
    token = str(params.get("hub.verify_token") or "")
    challenge = str(params.get("hub.challenge") or "")
    if (
        mode != "subscribe"
        or not challenge
        or len(token) != len(expected_token)
        or not hmac.compare_digest(token, expected_token)
    ):
        logger.warning("Rejected Meta webhook verification attempt")
        return json_response(403, {"error": "Forbidden"}, event=event)

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/plain; charset=utf-8",
            **get_security_headers(),
        },
        "body": challenge,
    }


def _raw_body_bytes(event: Mapping[str, Any]) -> bytes:
    raw_body = event.get("body")
    if raw_body is None:
        return b""
    if event.get("isBase64Encoded"):
        try:
            return base64.b64decode(raw_body)
        except (ValueError, TypeError):
            return b""
    if isinstance(raw_body, bytes):
        return raw_body
    return str(raw_body).encode("utf-8")


def _is_signature_valid(
    event: Mapping[str, Any],
    *,
    raw_body: bytes,
    app_secret: str,
) -> bool:
    headers = event.get("headers") or {}
    provided = ""
    for name, value in headers.items():
        if isinstance(name, str) and name.lower() == _SIGNATURE_HEADER:
            provided = str(value or "")
            break
    if not provided.startswith(_SIGNATURE_PREFIX):
        return False
    expected = hmac.new(
        app_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    received = provided[len(_SIGNATURE_PREFIX) :]
    if len(received) != len(expected):
        return False
    return hmac.compare_digest(received, expected)
