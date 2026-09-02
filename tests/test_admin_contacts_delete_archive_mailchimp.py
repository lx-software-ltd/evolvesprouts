from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.api import admin_contacts_delete as mutations
from app.db.models.enums import MailchimpSyncStatus


def test_delete_contact_triggers_mailchimp_remove(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    monkeypatch.setenv("DEPLOYMENT_STAGE", "production")
    monkeypatch.setenv("MAILCHIMP_LIST_ID", "list1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us12")

    contact_id = uuid4()
    calls: list[str] = []

    class _FakeContact:
        def __init__(self) -> None:
            self.email = "keep@example.com"
            self.mailchimp_status = MailchimpSyncStatus.SYNCED

    class _FakeRepo:
        def get_by_id_for_admin(self, cid: Any) -> Any:
            assert cid == contact_id
            return _FakeContact()

        def delete(self, _c: Any) -> None:
            return None

    class _FakeSession:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            self.repo = _FakeRepo()

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, *_a: Any) -> None:
            return None

        def scalars(self, *_a: Any, **_k: Any) -> Any:
            class _R:
                def all(self) -> list[Any]:
                    return []

            return _R()

        def execute(self, *_a: Any, **_k: Any) -> Any:
            return MagicMock()

        def commit(self) -> None:
            return None

        def rollback(self) -> None:
            return None

    monkeypatch.setattr(mutations, "Session", _FakeSession)
    monkeypatch.setattr(mutations, "get_engine", lambda: object())
    monkeypatch.setattr(mutations, "ContactRepository", lambda s: s.repo)

    def _capture_remove(**kwargs: Any) -> str:
        assert kwargs.get("max_attempts") == 2
        calls.append(kwargs["email"])
        return "removed"

    monkeypatch.setattr(mutations, "remove_contact_from_mailchimp", _capture_remove)
    monkeypatch.setattr(mutations, "set_audit_context", lambda *a, **k: None)

    event = api_gateway_event(
        method="DELETE",
        path=f"/v1/admin/contacts/{contact_id}",
        authorizer_context=admin_identity,
    )
    resp = mutations.delete_contact(
        event, contact_id=contact_id, actor_sub=admin_identity["userSub"]
    )
    assert resp["statusCode"] == 204
    assert calls == ["keep@example.com"]


def test_delete_skips_mailchimp_when_unsubscribed(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    monkeypatch.setenv("DEPLOYMENT_STAGE", "production")
    monkeypatch.setenv("MAILCHIMP_LIST_ID", "list1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us12")

    contact_id = uuid4()
    calls: list[str] = []

    class _FakeContact:
        def __init__(self) -> None:
            self.email = "gone@example.com"
            self.mailchimp_status = MailchimpSyncStatus.UNSUBSCRIBED

    class _FakeRepo:
        def get_by_id_for_admin(self, cid: Any) -> Any:
            return _FakeContact()

        def delete(self, _c: Any) -> None:
            return None

    class _FakeSession:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            self.repo = _FakeRepo()

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, *_a: Any) -> None:
            return None

        def scalars(self, *_a: Any, **_k: Any) -> Any:
            class _R:
                def all(self) -> list[Any]:
                    return []

            return _R()

        def execute(self, *_a: Any, **_k: Any) -> Any:
            return MagicMock()

        def commit(self) -> None:
            return None

        def rollback(self) -> None:
            return None

    monkeypatch.setattr(mutations, "Session", _FakeSession)
    monkeypatch.setattr(mutations, "get_engine", lambda: object())
    monkeypatch.setattr(mutations, "ContactRepository", lambda s: s.repo)

    monkeypatch.setattr(
        mutations,
        "remove_contact_from_mailchimp",
        lambda **kwargs: calls.append("bad") or "removed",
    )
    monkeypatch.setattr(mutations, "set_audit_context", lambda *a, **k: None)

    event = api_gateway_event(
        method="DELETE",
        path=f"/v1/admin/contacts/{contact_id}",
        authorizer_context=admin_identity,
    )
    mutations.delete_contact(
        event, contact_id=contact_id, actor_sub=admin_identity["userSub"]
    )
    assert calls == []


def test_delete_skips_mailchimp_remove_in_staging_without_calling_archive(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    """Per-row Mailchimp removal is production-only; staging must not hit Mailchimp APIs."""
    monkeypatch.setenv("DEPLOYMENT_STAGE", "staging")
    monkeypatch.setenv("MAILCHIMP_LIST_ID", "list1")
    monkeypatch.setenv("MAILCHIMP_SERVER_PREFIX", "us12")

    contact_id = uuid4()

    class _FakeContact:
        def __init__(self) -> None:
            self.email = "staging@example.com"
            self.mailchimp_status = MailchimpSyncStatus.SYNCED

    class _FakeRepo:
        def get_by_id_for_admin(self, cid: Any) -> Any:
            assert cid == contact_id
            return _FakeContact()

        def delete(self, _c: Any) -> None:
            return None

    class _FakeSession:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            self.repo = _FakeRepo()

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, *_a: Any, **_k: Any) -> None:
            return None

        def scalars(self, *_a: Any, **_k: Any) -> Any:
            class _R:
                def all(self) -> list[Any]:
                    return []

            return _R()

        def execute(self, *_a: Any, **_k: Any) -> Any:
            return MagicMock()

        def commit(self) -> None:
            return None

        def rollback(self) -> None:
            return None

    monkeypatch.setattr(mutations, "Session", _FakeSession)
    monkeypatch.setattr(mutations, "get_engine", lambda: object())
    monkeypatch.setattr(mutations, "ContactRepository", lambda s: s.repo)
    monkeypatch.setattr(mutations, "set_audit_context", lambda *a, **k: None)

    monkeypatch.setattr(
        "app.services.mailchimp_sync.archive_subscriber",
        lambda **_k: (_ for _ in ()).throw(
            AssertionError("archive_subscriber must not run in staging")
        ),
    )

    event = api_gateway_event(
        method="DELETE",
        path=f"/v1/admin/contacts/{contact_id}",
        authorizer_context=admin_identity,
    )
    resp = mutations.delete_contact(
        event, contact_id=contact_id, actor_sub=admin_identity["userSub"]
    )
    assert resp["statusCode"] == 204
