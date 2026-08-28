"""API token generation and hashing.

Tokens have the form ``esk_<43 urlsafe chars>``. Only the SHA-256 hash is
persisted; the plaintext is shown once at creation time.
"""

from __future__ import annotations

import hashlib
import secrets
from typing import NamedTuple

API_TOKEN_PREFIX = "esk_"
API_TOKEN_HEADER = "x-api-token"
DISPLAY_PREFIX_LENGTH = 12
_SECRET_BYTES = 32  # 32 bytes -> 43 urlsafe base64 characters

SCOPE_ADMIN = "admin"
SCOPE_USER = "user"
ALLOWED_SCOPES = (SCOPE_ADMIN, SCOPE_USER)


class GeneratedApiKey(NamedTuple):
    """A freshly generated API token and its stored representations."""

    plaintext: str
    prefix: str
    key_hash: str


def hash_api_key(plaintext: str) -> str:
    """Return the SHA-256 hex digest of a plaintext API token."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def generate_api_key() -> GeneratedApiKey:
    """Generate a new API token using a cryptographically secure source."""
    plaintext = API_TOKEN_PREFIX + secrets.token_urlsafe(_SECRET_BYTES)
    return GeneratedApiKey(
        plaintext=plaintext,
        prefix=plaintext[:DISPLAY_PREFIX_LENGTH],
        key_hash=hash_api_key(plaintext),
    )


def looks_like_api_key(value: str) -> bool:
    """Cheap format check before hitting the database."""
    return (
        value.startswith(API_TOKEN_PREFIX)
        and DISPLAY_PREFIX_LENGTH <= len(value) <= 128
    )
