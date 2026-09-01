"""Admin CRM tags catalog API."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, union_all
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin_entities_helpers import (
    parse_optional_bool_body,
    request_id,
    serialize_tag_ref,
)
from app.api.admin_request import parse_body, parse_uuid, query_param
from app.api.admin_validators import validate_string_length
from app.api.assets.assets_common import extract_identity, split_route_parts
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.models import (
    AssetTag,
    ContactTag,
    FamilyTag,
    OrganizationTag,
    ServiceInstanceTag,
    ServiceTag,
    Tag,
)
from app.exceptions import NotFoundError, ValidationError
from app.services.asset_expense_tagging import (
    CLIENT_DOCUMENT_TAG_NAME,
    EXPENSE_ATTACHMENT_TAG_NAME,
)
from app.services.asset_invoice_tagging import CUSTOMER_INVOICE_TAG_NAME
from app.utils import json_response
from app.utils.logging import get_logger

logger = get_logger(__name__)

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

_SYSTEM_TAG_NAMES_LOWER: frozenset[str] = frozenset(
    {
        EXPENSE_ATTACHMENT_TAG_NAME.lower(),
        CLIENT_DOCUMENT_TAG_NAME.lower(),
        CUSTOMER_INVOICE_TAG_NAME.lower(),
    }
)


def _is_system_tag_name(name: str) -> bool:
    return name.strip().lower() in _SYSTEM_TAG_NAMES_LOWER


def _is_reserved_tag_name(name: str) -> bool:
    """Reserved for asset pipeline behaviour; admins cannot create duplicates."""
    return name.strip().lower() in _SYSTEM_TAG_NAMES_LOWER


def handle_admin_tags_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/tags routes."""
    logger.info(
        "Handling admin tags route",
        extra={"method": method, "path": path},
    )
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "tags":
        return json_response(404, {"error": "Not found"}, event=event)

    identity = extract_identity(event)
    if not identity.user_sub:
        raise ValidationError("Authenticated user is required", field="authorization")

    if len(parts) == 2:
        if method == "GET":
            return _list_tags(event)
        if method == "POST":
            return _create_tag(event, actor_sub=identity.user_sub)
        return json_response(405, {"error": "Method not allowed"}, event=event)

    tag_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return _get_tag(event, tag_id=tag_id)
        if method == "PATCH":
            return _update_tag(event, tag_id=tag_id, actor_sub=identity.user_sub)
        if method == "DELETE":
            return _delete_tag(event, tag_id=tag_id, actor_sub=identity.user_sub)
        return json_response(405, {"error": "Method not allowed"}, event=event)

    return json_response(404, {"error": "Not found"}, event=event)


def _usage_counts_by_tag_id(session: Session, tag_ids: list[UUID]) -> dict[UUID, int]:
    """Single aggregated query per list of tag ids (avoids N×6 counts per row)."""
    if not tag_ids:
        return {}
    # Use mapped ``__table__`` columns so static type checkers accept ``tag_id``
    # (ORM ``.tag_id`` attributes are not always inferred on declarative classes).
    ct = ContactTag.__table__.c
    ft = FamilyTag.__table__.c
    ot = OrganizationTag.__table__.c
    at = AssetTag.__table__.c
    st = ServiceTag.__table__.c
    sit = ServiceInstanceTag.__table__.c
    s_contact = (
        select(ct.tag_id, func.count().label("cnt"))
        .where(ct.tag_id.in_(tag_ids))
        .group_by(ct.tag_id)
    )
    s_family = (
        select(ft.tag_id, func.count().label("cnt"))
        .where(ft.tag_id.in_(tag_ids))
        .group_by(ft.tag_id)
    )
    s_org = (
        select(ot.tag_id, func.count().label("cnt"))
        .where(ot.tag_id.in_(tag_ids))
        .group_by(ot.tag_id)
    )
    s_asset = (
        select(at.tag_id, func.count().label("cnt"))
        .where(at.tag_id.in_(tag_ids))
        .group_by(at.tag_id)
    )
    s_service = (
        select(st.tag_id, func.count().label("cnt"))
        .where(st.tag_id.in_(tag_ids))
        .group_by(st.tag_id)
    )
    s_instance = (
        select(sit.tag_id, func.count().label("cnt"))
        .where(sit.tag_id.in_(tag_ids))
        .group_by(sit.tag_id)
    )
    combined = union_all(
        s_contact, s_family, s_org, s_asset, s_service, s_instance
    ).subquery()
    stmt = select(combined.c.tag_id, func.sum(combined.c.cnt)).group_by(
        combined.c.tag_id
    )
    rows = session.execute(stmt).all()
    return {row[0]: int(row[1] or 0) for row in rows}


