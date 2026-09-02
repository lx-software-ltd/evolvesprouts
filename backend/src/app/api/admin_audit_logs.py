"""Admin audit log read API (database change history)."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_audit_actors import (
    actor_labels_for_user_ids,
    api_key_user_id_for_name,
    cognito_emails_for_subs,
    cognito_sub_for_email,
    system_actor_user_id_for_label,
    validate_actor_filter,
)
from app.api.admin_request import (
    encode_created_cursor,
    parse_created_cursor,
    parse_limit,
    parse_uuid,
    query_param,
    request_id,
    require_admin_identity,
    split_route_parts,
)
from app.db.audit import AuditLogRepository, set_audit_context
from app.db.auditable_tables import AUDITABLE_TABLES
from app.db.engine import get_engine
from app.db.models import AuditLog
from app.exceptions import NotFoundError, ValidationError
from app.utils import json_response, parse_datetime
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Exact-match secret field names (case-insensitive key lookup).
AUDIT_SECRET_FIELDS: frozenset[str] = frozenset(
    ("password", "secret", "token", "api_key", "key_hash", "share_token", "key_prefix")
)

# Explicit PII column names from AUDITABLE_TABLES models (customer_invoices, etc.).
AUDIT_PII_EXACT_FIELDS: frozenset[str] = frozenset(
    (
        "bill_to_display_name",
        "bill_to_email",
        "bill_to_location_text",
        "bill_to_snapshot",
    )
)

# Second pass: redact keys whose lowercased name contains any of these substrings.
# Includes "name" so personal names (display_name, first_name, family_name, etc.)
# in nested JSON snapshots are masked even under non-PII parent keys.
_AUDIT_PII_SUBSTRINGS: tuple[str, ...] = ("email", "phone", "address", "name")

_REDACTED_MARKER = "***REDACTED***"

_DEFAULT_LIMIT = 25
_MAX_LIMIT = 100


def _actor_labels_for_user_ids(
    session: Session,
    user_ids: list[str],
    *,
    cache: dict[str, str] | None = None,
) -> dict[str, str]:
    """Resolve Cognito emails and API key names for audit rows."""
    return actor_labels_for_user_ids(
        session,
        user_ids,
        user_pool_id=os.getenv("COGNITO_USER_POOL_ID"),
        cache=cache,
    )


def _cognito_emails_for_subs(
    subs: list[str],
    *,
    cache: dict[str, str] | None = None,
) -> dict[str, str]:
    """Test-facing wrapper around Cognito email lookup."""
    user_pool_id = os.getenv("COGNITO_USER_POOL_ID")
    if not user_pool_id:
        return {}
    return cognito_emails_for_subs(subs, user_pool_id=user_pool_id, cache=cache)


def handle_admin_audit_logs_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle ``/v1/admin/audit-logs`` and ``/v1/admin/audit-logs/{id}``."""
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "audit-logs":
        return json_response(404, {"error": "Not found"}, event=event)

    identity = require_admin_identity(event)

    if len(parts) == 2:
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _list_audit_logs(event, actor_sub=identity.user_sub)

    if len(parts) == 3:
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _get_audit_log_by_id(
            event, audit_id=parts[2], actor_sub=identity.user_sub
        )

    return json_response(404, {"error": "Not found"}, event=event)


def _get_audit_log_by_id(
    event: Mapping[str, Any],
    *,
    audit_id: str,
    actor_sub: str,
) -> dict[str, Any]:
    parsed_id = parse_uuid(audit_id)
    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        repo = AuditLogRepository(session)
        entry = repo.get_by_id(parsed_id)
        if entry is None:
            raise NotFoundError("audit_log", audit_id)
        actor_map = _actor_labels_for_user_ids(
            session,
            [entry.user_id] if entry.user_id else [],
        )
        return json_response(
            200, _serialize_audit_log(entry, email_map=actor_map), event=event
        )


def _should_redact_audit_field(key: str) -> bool:
    """Return True when an audit old/new_values key should be masked."""
    lowered = key.lower()
    if lowered in AUDIT_SECRET_FIELDS or lowered in AUDIT_PII_EXACT_FIELDS:
        return True
    return any(sub in lowered for sub in _AUDIT_PII_SUBSTRINGS)


def _redact_audit_value(key: str, value: Any) -> Any:
    """Mask a single audit value; recurse only when the parent key is not PII."""
    if value == _REDACTED_MARKER:
        return value
    if _should_redact_audit_field(key):
        return _REDACTED_MARKER
    if isinstance(value, Mapping):
        return {
            nested_key: _redact_audit_value(str(nested_key), nested_value)
            for nested_key, nested_value in value.items()
        }
    if isinstance(value, (list, tuple)):
        redacted = [_redact_audit_value(key, item) for item in value]
        return tuple(redacted) if isinstance(value, tuple) else redacted
    return value


