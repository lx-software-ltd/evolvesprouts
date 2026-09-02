"""Serializers and tag-link predicates for asset ORM models."""

from __future__ import annotations

from typing import Any

from app.db.models import (
    Asset,
    AssetAccessGrant,
)
from app.services.asset_expense_tagging import (
    EXPENSE_ATTACHMENT_TAG_NAME,
)
from app.services.asset_invoice_tagging import CUSTOMER_INVOICE_TAG_NAME
from sqlalchemy import inspect


def _asset_has_tag_name(asset: Asset, tag_name: str) -> bool:
    needle = tag_name.lower()
    for link in asset.asset_tags:
        tag = link.tag
        if tag is not None and tag.name.lower() == needle:
            return True
    return False


def asset_links_expense_attachment(asset: Asset) -> bool:
    """Return True when the asset carries the expense_attachment tag (relationship loaded)."""
    return _asset_has_tag_name(asset, EXPENSE_ATTACHMENT_TAG_NAME)


def asset_links_customer_invoice(asset: Asset) -> bool:
    """Return True when the asset carries the customer_invoice tag (relationship loaded)."""
    return _asset_has_tag_name(asset, CUSTOMER_INVOICE_TAG_NAME)


def asset_links_restricted_system_document(asset: Asset) -> bool:
    """Return True when expense or customer-invoice system tags are present."""
    return asset_links_expense_attachment(asset) or asset_links_customer_invoice(asset)


def _serialize_asset_tags_if_loaded(asset: Asset) -> list[dict[str, Any]]:
    """Include tags only when the relationship is preloaded (avoids N+1 queries)."""
    state = inspect(asset)
    if state.transient:
        return []
    if "asset_tags" in state.unloaded:
        return []
    rows: list[dict[str, Any]] = []
    for link in asset.asset_tags:
        tag = link.tag
        if tag is None:
            continue
        rows.append(
            {
                "id": str(tag.id),
                "name": tag.name,
                "color": tag.color,
            }
        )
    return sorted(rows, key=lambda item: item["name"].lower())


def serialize_asset(asset: Asset) -> dict[str, Any]:
    """Serialize Asset model to API payload."""
    return {
        "id": str(asset.id),
        "title": asset.title,
        "description": asset.description,
        "asset_type": asset.asset_type.value,
        "s3_key": asset.s3_key,
        "file_name": asset.file_name,
        "resource_key": asset.resource_key,
        "content_type": asset.content_type,
        "content_language": asset.content_language,
        "visibility": asset.visibility.value,
        "created_by": asset.created_by,
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
        "tags": _serialize_asset_tags_if_loaded(asset),
    }


def serialize_public_free_asset(asset: Asset) -> dict[str, Any]:
    """Serialize a public free-website asset for GET /v1/assets/free."""
    return {
        "title": asset.title,
        "description": asset.description,
        "asset_type": asset.asset_type.value,
        "resource_key": asset.resource_key,
        "content_language": asset.content_language,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
    }


def serialize_grant(grant: AssetAccessGrant) -> dict[str, Any]:
    """Serialize AssetAccessGrant model to API payload."""
    return {
        "id": str(grant.id),
        "asset_id": str(grant.asset_id),
        "grant_type": grant.grant_type.value,
        "grantee_id": grant.grantee_id,
        "granted_by": grant.granted_by,
        "created_at": grant.created_at.isoformat() if grant.created_at else None,
    }
