"""Admin asset file replacement (presigned upload + complete)."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping
from uuid import UUID

from botocore.exceptions import ClientError
from sqlalchemy.orm import Session

from app.api.assets.assets_common import (
    parse_complete_asset_content_replace_payload,
    parse_init_asset_content_replace_payload,
)
from app.api.assets.assets_serializers import (
    asset_links_restricted_system_document,
    serialize_asset,
)
from app.api.assets.assets_storage import (
    admin_asset_replace_content_type,
    build_s3_key,
    delete_s3_object,
    file_name_from_pending_asset_content_key,
    generate_upload_url,
    head_s3_object,
    max_asset_presigned_upload_bytes,
    sanitize_file_name,
    validate_pending_asset_content_s3_key,
)
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.repositories.asset import AssetRepository
from app.exceptions import NotFoundError, ValidationError
from app.utils import get_logger, json_response

logger = get_logger(__name__)


def init_asset_content_replace(
    event: Mapping[str, Any],
    asset_id: UUID,
    *,
    identity_user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    payload = parse_init_asset_content_replace_payload(event)
    bound_ct = admin_asset_replace_content_type()

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=identity_user_sub, request_id=request_id)
        repository = AssetRepository(session)
        asset = repository.get_with_asset_tags(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))
        if asset_links_restricted_system_document(asset):
            raise ValidationError(
                "File replacement is not allowed for expense- or invoice-linked assets",
                field="asset",
            )

        pending_key = build_s3_key(asset_id, payload["file_name"])
        upload = generate_upload_url(s3_key=pending_key, content_type=bound_ct)
        return json_response(
            200,
            {
                "pending_s3_key": pending_key,
                **upload,
            },
            event=event,
        )


def complete_asset_content_replace(
    event: Mapping[str, Any],
    asset_id: UUID,
    *,
    identity_user_sub: str,
    request_id: str | None,
) -> dict[str, Any]:
    payload = parse_complete_asset_content_replace_payload(event)
    validate_pending_asset_content_s3_key(
        asset_id=asset_id, pending_key=payload["pending_s3_key"]
    )
    bound_ct = admin_asset_replace_content_type()
    max_bytes = max_asset_presigned_upload_bytes()

    try:
        head_meta = head_s3_object(s3_key=payload["pending_s3_key"])
    except ClientError as exc:
        error_code = str(exc.response.get("Error", {}).get("Code", ""))
        http_status = int(
            exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
        )
        if http_status == 404 or error_code in {"404", "NoSuchKey", "NotFound"}:
            raise ValidationError(
                "Uploaded object was not found; complete the presigned upload first",
                field="pending_s3_key",
            ) from exc
        logger.exception(
            "S3 head_object failed for asset content replace",
            extra={"asset_id": str(asset_id), "error_code": error_code},
        )
        raise ValidationError(
            "Could not verify the uploaded object",
            field="pending_s3_key",
        ) from exc

    try:
        key_derived_name = file_name_from_pending_asset_content_key(
            payload["pending_s3_key"]
        )
    except ValidationError:
        raise
    client_file_name = sanitize_file_name(payload["file_name"])
    if client_file_name != key_derived_name:
        raise ValidationError(
            "file_name does not match the pending upload key",
            field="file_name",
        )

    raw_ct = payload["content_type"]
    if raw_ct is not None and str(raw_ct).strip() and str(raw_ct).strip() != bound_ct:
        raise ValidationError(
            "content_type must be application/pdf for file replacement",
            field="content_type",
        )

    head_ct = head_meta.get("ContentType")
    if isinstance(head_ct, str) and head_ct.strip() and head_ct.strip() != bound_ct:
        raise ValidationError(
            "Uploaded object Content-Type must be application/pdf",
            field="content_type",
        )

    cl_raw = head_meta.get("ContentLength")
    if cl_raw is None:
        raise ValidationError(
            "Uploaded object size could not be verified",
            field="pending_s3_key",
        )
    try:
        content_length = int(cl_raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError(
            "Uploaded object size could not be verified",
            field="pending_s3_key",
        ) from exc
    if content_length < 1 or content_length > max_bytes:
        raise ValidationError(
            f"Uploaded object must be between 1 and {max_bytes} bytes",
            field="pending_s3_key",
        )

    resolved_content_type = bound_ct

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=identity_user_sub, request_id=request_id)
        repository = AssetRepository(session)
        asset = repository.get_with_asset_tags(asset_id)
        if asset is None:
            raise NotFoundError("Asset", str(asset_id))
        if asset_links_restricted_system_document(asset):
            raise ValidationError(
                "File replacement is not allowed for expense- or invoice-linked assets",
                field="asset",
            )

        previous_key = asset.s3_key
        if previous_key == payload["pending_s3_key"]:
            raise ValidationError(
                "pending_s3_key matches the current object; nothing to replace",
                field="pending_s3_key",
            )

        try:
            repository.update_asset(
                asset,
                s3_key=payload["pending_s3_key"],
                file_name=payload["file_name"],
                content_type=resolved_content_type,
            )
            session.flush()
            refreshed = repository.get_with_asset_tags(asset_id)
            serialized = serialize_asset(refreshed or asset)
            session.commit()
        except Exception:
            session.rollback()
            raise

        if previous_key and previous_key != payload["pending_s3_key"]:
            try:
                delete_s3_object(s3_key=previous_key)
            except ClientError:
                logger.warning(
                    "replace_delete_failed: previous S3 object delete failed after successful replace",
                    extra={
                        "asset_id": str(asset_id),
                        "s3_key": previous_key,
                        "outcome": "replace_delete_failed",
                    },
                )

        return json_response(
            200,
            {"asset": serialized},
            event=event,
        )
