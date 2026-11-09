"""JWT validation utilities for Cognito tokens.

This module provides secure JWT validation with proper signature verification
using Cognito's JWKS endpoint.

SECURITY NOTES:
- Always verify JWT signatures before trusting claims
- Validate issuer and audience to prevent token confusion attacks
- Check token expiration to prevent replay attacks
"""

from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from typing import Any

import jwt
from jwt import PyJWKClient, PyJWKClientError

from app.utils.logging import get_logger

logger = get_logger(__name__)


def _extract_unverified_claims(token: str) -> dict[str, Any]:
    """Extract claims from a JWT token without verification.

    This function manually decodes the JWT payload to extract claims
    for the purpose of determining the issuer (to fetch the correct JWKS).
    The signature is verified separately afterwards.

    SECURITY NOTE: These claims are NOT trusted until the signature is verified.
    This is only used to extract the issuer URL for JWKS lookup.

    Args:
        token: The JWT token string.

    Returns:
        Dictionary of unverified claims.

    Raises:
        JWTValidationError: If the token format is invalid.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise JWTValidationError(
                "Invalid JWT format: expected 3 parts",
                reason="invalid_token",
            )

        # Decode the payload (second part)
        payload = parts[1]
        # Add padding if needed for base64 decoding
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += "=" * padding

        decoded_bytes = base64.urlsafe_b64decode(payload)
        return json.loads(decoded_bytes.decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise JWTValidationError(
            "Invalid JWT format: could not decode payload",
            reason="invalid_token",
        ) from exc


# Cache for JWKS client to avoid re-fetching keys
_jwks_clients: dict[str, PyJWKClient] = {}
_jwks_client_lock_time: dict[str, float] = {}
JWKS_CACHE_TTL = 3600  # 1 hour

# Cognito token_use claim values, not passwords.
_COGNITO_TOKEN_USE_ID = "id"  # nosec B105
_COGNITO_TOKEN_USE_ACCESS = "access"  # nosec B105


@dataclass
class TokenClaims:
    """Validated JWT token claims."""

    sub: str
    email: str
    groups: list[str]
    exp: int
    iss: str
    token_use: str
    raw_claims: dict[str, Any]


class JWTValidationError(Exception):
    """Raised when JWT validation fails."""

    def __init__(self, message: str, reason: str = "invalid_token"):
        super().__init__(message)
        self.message = message
        self.reason = reason


def _get_region() -> str:
    """Get AWS region from environment."""
    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION")
    if not region:
        raise JWTValidationError(
            "AWS_REGION environment variable not set",
            reason="misconfigured",
        )
    return region


def _get_user_pool_id() -> str:
    """Get Cognito User Pool ID from environment."""
    user_pool_id = os.getenv("COGNITO_USER_POOL_ID")
    if not user_pool_id:
        # Try to extract from method ARN or fall back to parsing issuer
        raise JWTValidationError(
            "COGNITO_USER_POOL_ID environment variable not set",
            reason="misconfigured",
        )
    return user_pool_id


def _get_allowed_client_ids() -> frozenset[str]:
    """Parse comma-separated Cognito app client IDs; fail closed when unset."""
    raw = os.getenv("COGNITO_ALLOWED_CLIENT_IDS", "").strip()
    if not raw:
        logger.error("COGNITO_ALLOWED_CLIENT_IDS is not configured or empty")
        raise JWTValidationError(
            "COGNITO_ALLOWED_CLIENT_IDS is not configured",
            reason="misconfigured",
        )
    client_ids = frozenset(part.strip() for part in raw.split(",") if part.strip())
    if not client_ids:
        logger.error("COGNITO_ALLOWED_CLIENT_IDS parsed to an empty allowlist")
        raise JWTValidationError(
            "COGNITO_ALLOWED_CLIENT_IDS is not configured",
            reason="misconfigured",
        )
    return client_ids


def _verify_token_client_claim(decoded: dict[str, Any], token_use: str) -> None:
    """Ensure ID token ``aud`` or access token ``client_id`` is allowlisted."""
    allowed = _get_allowed_client_ids()
    if token_use == _COGNITO_TOKEN_USE_ID:
        claim_name = "aud"
        claim_value = decoded.get("aud")
    else:
        claim_name = "client_id"
        claim_value = decoded.get("client_id")

    if claim_value is None or str(claim_value).strip() == "":
        raise JWTValidationError(
            f"Missing required claim: {claim_name}",
            reason="invalid_token",
        )
    if str(claim_value) not in allowed:
        raise JWTValidationError(
            f"Token {claim_name} is not an allowed client",
            reason="invalid_audience",
        )


def _get_jwks_client(user_pool_id: str, region: str) -> PyJWKClient:
    """Get or create a cached JWKS client for the Cognito User Pool."""
    cache_key = f"{region}:{user_pool_id}"
    now = time.time()

    # Check if we have a valid cached client
    if cache_key in _jwks_clients:
        cache_time = _jwks_client_lock_time.get(cache_key, 0)
        if (now - cache_time) < JWKS_CACHE_TTL:
            return _jwks_clients[cache_key]

    # Create new client with caching enabled
    jwks_url = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"

    client = PyJWKClient(
        jwks_url,
        cache_keys=True,
        lifespan=JWKS_CACHE_TTL,
    )

    _jwks_clients[cache_key] = client
    _jwks_client_lock_time[cache_key] = now

    return client


def _extract_user_pool_from_issuer(issuer: str) -> tuple[str, str]:
    """Extract region and user pool ID from Cognito issuer URL.

    Args:
        issuer: The issuer claim from the JWT (e.g., https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxx)

    Returns:
        Tuple of (region, user_pool_id)
    """
    # Format: https://cognito-idp.{region}.amazonaws.com/{user_pool_id}
    if not issuer.startswith("https://cognito-idp."):
        raise JWTValidationError(
            "Invalid issuer format - not a Cognito issuer",
            reason="invalid_issuer",
        )

    try:
        # Remove protocol
        without_protocol = issuer.replace("https://cognito-idp.", "")
        # Split to get region and rest
        parts = without_protocol.split(".amazonaws.com/")
        if len(parts) != 2:
            raise ValueError("Invalid format")

        region = parts[0]
        user_pool_id = parts[1].rstrip("/")

        return region, user_pool_id
    except Exception as exc:
        raise JWTValidationError(
            f"Could not parse issuer: {issuer}",
            reason="invalid_issuer",
        ) from exc


def decode_and_verify_token(
    token: str,
    user_pool_id: str | None = None,
    region: str | None = None,
    verify_expiration: bool = True,
) -> TokenClaims:
    """Decode and verify a Cognito JWT token.

    This function:
    1. Decodes the JWT header to get the key ID
    2. Fetches the signing key from Cognito's JWKS endpoint
    3. Verifies the signature using RS256
    4. Validates the issuer matches the expected Cognito user pool
    5. Checks token expiration

    Args:
        token: The JWT token string
        user_pool_id: Optional Cognito User Pool ID (reads from env if not provided)
        region: Optional AWS region (reads from env if not provided)
        verify_expiration: Whether to verify token expiration (default True)

    Returns:
        TokenClaims with validated claims

    Raises:
        JWTValidationError: If token validation fails
    """
    # Extract unverified claims to get the issuer for JWKS lookup
    # SECURITY: These claims are NOT trusted - we verify the signature below
    unverified_claims = _extract_unverified_claims(token)

    # Extract issuer to get user pool info if not provided
    issuer = unverified_claims.get("iss", "")
    if not user_pool_id or not region:
        try:
            extracted_region, extracted_pool_id = _extract_user_pool_from_issuer(issuer)
            region = region or extracted_region
            user_pool_id = user_pool_id or extracted_pool_id
        except JWTValidationError:
            # Fall back to environment variables
            region = region or _get_region()
            user_pool_id = user_pool_id or _get_user_pool_id()

    # Build expected issuer
    expected_issuer = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"

    # Get JWKS client and signing key
    try:
        jwks_client = _get_jwks_client(user_pool_id, region)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
    except PyJWKClientError as exc:
        logger.warning(f"Failed to get signing key: {exc}")
        raise JWTValidationError(
            "Could not retrieve signing key",
            reason="invalid_token",
        ) from exc
    except Exception as exc:
        logger.warning(f"Unexpected error getting signing key: {exc}")
        raise JWTValidationError(
            "Error retrieving signing key",
            reason="invalid_token",
        ) from exc

    # Verify and decode the token
    try:
        decoded = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=expected_issuer,
            options={
                "verify_signature": True,
                "verify_exp": verify_expiration,
                "verify_iss": True,
                # Audience/client_id is verified post-decode because access tokens
                # use client_id while ID tokens use aud.
                "verify_aud": False,
                "require": ["sub", "iss", "exp", "token_use"],
            },
        )
    except jwt.ExpiredSignatureError as exc:
        raise JWTValidationError(
            "Token has expired",
            reason="token_expired",
        ) from exc
    except jwt.InvalidIssuerError as exc:
        raise JWTValidationError(
            "Invalid token issuer",
            reason="invalid_issuer",
        ) from exc
    except jwt.InvalidSignatureError as exc:
        raise JWTValidationError(
            "Invalid token signature",
            reason="invalid_signature",
        ) from exc
    except jwt.DecodeError as exc:
        raise JWTValidationError(
            "Failed to decode token",
            reason="invalid_token",
        ) from exc
    except jwt.MissingRequiredClaimError as exc:
        raise JWTValidationError(
            f"Missing required claim: {exc}",
            reason="invalid_token",
        ) from exc
    except Exception as exc:
        logger.warning(f"Unexpected error during token verification: {exc}")
        raise JWTValidationError(
            "Token verification failed",
            reason="invalid_token",
        ) from exc

    # Validate token_use claim
    token_use = decoded.get("token_use", "")
    if token_use not in (_COGNITO_TOKEN_USE_ID, _COGNITO_TOKEN_USE_ACCESS):
        raise JWTValidationError(
            f"Invalid token_use: {token_use}",
            reason="invalid_token",
        )

    _verify_token_client_claim(decoded, token_use)

    # Extract groups (from id token's cognito:groups claim)
    groups_claim = decoded.get("cognito:groups", [])
    if isinstance(groups_claim, str):
        groups = [g.strip() for g in groups_claim.split(",") if g.strip()]
    elif isinstance(groups_claim, list):
        groups = list(groups_claim)
    else:
        groups = []

    return TokenClaims(
        sub=decoded.get("sub", ""),
        email=decoded.get("email", ""),
        groups=groups,
        exp=decoded.get("exp", 0),
        iss=decoded.get("iss", ""),
        token_use=token_use,
        raw_claims=decoded,
    )


def validate_token_for_groups(
    token: str,
    allowed_groups: set[str],
    user_pool_id: str | None = None,
    region: str | None = None,
) -> tuple[TokenClaims, set[str]]:
    """Validate a token and check group membership.

    Args:
        token: The JWT token string
        allowed_groups: Set of group names that are allowed access
        user_pool_id: Optional Cognito User Pool ID
        region: Optional AWS region

    Returns:
        Tuple of (TokenClaims, matching_groups)

    Raises:
        JWTValidationError: If token validation fails or user not in any allowed group
    """
    claims = decode_and_verify_token(token, user_pool_id, region)

    user_groups = set(claims.groups)
    matching_groups = user_groups & allowed_groups

    if not matching_groups:
        raise JWTValidationError(
            "User not in any allowed group",
            reason="insufficient_permissions",
        )

    return claims, matching_groups
