from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.auth import api_token_authorizer as ata
from app.services.api_keys import generate_api_key


class _FakeRepo:
    def __init__(self, api_key: Any | None) -> None:
        self.api_key = api_key
        self.touched = False

    def find_active_by_hash(self, _key_hash: str) -> Any | None:
        return self.api_key

    def touch_last_used(self, api_key: Any) -> Any:
        self.touched = True
        api_key.last_used_at = datetime.now(UTC)
        return api_key


class _FakeSessionCM:
    def __enter__(self) -> "_FakeSessionCM":
        return self

    def __exit__(self, *_a: object) -> bool:
        return False

    def commit(self) -> None:
        return None

    def rollback(self) -> None:
        return None


def test_authorize_api_token_denies_missing_header() -> None:
    policy = ata.authorize_api_token({"headers": {}, "methodArn": "arn:example"})
    assert policy["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert policy["context"]["reason"] == "missing_key"


def test_authorize_api_token_denies_malformed_token() -> None:
    policy = ata.authorize_api_token(
        {
            "headers": {"x-api-token": "not-a-token"},
            "methodArn": "arn:example",
        }
    )
    assert policy["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert policy["context"]["reason"] == "invalid_key"


def test_authorize_api_token_allows_active_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    generated = generate_api_key()
    key_id = uuid4()
    api_key = SimpleNamespace(
        id=key_id,
        scope="user",
        last_used_at=None,
    )
    repo = _FakeRepo(api_key)
    monkeypatch.setattr(ata, "ApiKeyRepository", lambda _session: repo)
    monkeypatch.setattr(ata, "Session", lambda _engine: _FakeSessionCM())
    monkeypatch.setattr(ata, "get_engine", lambda: object())

    policy = ata.authorize_api_token(
        {
            "headers": {"x-api-token": generated.plaintext},
            "methodArn": "arn:aws:execute-api:ap-southeast-1:1:api/prod/GET/v1/public/whatsapp",
        }
    )
    assert policy["policyDocument"]["Statement"][0]["Effect"] == "Allow"
    assert policy["context"]["scope"] == "user"
    assert policy["context"]["apiKeyId"] == str(key_id)
    assert policy["context"]["userSub"] == f"api-key:{key_id}"
    assert repo.touched is True


def test_authorize_api_token_skips_recent_last_used(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    generated = generate_api_key()
    api_key = SimpleNamespace(
        id=uuid4(),
        scope="admin",
        last_used_at=datetime.now(UTC) - timedelta(seconds=10),
    )
    repo = _FakeRepo(api_key)
    monkeypatch.setattr(ata, "ApiKeyRepository", lambda _session: repo)
    monkeypatch.setattr(ata, "Session", lambda _engine: _FakeSessionCM())
    monkeypatch.setattr(ata, "get_engine", lambda: object())

    policy = ata.authorize_api_token(
        {
            "headers": {"X-Api-Token": generated.plaintext},
            "methodArn": "arn:example",
        }
    )
    assert policy["policyDocument"]["Statement"][0]["Effect"] == "Allow"
    assert repo.touched is False
