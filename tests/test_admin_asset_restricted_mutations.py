from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.api.assets import admin_assets as admin_assets_mod
from app.db.models import Asset, AssetType, AssetVisibility
from app.exceptions import ValidationError


def _make_asset(*, asset_id: UUID) -> Asset:
    return Asset(
        id=asset_id,
        title="T",
        description=None,
        asset_type=AssetType.DOCUMENT,
        s3_key="billing/invoices/x.pdf",
        file_name="x.pdf",
        resource_key=None,
        content_type="application/pdf",
        content_language=None,
        visibility=AssetVisibility.RESTRICTED,
        created_by="u",
    )


def _session_harness(
    monkeypatch: pytest.MonkeyPatch,
    asset: Asset | None,
) -> None:
    class _Repo:
        def get_with_asset_tags(self, _id: UUID) -> Asset | None:
            return asset

        def get_by_id(self, _id: UUID) -> Asset | None:
            return asset

        def update_asset(self, current: Asset, **_kwargs: Any) -> Asset:
            return current

        def delete(self, _asset: Asset) -> None:
            raise AssertionError("delete should not run")

        def set_client_document_tag_link(self, *_a: Any, **_k: Any) -> None:
            raise AssertionError("client_tag should not change")

    class _Sess:
        def __enter__(self) -> _Sess:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def commit(self) -> None:
            return None

    monkeypatch.setattr(admin_assets_mod, "Session", lambda _e: _Sess())
    monkeypatch.setattr(admin_assets_mod, "get_engine", lambda: object())
    monkeypatch.setattr(admin_assets_mod, "set_audit_context", lambda *a, **k: None)
    monkeypatch.setattr(admin_assets_mod, "AssetRepository", lambda _s: _Repo())
    monkeypatch.setattr(
        admin_assets_mod,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )


def test_delete_rejects_expense_linked_asset(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    asset = _make_asset(asset_id=asset_id)
    _session_harness(monkeypatch, asset)
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_expense_attachment", lambda _a: True
    )
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_customer_invoice", lambda _a: False
    )
    deleted: list[str] = []
    monkeypatch.setattr(
        admin_assets_mod, "delete_s3_object", lambda **k: deleted.append(k["s3_key"])
    )

    with pytest.raises(ValidationError, match="expenses"):
        admin_assets_mod._delete_asset(
            api_gateway_event(method="DELETE", path=f"/v1/admin/assets/{asset_id}"),
            asset_id,
        )
    assert deleted == []


def test_delete_rejects_invoice_linked_asset(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    asset = _make_asset(asset_id=asset_id)
    _session_harness(monkeypatch, asset)
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_expense_attachment", lambda _a: False
    )
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_customer_invoice", lambda _a: True
    )
    deleted: list[str] = []
    monkeypatch.setattr(
        admin_assets_mod, "delete_s3_object", lambda **k: deleted.append(k["s3_key"])
    )

    with pytest.raises(ValidationError, match="customer invoices"):
        admin_assets_mod._delete_asset(
            api_gateway_event(method="DELETE", path=f"/v1/admin/assets/{asset_id}"),
            asset_id,
        )
    assert deleted == []


def test_patch_rejects_public_visibility_for_invoice_asset(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    asset = _make_asset(asset_id=asset_id)
    _session_harness(monkeypatch, asset)
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_expense_attachment", lambda _a: False
    )
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_customer_invoice", lambda _a: True
    )

    with pytest.raises(ValidationError, match="visibility"):
        admin_assets_mod._update_asset(
            api_gateway_event(
                method="PATCH",
                path=f"/v1/admin/assets/{asset_id}",
                body=json.dumps({"visibility": "public"}),
            ),
            asset_id,
            partial=True,
        )


def test_patch_rejects_public_visibility_for_expense_asset(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    asset = _make_asset(asset_id=asset_id)
    _session_harness(monkeypatch, asset)
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_expense_attachment", lambda _a: True
    )
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_customer_invoice", lambda _a: False
    )

    with pytest.raises(ValidationError, match="visibility"):
        admin_assets_mod._update_asset(
            api_gateway_event(
                method="PATCH",
                path=f"/v1/admin/assets/{asset_id}",
                body=json.dumps({"visibility": "public"}),
            ),
            asset_id,
            partial=True,
        )


def test_patch_rejects_client_tag_for_invoice_asset(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    asset_id = uuid4()
    asset = _make_asset(asset_id=asset_id)
    _session_harness(monkeypatch, asset)
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_expense_attachment", lambda _a: False
    )
    monkeypatch.setattr(
        admin_assets_mod, "asset_links_customer_invoice", lambda _a: True
    )

    with pytest.raises(ValidationError, match="customer invoice"):
        admin_assets_mod._update_asset(
            api_gateway_event(
                method="PATCH",
                path=f"/v1/admin/assets/{asset_id}",
                body=json.dumps({"client_tag": "client_document"}),
            ),
            asset_id,
            partial=True,
        )