def _tag_usage_count(session: Session, tag_id: UUID) -> int:
    return _usage_counts_by_tag_id(session, [tag_id]).get(tag_id, 0)


def _serialize_admin_tag(
    session: Session,
    tag: Tag,
    *,
    usage_by_id: dict[UUID, int] | None = None,
) -> dict[str, Any]:
    data = serialize_tag_ref(tag)
    data["description"] = tag.description
    data["archived_at"] = (
        tag.archived_at.isoformat() if tag.archived_at is not None else None
    )
    data["is_system"] = _is_system_tag_name(tag.name)
    if usage_by_id is not None:
        data["usage_count"] = usage_by_id.get(tag.id, 0)
    else:
        data["usage_count"] = _tag_usage_count(session, tag.id)
    return data


def _parse_include_archived(event: Mapping[str, Any]) -> bool:
    raw = query_param(event, "include_archived")
    if raw is None or raw.strip() == "":
        return False
    normalized = raw.strip().lower()
    if normalized in {"true", "1"}:
        return True
    if normalized in {"false", "0"}:
        return False
    raise ValidationError(
        "include_archived must be true or false", field="include_archived"
    )


def _parse_archived_only(event: Mapping[str, Any]) -> bool:
    raw = query_param(event, "archived_only")
    if raw is None or raw.strip() == "":
        return False
    normalized = raw.strip().lower()
    if normalized in {"true", "1"}:
        return True
    if normalized in {"false", "0"}:
        return False
    raise ValidationError("archived_only must be true or false", field="archived_only")


