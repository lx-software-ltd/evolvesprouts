"""API Gateway request authorizer for hashed API tokens.

This Lambda validates the ``x-api-token`` header against hashed keys
stored in the ``api_keys`` table (read via RDS Proxy with IAM auth) and
passes the token identity (id, scope) to the backend handlers.

Unlike the JWT authorizers, this function runs INSIDE the VPC because it
needs database access instead of public JWKS endpoints.
"""

from __future__ import annotations

from typing import Any

from app.auth.api_token_authorizer import authorize_api_token
from app.auth.authorizer_utils import build_iam_policy
from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Authorize requests based on a hashed API token."""
    try:
        return authorize_api_token(event)
    except Exception as exc:
        # SECURITY: fail closed and don't expose internal error details
        logger.exception(f"API token authorization failed: {type(exc).__name__}")
        return build_iam_policy(
            "Deny",
            event.get("methodArn", ""),
            "error",
            {"reason": "authorization_error"},
        )
