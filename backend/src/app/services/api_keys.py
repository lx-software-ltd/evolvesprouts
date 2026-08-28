"""API token generation and hashing.

Tokens have the form ``esk_<43 urlsafe chars>``. Only a PBKDF2-HMAC-SHA256
digest is persisted; the plaintext is shown once at creation time.
"""

from __future__ import annotations

import hashlib
import secrets
from typing import NamedTuple

# Public protocol constants. These are not credentials.
API_TOKEN_PREFIX = "esk_"  # nosec B105
API_TOKEN_HEADER = "x-api-token"  # nosec B105
DISPLAY_PREFIX_LENGTH = 12
_SECRET_BYTES = 32  # 32 bytes -> 43 urlsafe base64 characters

# Fixed application salt keeps lookup-by-hash deterministic. Tokens are
# 256-bit random values, so a public purpose string is enough.
_KDF_SALT = b"evolvesprouts-api-kdf-v1"
_KDF_ITERATIONS = 10_000

SCOPE_ADMIN = "admin"
SCOPE_USER = "user"
ALLOWED_SCOPES = (SCOPE_ADMIN, SCOPE_USER)


class GeneratedApiKey(NamedTuple):
    """A freshly generated API token and its stored representations."""

    plaintext: str
    prefix: str
    key_hash: str


def hash_api_key(plaintext: str) -> str:
    """Return a deterministic PBKDF2-HMAC-SHA256 hex digest of a token."""
    return hashlib.pbkdf2_hmac(
        "sha256",
        plaintext.encode("utf-8"),
        _KDF_SALT,
        _KDF_ITERATIONS,
    ).hex()


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
