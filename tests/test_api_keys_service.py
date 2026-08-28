from __future__ import annotations

import hashlib

from app.services.api_keys import (
    API_TOKEN_PREFIX,
    generate_api_key,
    hash_api_key,
    looks_like_api_key,
)


def test_generate_api_key_uses_secure_prefix_and_hash() -> None:
    generated = generate_api_key()
    assert generated.plaintext.startswith(API_TOKEN_PREFIX)
    assert generated.prefix == generated.plaintext[:12]
    assert generated.key_hash == hash_api_key(generated.plaintext)
    assert looks_like_api_key(generated.plaintext)


def test_hash_api_key_uses_pbkdf2_not_raw_sha256() -> None:
    sample = "esk_testvaluexx"
    digest = hash_api_key(sample)
    expected = hashlib.pbkdf2_hmac(
        "sha256",
        sample.encode("utf-8"),
        b"evolvesprouts-api-kdf-v1",
        10_000,
    ).hex()
    assert digest == expected
    assert digest != hashlib.sha256(sample.encode("utf-8")).hexdigest()


def test_looks_like_api_key_rejects_website_api_keys() -> None:
    assert looks_like_api_key("not-a-token") is False
    assert looks_like_api_key("esk_short") is False
