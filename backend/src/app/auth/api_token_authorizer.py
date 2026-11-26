"""Core logic for the public API-token request authorizer.

Validates ``Authorization: Bearer`` against hashed keys in the
``api_keys`` table and produces an IAM policy plus authorizer context.

SECURITY NOTES:
- Only PBKDF2-HMAC-SHA256 digests are compared; plaintext is never stored/logged.
- Revoked and expired tokens are rejected at lookup time. The API Gateway
  authorizer cache (5 minutes) bounds how long a revoked token keeps working.
- Scope enforcement happens in the handlers (admin vs user), because a
  cached Allow policy applies to every token-protected route.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.auth.authorizer_utils import build_iam_policy, get_header_case_insensitive
from app.db.engine import get_engine
from app.db.repositories.api_key import ApiKeyRepository
from app.services.api_keys import hash_api_key, looks_like_api_key
from app.utils.logging import get_logger

logger = get_logger(__name__)


class Unauthorized(Exception):
    """API Gateway returns HTTP 401 when the authorizer raises this."""

    def __init__(self) -> None:
        super().__init__("Unauthorized")


_LAST_USED_REFRESH_INTERVAL = timedelta(minutes=1)
_MAX_TOKEN_LEN = 256


def _bearer_token(headers: dict[str, Any]) -> str | None:
    """Return the token from ``Authorization: Bearer``, or None."""
    raw = get_header_case_insensitive(headers, "Authorization")
    if not isinstance(raw, str) or not raw:
        return None
    scheme, separator, token = raw.strip().partition(" ")
    if not separator or scheme.lower() != "bearer":
        return None
    key = token.strip()
    if not key or len(key) > _MAX_TOKEN_LEN or " " in key:
        return None
    return key


def authorize_api_token(event: dict[str, Any]) -> dict[str, Any]:
    """Validate the API token and build the authorizer response."""
    headers = event.get("headers") or {}
    method_arn = event.get("methodArn", "")

    plaintext = _bearer_token(headers)
    if not plaintext:
        logger.warning("Missing Authorization bearer token")
        raise Unauthorized()

    if not looks_like_api_key(plaintext):
        logger.warning("Malformed API token")
        return build_iam_policy(
            "Deny", method_arn, "invalid", {"reason": "invalid_key"}
        )

    key_hash = hash_api_key(plaintext)

    with Session(get_engine()) as session:
        repo = ApiKeyRepository(session)
        api_key = repo.find_active_by_hash(key_hash)
        if api_key is None:
            logger.warning("Unknown, revoked, or expired API token")
            return build_iam_policy(
                "Deny", method_arn, "invalid", {"reason": "invalid_key"}
            )

        _touch_last_used(session, repo, api_key)

        key_id = str(api_key.id)
        logger.info(
            "API token authorized "
            f"auth_scheme=bearer: {key_id[:8]}*** (scope={api_key.scope})"
        )
        return build_iam_policy(
            "Allow",
            method_arn,
            f"api-key:{key_id}",
            {
                "apiKeyId": key_id,
                "scope": api_key.scope,
                "userSub": f"api-key:{key_id}",
            },
        )


def _touch_last_used(
    session: Session,
    repo: ApiKeyRepository,
    api_key: Any,
) -> None:
    """Refresh last_used_at, throttled to avoid a write per request."""
    now = datetime.now(timezone.utc)
    last_used = api_key.last_used_at
    if last_used is not None and last_used.tzinfo is None:
        last_used = last_used.replace(tzinfo=timezone.utc)
    if last_used is not None and now - last_used < _LAST_USED_REFRESH_INTERVAL:
        return
    try:
        repo.touch_last_used(api_key)
        session.commit()
    except Exception as exc:  # pragma: no cover - best effort only
        logger.warning(f"Failed to update last_used_at: {type(exc).__name__}")
        session.rollback()
