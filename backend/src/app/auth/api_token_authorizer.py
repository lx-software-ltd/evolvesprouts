"""Core logic for the public API-token request authorizer.

Validates the ``x-api-token`` header against hashed keys in the
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
from app.services.api_keys import (
    API_TOKEN_HEADER,
    hash_api_key,
    looks_like_api_key,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)

_LAST_USED_REFRESH_INTERVAL = timedelta(minutes=1)


def authorize_api_token(event: dict[str, Any]) -> dict[str, Any]:
    """Validate the API token and build the authorizer response."""
    headers = event.get("headers") or {}
    method_arn = event.get("methodArn", "")

    plaintext = get_header_case_insensitive(headers, API_TOKEN_HEADER)
    if not plaintext:
        logger.warning("Missing x-api-token header")
        return build_iam_policy(
            "Deny", method_arn, "anonymous", {"reason": "missing_key"}
        )

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
        logger.info(f"API token authorized: {key_id[:8]}*** (scope={api_key.scope})")
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
