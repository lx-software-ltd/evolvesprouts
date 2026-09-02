"""Lightweight organization picker list for admin UI."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin_billing_common import (
    family_or_organization_bill_to_display_label,
    primary_org_contact_names,
)
from app.api.admin_entities_helpers import parse_limit, parse_relationship_type
from app.api.admin_request import query_param, require_admin_identity, split_route_parts
from app.db.engine import get_engine
from app.db.models import Organization, RelationshipType
from app.utils import json_response
from app.utils.logging import get_logger

_DEFAULT_LIMIT = 100

logger = get_logger(__name__)


def handle_admin_organizations_picker_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle GET /v1/admin/organizations/picker."""
    logger.info(
        "Handling admin organizations picker route",
        extra={"method": method, "path": path},
    )
    parts = split_route_parts(path)
    if len(parts) < 3 or parts[0] != "admin":
        return json_response(404, {"error": "Not found"}, event=event)

    require_admin_identity(event)

    if method != "GET":
        return json_response(405, {"error": "Method not allowed"}, event=event)

    if parts[1] == "organizations" and parts[2] == "picker" and len(parts) == 3:
        return _list_organization_picker(event)

    return json_response(404, {"error": "Not found"}, event=event)


def _list_organization_picker(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event, default=_DEFAULT_LIMIT)
    relationship_filter = query_param(event, "relationship_type")
    with Session(get_engine()) as session:
        statement = select(Organization.id, Organization.name).where(
            Organization.archived_at.is_(None)
        )
        if relationship_filter:
            rel_type = parse_relationship_type(
                relationship_filter,
                field="relationship_type",
            )
            statement = statement.where(Organization.relationship_type == rel_type)
        else:
            statement = statement.where(
                Organization.relationship_type.notin_(
                    (RelationshipType.VENDOR, RelationshipType.PARTNER)
                )
            )
        statement = statement.order_by(
            Organization.name.asc(), Organization.id.asc()
        ).limit(limit)
        rows = session.execute(statement).all()
        org_ids = {r[0] for r in rows}
        primary_by_id = primary_org_contact_names(session, org_ids)
        items: list[dict[str, str]] = []
        for org_id, org_name in rows:
            entity = (org_name or "").strip()
            pc = (primary_by_id.get(org_id) or "").strip()
            label = family_or_organization_bill_to_display_label(
                entity_name=entity or None,
                primary_display_name=pc or None,
            )
            display = label if label else entity or str(org_id)
            items.append({"id": str(org_id), "label": display})
        return json_response(200, {"items": items}, event=event)
