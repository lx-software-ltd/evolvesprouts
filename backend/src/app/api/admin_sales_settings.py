"""Admin GET/PATCH handlers for sales lead assignment settings."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.api.admin_leads_common import request_id
from app.api.admin_request import parse_body
from app.api.admin_validators import validate_string_length
from app.db.audit import set_audit_context
from app.db.engine import get_engine
from app.db.repositories.sales_settings import SalesSettingsRepository
from app.exceptions import ValidationError
from app.utils import json_response

_ASSIGNED_TO_MAX_LENGTH = 128


def handle_sales_settings_request(
    event: Mapping[str, Any],
    method: str,
    *,
    actor_sub: str,
) -> dict[str, Any]:
    """Handle ``GET|PATCH /v1/admin/leads/settings``."""
    if method == "GET":
        return _get_sales_settings(event, actor_sub=actor_sub)
    if method == "PATCH":
        return _patch_sales_settings(event, actor_sub=actor_sub)
    return json_response(405, {"error": "Method not allowed"}, event=event)


def serialize_sales_settings(row: Any) -> dict[str, Any]:
    """Serialize the singleton sales settings row."""
    updated_at = getattr(row, "updated_at", None)
    return {
        "default_assigned_to": row.default_assigned_to,
        "notify_assignee_on_assignment": bool(row.notify_assignee_on_assignment),
        "helper_detector_enabled": bool(row.helper_detector_enabled),
        "updated_at": updated_at.isoformat() if updated_at is not None else None,
        "updated_by": row.updated_by,
    }


def parse_sales_settings_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a partial settings update."""
    if not body:
        raise ValidationError("At least one field is required", field="body")
    unknown = set(body) - {
        "default_assigned_to",
        "notify_assignee_on_assignment",
        "helper_detector_enabled",
    }
    if unknown:
        raise ValidationError(
            "Unsupported field: " + ", ".join(sorted(unknown)),
            field=sorted(unknown)[0],
        )
    payload: dict[str, Any] = {}
    if "default_assigned_to" in body:
        raw = body.get("default_assigned_to")
        if raw is None:
            payload["default_assigned_to"] = None
        else:
            assigned_to = validate_string_length(
                raw,
                "default_assigned_to",
                max_length=_ASSIGNED_TO_MAX_LENGTH,
                required=False,
            )
            payload["default_assigned_to"] = assigned_to
    if "notify_assignee_on_assignment" in body:
        raw_flag = body.get("notify_assignee_on_assignment")
        if not isinstance(raw_flag, bool):
            raise ValidationError(
                "notify_assignee_on_assignment must be a boolean",
                field="notify_assignee_on_assignment",
            )
        payload["notify_assignee_on_assignment"] = raw_flag
    if "helper_detector_enabled" in body:
        raw_helper = body.get("helper_detector_enabled")
        if not isinstance(raw_helper, bool):
            raise ValidationError(
                "helper_detector_enabled must be a boolean",
                field="helper_detector_enabled",
            )
        payload["helper_detector_enabled"] = raw_helper
    if not payload:
        raise ValidationError("At least one field is required", field="body")
    return payload


def _get_sales_settings(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        row = SalesSettingsRepository(session).get_or_create()
        session.commit()
        return json_response(
            200,
            {"settings": serialize_sales_settings(row)},
            event=event,
        )


def _patch_sales_settings(
    event: Mapping[str, Any], *, actor_sub: str
) -> dict[str, Any]:
    body = parse_body(event)
    payload = parse_sales_settings_payload(body)
    with Session(get_engine()) as session:
        set_audit_context(
            session,
            user_id=actor_sub,
            request_id=request_id(event),
        )
        repo = SalesSettingsRepository(session)
        row = repo.get_or_create()
        if "default_assigned_to" in payload:
            row.default_assigned_to = payload["default_assigned_to"]
        if "notify_assignee_on_assignment" in payload:
            row.notify_assignee_on_assignment = payload["notify_assignee_on_assignment"]
        if "helper_detector_enabled" in payload:
            row.helper_detector_enabled = payload["helper_detector_enabled"]
        row.updated_by = actor_sub
        row.updated_at = datetime.now(UTC)
        repo.update(row)
        session.commit()
        return json_response(
            200,
            {"settings": serialize_sales_settings(row)},
            event=event,
        )