def _list_audit_logs(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    limit = parse_limit(event, default=_DEFAULT_LIMIT, max_limit=_MAX_LIMIT)

    table_name = query_param(event, "table")
    record_id = query_param(event, "record_id")
    user_id = query_param(event, "user_id")
    email_raw = query_param(event, "email")
    action = query_param(event, "action")
    since_str = query_param(event, "since")

    if table_name and table_name not in AUDITABLE_TABLES:
        raise ValidationError(
            (
                f"Invalid table: {table_name}. Must be one of: "
                f"{', '.join(sorted(AUDITABLE_TABLES))}"
            ),
            field="table",
        )

    if record_id and not table_name:
        raise ValidationError(
            "table parameter is required when filtering by record_id",
            field="table",
        )

    valid_actions = {"INSERT", "UPDATE", "DELETE"}
    if action and action.upper() not in valid_actions:
        raise ValidationError(
            f"Invalid action: {action}. Must be one of: INSERT, UPDATE, DELETE",
            field="action",
        )

    since = None
    if since_str:
        since = parse_datetime(since_str)
        if since is None:
            raise ValidationError(
                "Invalid since format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)",
                field="since",
            )

    actor_filter: str | None = None
    if email_raw is not None and email_raw.strip():
        if user_id:
            raise ValidationError(
                "cannot combine email and user_id",
                field="email",
            )
        actor_filter = validate_actor_filter(email_raw)

    cursor_ts, cursor_id = parse_created_cursor(query_param(event, "cursor"))
    cursor: tuple[datetime, UUID] | None = None
    if cursor_ts is not None and cursor_id is not None:
        cursor = (cursor_ts, cursor_id)

    with Session(get_engine()) as session:
        set_audit_context(session, user_id=actor_sub, request_id=request_id(event))
        if actor_filter is not None:
            if "@" in actor_filter:
                user_pool_id = os.getenv("COGNITO_USER_POOL_ID")
                if not user_pool_id:
                    raise ValidationError(
                        "COGNITO_USER_POOL_ID is not configured",
                        field="COGNITO_USER_POOL_ID",
                    )
                resolved = cognito_sub_for_email(
                    actor_filter, user_pool_id=user_pool_id
                )
            else:
                resolved = system_actor_user_id_for_label(actor_filter)
                if resolved is None:
                    resolved = api_key_user_id_for_name(session, actor_filter)
            if resolved is None:
                return json_response(
                    200,
                    {"items": [], "next_cursor": None},
                    event=event,
                )
            user_id = resolved
        repo = AuditLogRepository(session)

        if record_id and table_name:
            rows = repo.get_record_history(
                table_name=table_name,
                record_id=record_id,
                limit=limit + 1,
                cursor=cursor,
            )
        elif user_id:
            rows = repo.get_user_activity(
                user_id=user_id,
                limit=limit + 1,
                since=since,
                cursor=cursor,
            )
        elif table_name:
            rows = repo.get_table_activity(
                table_name=table_name,
                limit=limit + 1,
                since=since,
                action=action.upper() if action else None,
                cursor=cursor,
            )
        else:
            rows = repo.get_recent_activity(
                limit=limit + 1,
                since=since,
                cursor=cursor,
            )

        has_more = len(rows) > limit
        trimmed = list(rows)[:limit]
        distinct_subs = sorted({r.user_id for r in trimmed if r.user_id})
        email_map = _actor_labels_for_user_ids(session, distinct_subs)

    logger.info(
        "Audit logs query returned %s entries (has_more=%s)",
        len(trimmed),
        has_more,
        extra={
            "table": table_name,
            "action": action,
            "since": since_str,
            "result_count": len(trimmed),
        },
    )

    next_cursor: str | None = None
    if has_more and trimmed:
        last_row = trimmed[-1]
        last_id = (
            last_row.id if isinstance(last_row.id, UUID) else UUID(str(last_row.id))
        )
        next_cursor = encode_created_cursor(last_row.timestamp, last_id)
    return json_response(
        200,
        {
            "items": [
                _serialize_audit_log(row, email_map=email_map) for row in trimmed
            ],
            "next_cursor": next_cursor,
        },
        event=event,
    )


def _serialize_audit_log(
    entry: AuditLog,
    *,
    email_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    old_values = entry.old_values or {}
    new_values = entry.new_values or {}
    emails = email_map or {}

    def redact_values(values: dict[str, Any]) -> dict[str, Any]:
        return {key: _redact_audit_value(key, value) for key, value in values.items()}

    user_id_val = entry.user_id
    payload: dict[str, Any] = {
        "id": str(entry.id),
        "table_name": entry.table_name,
        "record_id": entry.record_id,
        "action": entry.action,
        "user_id": user_id_val,
        "request_id": entry.request_id,
        "old_values": redact_values(dict(old_values)),
        "new_values": redact_values(dict(new_values)),
        "changed_fields": entry.changed_fields,
        "timestamp": entry.timestamp,
        "source": entry.source,
        "ip_address": entry.ip_address,
        "user_agent": entry.user_agent,
    }
    if user_id_val and user_id_val in emails:
        payload["user_email"] = emails[user_id_val]
    return payload
