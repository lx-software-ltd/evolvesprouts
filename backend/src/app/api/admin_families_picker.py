"""Lightweight family picker list for admin UI."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin_request import (
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)
from app.api.admin_billing_common import (
    family_or_organization_bill_to_display_label,
    primary_family_contact_names,
)
from app.api.admin_entities_helpers import parse_limit
from app.db.engine import get_engine
from app.db.models import Family
from app.utils import json_response, method_not_allowed, not_found
from app.utils.logging import get_logger

_DEFAULT_LIMIT = 100

logger = get_logger(__name__)


def handle_admin_families_picker_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle GET /v1/admin/families/picker."""
    logger.info(
        "Handling admin families picker route",
        extra={"method": method, "path": path},
    )
    parts = split_route_parts(path)
    if len(parts) < 3 or not route_has_prefix(parts, "admin"):
        return not_found(event)

    require_admin_identity(event)

    if method != "GET":
        return method_not_allowed(event)

    if parts[1] == "families" and parts[2] == "picker" and len(parts) == 3:
        return _list_family_picker(event)

    return not_found(event)


def _list_family_picker(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event, default=_DEFAULT_LIMIT)
    with Session(get_engine()) as session:
        statement = (
            select(Family.id, Family.family_name)
            .where(Family.archived_at.is_(None))
            .order_by(Family.family_name.asc(), Family.id.asc())
            .limit(limit)
        )
        rows = session.execute(statement).all()
        fam_ids = {r[0] for r in rows}
        primary_by_id = primary_family_contact_names(session, fam_ids)
        items: list[dict[str, str]] = []
        for fam_id, family_name in rows:
            entity = (family_name or "").strip()
            pc = (primary_by_id.get(fam_id) or "").strip()
            label = family_or_organization_bill_to_display_label(
                entity_name=entity or None,
                primary_display_name=pc or None,
            )
            display = label if label else entity or str(fam_id)
            items.append({"id": str(fam_id), "label": display})
        return json_response(200, {"items": items}, event=event)
