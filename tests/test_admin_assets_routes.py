from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.api.assets import admin_assets
from app.api.admin_request import RequestIdentity


def _build_admin_identity(admin_identity: dict[str, str]) -> RequestIdentity:
    return RequestIdentity(
        user_sub=admin_identity.get("userSub"),
        groups=set(admin_identity.get("groups", "").split(",")),
        organization_ids=set(admin_identity.get("organizationIds", "").split(",")),
    )


def test_handle_admin_assets_dispatches_list_route(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(
        admin_assets,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    monkeypatch.setattr(admin_assets, "_list_assets", lambda _: marker)

    response = admin_assets.handle_admin_assets_request(
        api_gateway_event(method="GET", path="/v1/admin/assets"),
        "GET",
        "/v1/admin/assets",
    )
    assert response is marker


def test_handle_admin_assets_returns_405_for_unsupported_collection_method(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    monkeypatch.setattr(
        admin_assets,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )

    response = admin_assets.handle_admin_assets_request(
        api_gateway_event(method="PATCH", path="/v1/admin/assets"),
        "PATCH",
        "/v1/admin/assets",
    )
    assert response["statusCode"] == 405


def test_handle_admin_assets_returns_404_for_non_admin_path(
    api_gateway_event: Any,
) -> None:
    response = admin_assets.handle_admin_assets_request(
        api_gateway_event(method="GET", path="/v1/unknown/assets"),
        "GET",
        "/v1/unknown/assets",
    )
    assert response["statusCode"] == 404


def test_handle_admin_assets_dispatches_patch_update_route(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        admin_assets,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )

    def _fake_update(_event: Any, _asset_id: Any, *, partial: bool) -> dict[str, Any]:
        captured["partial"] = partial
        return marker

    monkeypatch.setattr(admin_assets, "_update_asset", _fake_update)
    asset_id = str(uuid4())

    response = admin_assets.handle_admin_assets_request(
        api_gateway_event(method="PATCH", path=f"/v1/admin/assets/{asset_id}"),
        "PATCH",
        f"/v1/admin/assets/{asset_id}",
    )
    assert response is marker
    assert captured["partial"] is True


def test_handle_admin_assets_dispatches_content_init_route(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(
        admin_assets,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    monkeypatch.setattr(
        admin_assets, "init_asset_content_replace", lambda *_a, **_k: marker
    )
    asset_id = str(uuid4())

    response = admin_assets.handle_admin_assets_request(
        api_gateway_event(
            method="POST", path=f"/v1/admin/assets/{asset_id}/content/init"
        ),
        "POST",
        f"/v1/admin/assets/{asset_id}/content/init",
    )
    assert response is marker


def test_handle_admin_assets_dispatches_content_complete_route(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(
        admin_assets,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    monkeypatch.setattr(
        admin_assets, "complete_asset_content_replace", lambda *_a, **_k: marker
    )
    asset_id = str(uuid4())

    response = admin_assets.handle_admin_assets_request(
        api_gateway_event(
            method="POST", path=f"/v1/admin/assets/{asset_id}/content/complete"
        ),
        "POST",
        f"/v1/admin/assets/{asset_id}/content/complete",
    )
    assert response is marker


def test_handle_admin_assets_returns_405_for_content_init_get(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    monkeypatch.setattr(
        admin_assets,
        "extract_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    asset_id = str(uuid4())

    response = admin_assets.handle_admin_assets_request(
        api_gateway_event(
            method="GET", path=f"/v1/admin/assets/{asset_id}/content/init"
        ),
        "GET",
        f"/v1/admin/assets/{asset_id}/content/init",
    )
    assert response["statusCode"] == 405
