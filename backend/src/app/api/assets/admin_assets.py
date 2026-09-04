"""Admin asset API handlers."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.api.admin_request import (
    extract_identity,
    parse_uuid,
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)
from app.api.assets.admin_assets_content_replace import (
    complete_asset_content_replace,
    init_asset_content_replace,
)
from app.api.assets.admin_share_links import (
    ensure_default_share_link_for_public_asset,
    get_or_create_share_link,
    get_share_link,
    revoke_share_link,
    rotate_share_link,
)
from app.api.assets.assets_common import (
    paginate_response,
    parse_admin_asset_list_filters,
    parse_create_asset_payload,
    parse_cursor,
    parse_grant_payload,
    parse_limit,
    parse_partial_update_asset_payload,
    parse_update_asset_payload,
)
from app.api.assets.assets_serializers import (
    asset_links_customer_invoice,
    asset_links_expense_attachment,
    serialize_asset,
    serialize_grant,
)
from app.api.assets.assets_storage import (
    build_s3_key,
    delete_s3_object,
    generate_upload_url,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import Asset, AssetVisibility
from app.db.repositories.asset import AssetRepository
from app.exceptions import NotFoundError, ValidationError
from app.services.asset_expense_tagging import CLIENT_DOCUMENT_TAG_NAME
from app.utils import json_response, method_not_allowed, not_found


def handle_admin_assets_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/assets* routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "admin", "assets"):
        return not_found(event)

    identity = require_admin_identity(event)

    if len(parts) == 2:
        if method == "GET":
            return _list_assets(event)
        if method == "POST":
            return _create_asset(event, identity.user_sub)
        return method_not_allowed(event)

    asset_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return _get_asset(event, asset_id)
        if method == "PUT":
            return _update_asset(event, asset_id, partial=False)
        if method == "PATCH":
            return _update_asset(event, asset_id, partial=True)
        if method == "DELETE":
            return _delete_asset(event, asset_id)
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "grants":
        if method == "GET":
            return _list_grants(event, asset_id)
        if method == "POST":
            return _create_grant(event, asset_id, identity.user_sub)
        return method_not_allowed(event)

    if len(parts) == 5 and parts[3] == "grants" and method == "DELETE":
        grant_id = parse_uuid(parts[4])
        return _delete_grant(event, asset_id, grant_id)

    if len(parts) == 5 and parts[3] == "content":
        if parts[4] == "init" and method == "POST":
            return init_asset_content_replace(
                event,
                asset_id,
                identity_user_sub=identity.user_sub,
                request_id=_request_id(event),
            )
        if parts[4] == "complete" and method == "POST":
            return complete_asset_content_replace(
                event,
                asset_id,
                identity_user_sub=identity.user_sub,
                request_id=_request_id(event),
            )
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "share-link":
        if method == "GET":
            return get_share_link(event, asset_id)
        if method == "POST":
            return get_or_create_share_link(
                event,
                asset_id,
                identity.user_sub,
                request_id=_request_id(event),
            )
        if method == "DELETE":
            return revoke_share_link(
                event,
                asset_id,
                identity.user_sub,
                request_id=_request_id(event),
            )
        return method_not_allowed(event)

    if len(parts) == 5 and parts[3] == "share-link" and parts[4] == "rotate":
        if method == "POST":
            return rotate_share_link(
                event,
                asset_id,
                identity.user_sub,
                request_id=_request_id(event),
            )
        return method_not_allowed(event)

    return not_found(event)


def _list_assets(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event)
    cursor = parse_cursor(event)
    query, visibility, asset_type, tag_name = parse_admin_asset_list_filters(event)

    with Session(get_engine()) as session:
        repository = AssetRepository(session)
        canonical_tag: str | None = None
        if tag_name:
            canonical_tag = repository.resolve_asset_tag_filter_name(
                tag_name,
                asset_type=asset_type,
            )
        linked_tag_names = repository.list_distinct_linked_asset_tag_names(
            asset_type=asset_type,
        )
        assets = repository.list_assets(
            limit=limit + 1,
            cursor=cursor,
            query=query,
            visibility=visibility,
            asset_type=asset_type,
            tag_name=canonical_tag,
            load_tags=True,
        )
        return paginate_response(
            items=assets,
            limit=limit,
            event=event,
            serializer=serialize_asset,
            extra_fields={"linked_tag_names": linked_tag_names},
        )


def _create_asset(event: Mapping[str, Any], created_by: str) -> dict[str, Any]:
    payload = parse_create_asset_payload(event)
    request_id = _request_id(event)

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=created_by, request_id=request_id)
        repository = AssetRepository(session)

        asset_id = uuid4()
        s3_key = build_s3_key(asset_id, payload["file_name"])

        asset = repository.create_asset(
            asset_id=asset_id,
            title=payload["title"],
            description=payload["description"],
            asset_type=payload["asset_type"],
            s3_key=s3_key,
            file_name=payload["file_name"],
            resource_key=payload["resource_key"],
            content_type=payload["content_type"],
            content_language=payload["content_language"],
            visibility=payload["visibility"],
            created_by=created_by,
        )
        upload = generate_upload_url(
            s3_key=s3_key, content_type=payload["content_type"]
        )
        if payload.get("client_tag") == CLIENT_DOCUMENT_TAG_NAME:
            repository.set_client_document_tag_link(asset_id, link=True)
        ensure_default_share_link_for_public_asset(
            repository,
            asset_id=asset_id,
            visibility=payload["visibility"],
            created_by=created_by,
        )
        session.commit()
        loaded = repository.get_with_asset_tags(asset_id) or asset
        return json_response(
            201,
            {"asset": serialize_asset(loaded), **upload},
            event=event,
        )


def _get_asset(event: Mapping[str, Any], asset_id: UUID) -> dict[str, Any]:
    with Session(get_engine()) as session:
        repository = AssetRepository(session)
        asset = repository.get_with_asset_tags(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))
        return json_response(200, {"asset": serialize_asset(asset)}, event=event)


def _update_asset(
    event: Mapping[str, Any],
    asset_id: UUID,
    *,
    partial: bool,
) -> dict[str, Any]:
    payload = (
        parse_partial_update_asset_payload(event)
        if partial
        else parse_update_asset_payload(event)
    )
    identity = extract_identity(event)
    request_id = _request_id(event)

    with Session(get_engine()) as session:
        set_audit_context(
            session, user_id=identity.user_sub or "", request_id=request_id
        )
        repository = AssetRepository(session)
        asset = repository.get_with_asset_tags(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))
        _reject_restricted_system_asset_mutation(
            asset,
            visibility=payload.get("visibility"),
            client_tag_specified=bool(payload.get("client_tag_specified")),
        )

        updated = repository.update_asset(
            asset,
            title=payload.get("title"),
            description=payload.get("description"),
            asset_type=payload.get("asset_type"),
            file_name=payload.get("file_name"),
            resource_key=payload.get("resource_key"),
            update_resource_key=(not partial) or ("resource_key" in payload),
            content_type=payload.get("content_type"),
            content_language=payload.get("content_language"),
            update_content_language=(not partial)
            or bool(payload.get("content_language_specified")),
            visibility=payload.get("visibility"),
        )
        if payload.get("client_tag_specified"):
            repository.set_client_document_tag_link(
                asset_id,
                link=payload.get("client_tag") == CLIENT_DOCUMENT_TAG_NAME,
            )
        ensure_default_share_link_for_public_asset(
            repository,
            asset_id=asset_id,
            visibility=updated.visibility,
            created_by=identity.user_sub or "",
        )
        session.commit()
        refreshed = repository.get_with_asset_tags(asset_id)
        return json_response(
            200,
            {"asset": serialize_asset(refreshed or updated)},
            event=event,
        )


def _delete_asset(event: Mapping[str, Any], asset_id: UUID) -> dict[str, Any]:
    identity = extract_identity(event)
    request_id = _request_id(event)

    with Session(get_engine()) as session:
        set_audit_context(
            session, user_id=identity.user_sub or "", request_id=request_id
        )
        repository = AssetRepository(session)
        asset = repository.get_with_asset_tags(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))
        if asset_links_expense_attachment(asset):
            raise ValidationError(
                "Cannot delete assets linked to expenses",
                field="asset",
            )
        if asset_links_customer_invoice(asset):
            raise ValidationError(
                "Cannot delete assets linked to customer invoices",
                field="asset",
            )

        delete_s3_object(s3_key=asset.s3_key)
        repository.delete(asset)
        session.commit()
        return json_response(204, {}, event=event)


def _list_grants(event: Mapping[str, Any], asset_id: UUID) -> dict[str, Any]:
    with Session(get_engine()) as session:
        repository = AssetRepository(session)
        asset = repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))
        grants = repository.list_grants(asset_id=asset_id)
        return json_response(
            200,
            {"items": [serialize_grant(grant) for grant in grants]},
            event=event,
        )


def _create_grant(
    event: Mapping[str, Any],
    asset_id: UUID,
    granted_by: str,
) -> dict[str, Any]:
    payload = parse_grant_payload(event)
    request_id = _request_id(event)

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=granted_by, request_id=request_id)
        repository = AssetRepository(session)
        asset = repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))

        existing = repository.find_matching_grant(
            asset_id=asset_id,
            grant_type=payload["grant_type"],
            grantee_id=payload["grantee_id"],
        )
        if existing:
            raise ValidationError("Grant already exists", field="grant_type")

        grant = repository.create_grant(
            asset_id=asset_id,
            grant_type=payload["grant_type"],
            grantee_id=payload["grantee_id"],
            granted_by=granted_by,
        )
        session.commit()
        return json_response(201, {"grant": serialize_grant(grant)}, event=event)


def _delete_grant(
    event: Mapping[str, Any],
    asset_id: UUID,
    grant_id: UUID,
) -> dict[str, Any]:
    identity = extract_identity(event)
    request_id = _request_id(event)

    with Session(get_engine()) as session:
        set_audit_context(
            session, user_id=identity.user_sub or "", request_id=request_id
        )
        repository = AssetRepository(session)
        grant = repository.get_grant(asset_id=asset_id, grant_id=grant_id)
        if grant is None:
            raise NotFoundError("Grant", str(grant_id))

        repository.delete_grant(grant)
        session.commit()
        return json_response(204, {}, event=event)


def _reject_restricted_system_asset_mutation(
    asset: Asset,
    *,
    visibility: AssetVisibility | None,
    client_tag_specified: bool,
) -> None:
    expense_linked = asset_links_expense_attachment(asset)
    invoice_linked = asset_links_customer_invoice(asset)
    if not (expense_linked or invoice_linked):
        return
    if visibility is not None and visibility != AssetVisibility.RESTRICTED:
        raise ValidationError(
            "visibility must remain restricted for expense- and invoice-linked assets",
            field="visibility",
        )
    if client_tag_specified:
        if expense_linked:
            raise ValidationError(
                "client_tag cannot be changed for assets linked to an expense",
                field="client_tag",
            )
        raise ValidationError(
            "client_tag cannot be changed for assets linked to a customer invoice",
            field="client_tag",
        )


def _request_id(event: Mapping[str, Any]) -> str | None:
    request_context = event.get("requestContext")
    if not isinstance(request_context, Mapping):
        return None
    request_id = request_context.get("requestId")
    if isinstance(request_id, str):
        return request_id
    return None
