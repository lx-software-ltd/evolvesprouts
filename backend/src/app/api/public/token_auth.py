"""Authorization helpers for hashed API-token routes.

The API-token Lambda authorizer validates the ``x-api-token`` header
against the ``api_keys`` table and passes identity through authorizer
context:

- ``apiKeyId``: UUID of the validated token
- ``scope``: ``admin`` (full access), ``user`` (GET only), or
  ``contact_merge`` (``POST /v1/public/contacts/merge`` only)
- ``userSub``: ``api-key:<id>`` so audit logging attributes writes to the token
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from collections.abc import Mapping

from app.exceptions import AuthenticationError, AuthorizationError
from app.services.api_keys import (
    ALLOWED_SCOPES,
    SCOPE_ADMIN,
    SCOPE_CONTACT_MERGE,
    SCOPE_USER,
)


@dataclass(frozen=True)
class ApiTokenContext:
    """Identity of a validated API token."""

    api_key_id: str
    scope: str


def get_api_token_context(event: Mapping[str, Any]) -> ApiTokenContext | None:
    """Extract the API-token context set by the authorizer."""
    authorizer = event.get("requestContext", {}).get("authorizer", {}) or {}
    if not isinstance(authorizer, Mapping):
        return None
    api_key_id = authorizer.get("apiKeyId")
    scope = authorizer.get("scope")
    if not api_key_id or scope not in ALLOWED_SCOPES:
        return None
    return ApiTokenContext(api_key_id=str(api_key_id), scope=str(scope))


def require_api_token(event: Mapping[str, Any], method: str) -> ApiTokenContext:
    """Require a valid token and enforce scope on ordinary public routes.

    ``user`` may GET only. ``admin`` may call every method. ``contact_merge``
    is rejected here; only ``require_contact_merge_token`` accepts it.
    """
    context = get_api_token_context(event)
    if context is None:
        raise AuthenticationError("API token is required")
    if context.scope == SCOPE_ADMIN:
        return context
    if context.scope == SCOPE_USER and method == "GET":
        return context
    if context.scope == SCOPE_USER:
        raise AuthorizationError("Read-only API token")
    raise AuthorizationError("API token scope cannot call this route")


def require_contact_merge_token(event: Mapping[str, Any]) -> ApiTokenContext:
    """Require the scope that may merge contacts and call nothing else."""
    context = get_api_token_context(event)
    if context is None:
        raise AuthenticationError("API token is required")
    if context.scope != SCOPE_CONTACT_MERGE:
        raise AuthorizationError("Contact merge requires a contact_merge API token")
    return context


def token_actor_sub(token: ApiTokenContext) -> str:
    """Audit actor id for writes performed by a hashed API token."""
    return f"api-key:{token.api_key_id}"