def _parse_optional_hex_color(value: Any, *, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string or null", field=field)
    stripped = value.strip()
    if stripped == "":
        return None
    if not _HEX_COLOR_RE.match(stripped):
        raise ValidationError(
            f"{field} must be a #RRGGBB hex color or null", field=field
        )
    return stripped


def _list_tags(event: Mapping[str, Any]) -> dict[str, Any]:
    include_archived = _parse_include_archived(event)
    archived_only = _parse_archived_only(event)
    if archived_only and include_archived:
        raise ValidationError(
            "use either archived_only or include_archived, not both",
            field="archived_only",
        )
    with Session(get_engine()) as session:
        stmt = select(Tag).order_by(func.lower(Tag.name))
        if archived_only:
            stmt = stmt.where(Tag.archived_at.is_not(None))
        elif not include_archived:
            stmt = stmt.where(Tag.archived_at.is_(None))
        tags = list(session.execute(stmt).scalars().all())
        tag_ids = [t.id for t in tags]
        usage_map = _usage_counts_by_tag_id(session, tag_ids)
        return json_response(
            200,
            {
                "items": [
                    _serialize_admin_tag(session, t, usage_by_id=usage_map)
                    for t in tags
                ]
            },
            event=event,
        )


def _get_tag(event: Mapping[str, Any], *, tag_id: UUID) -> dict[str, Any]:
    with Session(get_engine()) as session:
        tag = session.get(Tag, tag_id)
        if tag is None:
            raise NotFoundError("Tag", str(tag_id))
        return json_response(
            200,
            {"tag": _serialize_admin_tag(session, tag)},
            event=event,
        )


def _create_tag(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    body = parse_body(event)
    name = validate_string_length(
        body.get("name"),
        "name",
        max_length=100,
        required=True,
    )
    if name is None:
        raise ValidationError("name is required", field="name")
    name_stripped = name.strip()
    if not name_stripped:
        raise ValidationError("name must not be empty", field="name")
    if _is_reserved_tag_name(name_stripped):
        raise ValidationError(
            "This tag name is reserved for system use",
            field="name",
            status_code=400,
        )
    color = _parse_optional_hex_color(body.get("color"), field="color")
    description = validate_string_length(
        body.get("description"),
        "description",
        max_length=255,
        required=False,
    )
    desc_stripped = description.strip() if description else None
    if desc_stripped == "":
        desc_stripped = None

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        tag = Tag(
            name=name_stripped,
            color=color,
            description=desc_stripped,
            created_by=actor_sub,
        )
        session.add(tag)
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise ValidationError(
                "A tag with this name already exists",
                field="name",
                status_code=409,
            ) from exc
        session.refresh(tag)
        return json_response(
            201,
            {"tag": _serialize_admin_tag(session, tag)},
            event=event,
        )


def _update_tag(
    event: Mapping[str, Any],
    *,
    tag_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    body = parse_body(event)
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        tag = session.get(Tag, tag_id)
        if tag is None:
            raise NotFoundError("Tag", str(tag_id))

        if "archived" in body:
            archived = parse_optional_bool_body(body.get("archived"), field="archived")
            if archived is None:
                raise ValidationError(
                    "archived must be true or false", field="archived"
                )
            if archived is False:
                tag.archived_at = None
            elif _is_system_tag_name(tag.name):
                raise ValidationError(
                    "System-managed tags cannot be archived via PATCH; they stay active",
                    field="archived",
                    status_code=400,
                )
            else:
                tag.archived_at = datetime.now(tz=UTC)

        if "name" in body:
            name = validate_string_length(
                body.get("name"),
                "name",
                max_length=100,
                required=True,
            )
            if name is None:
                raise ValidationError("name is required", field="name")
            name_stripped = name.strip()
            if not name_stripped:
                raise ValidationError("name must not be empty", field="name")
            if (
                _is_system_tag_name(tag.name)
                and name_stripped.lower() != tag.name.lower()
            ):
                raise ValidationError(
                    "System-managed tags cannot be renamed",
                    field="name",
                    status_code=400,
                )
            if (
                _is_reserved_tag_name(name_stripped)
                and name_stripped.lower() != tag.name.lower()
            ):
                raise ValidationError(
                    "This tag name is reserved for system use",
                    field="name",
                    status_code=400,
                )
            tag.name = name_stripped
        if "color" in body:
            tag.color = _parse_optional_hex_color(body.get("color"), field="color")
        if "description" in body:
            description = validate_string_length(
                body.get("description"),
                "description",
                max_length=255,
                required=False,
            )
            if description is None or description.strip() == "":
                tag.description = None
            else:
                tag.description = description.strip()

        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise ValidationError(
                "A tag with this name already exists",
                field="name",
                status_code=409,
            ) from exc
        session.refresh(tag)
        return json_response(
            200,
            {"tag": _serialize_admin_tag(session, tag)},
            event=event,
        )


def _delete_tag(
    event: Mapping[str, Any],
    *,
    tag_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        tag = session.get(Tag, tag_id)
        if tag is None:
            raise NotFoundError("Tag", str(tag_id))

        if _is_system_tag_name(tag.name):
            raise ValidationError(
                "System-managed tags cannot be deleted or archived",
                field="tag",
                status_code=400,
            )

        usage = _tag_usage_count(session, tag_id)
        if usage > 0:
            if tag.archived_at is None:
                tag.archived_at = datetime.now(tz=UTC)
            session.commit()
            refreshed = session.get(Tag, tag_id)
            if refreshed is None:
                raise NotFoundError("Tag", str(tag_id))
            return json_response(
                200,
                {
                    "deleted": False,
                    "usage_count": usage,
                    "tag": _serialize_admin_tag(session, refreshed),
                },
                event=event,
            )

        session.delete(tag)
        session.commit()
        return json_response(
            200,
            {"deleted": True, "usage_count": 0},
            event=event,
        )
