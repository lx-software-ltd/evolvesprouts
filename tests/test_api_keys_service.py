from __future__ import annotations

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


def test_looks_like_api_key_rejects_website_api_keys() -> None:
    assert looks_like_api_key("not-a-token") is False
    assert looks_like_api_key("esk_short") is False
