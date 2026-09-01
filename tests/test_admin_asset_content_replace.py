"""Tests for admin asset file replacement (init/complete)."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from botocore.exceptions import ClientError

from app.api.assets import admin_assets_content_replace as content_replace
from app.db.models import Asset, AssetType, AssetVisibility
from app.exceptions import ValidationError


def _make_asset(
    *,
    asset_id: UUID,
    s3_key: str = "assets/old/key.pdf",
) -> Asset:
    return Asset(
        id=asset_id,
        title="T",
        description=None,
        asset_type=AssetType.DOCUMENT,
        s3_key=s3_key,
        file_name="old.pdf",
        resource_key=None,
        content_type="application/pdf",
        content_language=None,
        visibility=AssetVisibility.RESTRICTED,
        created_by="u",
    )


def _good_head(*, content_length: int = 12) -> dict[str, Any]:
    return {
        "ContentType": "application/pdf",
        "ContentLength": content_length,
    }


def test_complete_rejects_file_name_mismatch(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    pending = f"assets/{asset_id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-guide.pdf"
    monkeypatch.setattr(content_replace, "head_s3_object", lambda **_k: _good_head())

    with pytest.raises(ValidationError, match="file_name"):
        content_replace.complete_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {
                        "pending_s3_key": pending,
                        "file_name": "wrong.pdf",
                        "content_type": "application/pdf",
                    }
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )


def test_complete_raises_when_head_no_such_key(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    pending = f"assets/{asset_id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-missing.pdf"

    def _head_fail(**_kwargs: Any) -> dict[str, Any]:
        raise ClientError(
            {
                "Error": {"Code": "NoSuchKey"},
                "ResponseMetadata": {"HTTPStatusCode": 404},
            },
            "HeadObject",
        )

    monkeypatch.setattr(content_replace, "head_s3_object", _head_fail)

    with pytest.raises(ValidationError, match="not found"):
        content_replace.complete_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {
                        "pending_s3_key": pending,
                        "file_name": "missing.pdf",
                        "content_type": None,
                    }
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )


def test_complete_blocks_expense_tagged_asset(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    pending = f"assets/{asset_id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-x.pdf"
    monkeypatch.setattr(content_replace, "head_s3_object", lambda **_k: _good_head())
    monkeypatch.setattr(
        content_replace, "asset_links_restricted_system_document", lambda _a: True
    )

    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> Asset:
            return _make_asset(asset_id=asset_id)

    class _Sess:
        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(content_replace, "Session", lambda _e: _Sess())
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: _Repo())

    with pytest.raises(ValidationError, match="expense"):
        content_replace.complete_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {
                        "pending_s3_key": pending,
                        "file_name": "x.pdf",
                        "content_type": None,
                    }
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )


def test_init_returns_404_when_asset_missing(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    from app.exceptions import NotFoundError

    asset_id = uuid4()

    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> None:
            return None

    class _Sess:
        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(content_replace, "Session", lambda _e: _Sess())
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: _Repo())

    with pytest.raises(NotFoundError):
        content_replace.init_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {"file_name": "a.pdf", "content_type": "application/pdf"}
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )


def test_init_blocks_invoice_linked_asset(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()

    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> Asset:
            return _make_asset(asset_id=asset_id)

    class _Sess:
        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(content_replace, "Session", lambda _e: _Sess())
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: _Repo())
    monkeypatch.setattr(
        content_replace, "asset_links_restricted_system_document", lambda _a: True
    )

    with pytest.raises(ValidationError, match="invoice"):
        content_replace.init_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {"file_name": "a.pdf", "content_type": "application/pdf"}
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )


def test_init_blocks_expense_linked_asset(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()

    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> Asset:
            return _make_asset(asset_id=asset_id)

    class _Sess:
        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(content_replace, "Session", lambda _e: _Sess())
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: _Repo())
    monkeypatch.setattr(
        content_replace, "asset_links_restricted_system_document", lambda _a: True
    )

    with pytest.raises(ValidationError, match="expense"):
        content_replace.init_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps({"file_name": "a.pdf"}),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )


def test_complete_rejects_oversized_object(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    pending = f"assets/{asset_id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-huge.pdf"
    monkeypatch.setattr(
        content_replace,
        "head_s3_object",
        lambda **_k: _good_head(content_length=99_000_000),
    )

    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> Asset:
            return _make_asset(asset_id=asset_id)

    class _Sess:
        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(content_replace, "Session", lambda _e: _Sess())
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: _Repo())
    monkeypatch.setattr(
        content_replace, "asset_links_restricted_system_document", lambda _a: False
    )

    with pytest.raises(ValidationError, match="between 1 and"):
        content_replace.complete_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {
                        "pending_s3_key": pending,
                        "file_name": "huge.pdf",
                        "content_type": "application/pdf",
                    }
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )


def test_complete_rejects_non_pdf_head_content_type(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    pending = f"assets/{asset_id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-bad.pdf"
    monkeypatch.setattr(
        content_replace,
        "head_s3_object",
        lambda **_k: {
            "ContentType": "application/octet-stream",
            "ContentLength": 100,
        },
    )

    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> Asset:
            return _make_asset(asset_id=asset_id)

    class _Sess:
        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(content_replace, "Session", lambda _e: _Sess())
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: _Repo())
    monkeypatch.setattr(
        content_replace, "asset_links_restricted_system_document", lambda _a: False
    )

    with pytest.raises(ValidationError, match="Content-Type"):
        content_replace.complete_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {
                        "pending_s3_key": pending,
                        "file_name": "bad.pdf",
                        "content_type": None,
                    }
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )


def test_complete_success_updates_and_deletes_previous(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    old_key = f"assets/{asset_id}/old-segment.pdf"
    pending = f"assets/{asset_id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-newdoc.pdf"
    asset = _make_asset(asset_id=asset_id, s3_key=old_key)

    monkeypatch.setattr(content_replace, "head_s3_object", lambda **_k: _good_head())

    deleted: list[str] = []

    def _delete_s3(*, s3_key: str) -> None:
        deleted.append(s3_key)

    monkeypatch.setattr(content_replace, "delete_s3_object", _delete_s3)

    class _Repo:
        def __init__(self) -> None:
            self.updated = False

        def get_with_asset_tags(self, _id: UUID) -> Asset:
            return asset

        def update_asset(self, a: Asset, **kwargs: Any) -> Asset:
            self.updated = True
            a.s3_key = kwargs["s3_key"]
            a.file_name = kwargs["file_name"]
            a.content_type = kwargs["content_type"]
            return a

    repo = _Repo()

    class _Sess:
        committed = False

        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def commit(self) -> None:
            self.committed = True

        def flush(self) -> None:
            return None

        def rollback(self) -> None:
            return None

    sess = _Sess()
    monkeypatch.setattr(content_replace, "Session", lambda _e: sess)
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: repo)
    monkeypatch.setattr(
        content_replace, "asset_links_restricted_system_document", lambda _a: False
    )

    resp = content_replace.complete_asset_content_replace(
        api_gateway_event(
            method="POST",
            path="/x",
            body=json.dumps(
                {
                    "pending_s3_key": pending,
                    "file_name": "newdoc.pdf",
                    "content_type": None,
                }
            ),
        ),
        asset_id,
        identity_user_sub="u",
        request_id=None,
    )
    assert resp["statusCode"] == 200
    assert repo.updated is True
    assert sess.committed is True
    assert deleted == [old_key]
    body = json.loads(resp["body"])
    assert body["asset"]["s3_key"] == pending
    assert body["asset"]["file_name"] == "newdoc.pdf"
    assert body["asset"]["content_type"] == "application/pdf"


def test_complete_does_not_delete_when_update_raises(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    old_key = f"assets/{asset_id}/old.pdf"
    pending = f"assets/{asset_id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-new.pdf"
    asset = _make_asset(asset_id=asset_id, s3_key=old_key)

    monkeypatch.setattr(content_replace, "head_s3_object", lambda **_k: _good_head())
    deleted: list[str] = []
    monkeypatch.setattr(
        content_replace, "delete_s3_object", lambda *, s3_key: deleted.append(s3_key)
    )

    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> Asset:
            return asset

        def update_asset(self, a: Asset, **kwargs: Any) -> Asset:
            raise RuntimeError("simulated db failure")

    class _Sess:
        rolled_back = False

        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def commit(self) -> None:
            return None

        def flush(self) -> None:
            return None

        def rollback(self) -> None:
            self.rolled_back = True

    sess = _Sess()
    monkeypatch.setattr(content_replace, "Session", lambda _e: sess)
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: _Repo())
    monkeypatch.setattr(
        content_replace, "asset_links_restricted_system_document", lambda _a: False
    )

    with pytest.raises(RuntimeError, match="simulated"):
        content_replace.complete_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {
                        "pending_s3_key": pending,
                        "file_name": "new.pdf",
                        "content_type": "application/pdf",
                    }
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )
    assert deleted == []
    assert sess.rolled_back is True


def test_second_complete_same_pending_after_success_raises(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    pending = f"assets/{asset_id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-doc.pdf"

    monkeypatch.setattr(content_replace, "head_s3_object", lambda **_k: _good_head())
    monkeypatch.setattr(content_replace, "delete_s3_object", lambda **_k: None)

    asset = _make_asset(asset_id=asset_id, s3_key=pending)

    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> Asset:
            return asset

        def update_asset(self, a: Asset, **kwargs: Any) -> Asset:
            return a

    class _Sess:
        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def commit(self) -> None:
            return None

        def flush(self) -> None:
            return None

        def rollback(self) -> None:
            return None

    monkeypatch.setattr(content_replace, "Session", lambda _e: _Sess())
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: _Repo())
    monkeypatch.setattr(
        content_replace, "asset_links_restricted_system_document", lambda _a: False
    )

    with pytest.raises(ValidationError, match="nothing to replace"):
        content_replace.complete_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {
                        "pending_s3_key": pending,
                        "file_name": "doc.pdf",
                        "content_type": "application/pdf",
                    }
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )


def test_delete_previous_logs_warning_on_failure(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    api_gateway_event: Any,
) -> None:
    import logging

    asset_id = uuid4()
    old_key = f"assets/{asset_id}/old.pdf"
    pending = f"assets/{asset_id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-new.pdf"
    asset = _make_asset(asset_id=asset_id, s3_key=old_key)

    monkeypatch.setattr(content_replace, "head_s3_object", lambda **_k: _good_head())

    def _delete_fail(**_kwargs: Any) -> None:
        raise ClientError(
            {
                "Error": {"Code": "AccessDenied"},
                "ResponseMetadata": {"HTTPStatusCode": 403},
            },
            "DeleteObject",
        )

    monkeypatch.setattr(content_replace, "delete_s3_object", _delete_fail)

    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> Asset:
            return asset

        def update_asset(self, a: Asset, **kwargs: Any) -> Asset:
            return a

    class _Sess:
        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def commit(self) -> None:
            return None

        def flush(self) -> None:
            return None

        def rollback(self) -> None:
            return None

    monkeypatch.setattr(content_replace, "Session", lambda _e: _Sess())
    monkeypatch.setattr(content_replace, "get_engine", lambda: object())
    monkeypatch.setattr(content_replace, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(content_replace, "AssetRepository", lambda _s: _Repo())
    monkeypatch.setattr(
        content_replace, "asset_links_restricted_system_document", lambda _a: False
    )

    with caplog.at_level(logging.WARNING):
        resp = content_replace.complete_asset_content_replace(
            api_gateway_event(
                method="POST",
                path="/x",
                body=json.dumps(
                    {
                        "pending_s3_key": pending,
                        "file_name": "new.pdf",
                        "content_type": "application/pdf",
                    }
                ),
            ),
            asset_id,
            identity_user_sub="u",
            request_id=None,
        )
    assert resp["statusCode"] == 200
    assert any("replace_delete_failed" in r.message for r in caplog.records)
