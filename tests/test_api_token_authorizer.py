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
            "headers": {"Authorization": "Bearer not-a-token"},
            "methodArn": "arn:example",
        }
    )
    assert policy["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert policy["context"]["reason"] == "invalid_key"


def _allow_token(
    monkeypatch: pytest.MonkeyPatch,
    headers: dict[str, str],
) -> tuple[dict[str, Any], _FakeRepo]:
    generated_scope = headers
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
        {"headers": generated_scope, "methodArn": "arn:example"}
    )
    return policy, repo


def test_authorize_api_token_allows_active_key(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
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

    with caplog.at_level("INFO"):
        policy = ata.authorize_api_token(
            {
                "headers": {"Authorization": f"Bearer {generated.plaintext}"},
                "methodArn": "arn:aws:execute-api:ap-southeast-1:1:api/prod/GET/v1/public/whatsapp",
            }
        )
    assert policy["policyDocument"]["Statement"][0]["Effect"] == "Allow"
    assert policy["context"]["scope"] == "user"
    assert policy["context"]["apiKeyId"] == str(key_id)
    assert policy["context"]["userSub"] == f"api-key:{key_id}"
    assert repo.touched is True
    assert "auth_scheme=bearer" in caplog.text


def test_authorize_api_token_accepts_legacy_header(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    generated = generate_api_key()
    with caplog.at_level("INFO"):
        policy, repo = _allow_token(monkeypatch, {"X-Api-Token": generated.plaintext})
    assert policy["policyDocument"]["Statement"][0]["Effect"] == "Allow"
    assert repo.touched is True
    assert "auth_scheme=legacy" in caplog.text


def test_authorize_api_token_prefers_bearer_over_legacy_header(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    bearer = generate_api_key()
    legacy = generate_api_key()
    seen: list[str] = []

    def _hash(value: str) -> str:
        seen.append(value)
        return "hash"

    monkeypatch.setattr(ata, "hash_api_key", _hash)
    with caplog.at_level("INFO"):
        policy, _repo = _allow_token(
            monkeypatch,
            {
                "Authorization": f"Bearer {bearer.plaintext}",
                "x-api-token": legacy.plaintext,
            },
        )
    assert policy["policyDocument"]["Statement"][0]["Effect"] == "Allow"
    assert seen == [bearer.plaintext]
    assert "auth_scheme=bearer" in caplog.text


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
            "headers": {"authorization": f"Bearer {generated.plaintext}"},
            "methodArn": "arn:example",
        }
    )
    assert policy["policyDocument"]["Statement"][0]["Effect"] == "Allow"
    assert repo.touched is False
