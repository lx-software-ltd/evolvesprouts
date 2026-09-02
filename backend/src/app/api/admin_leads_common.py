"""Shared parser/serializer helpers for admin leads API handlers."""

from __future__ import annotations

import base64
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.api.admin_request import (
    parse_limit as parse_admin_limit,
    query_param,
    request_id as request_id,
)
from app.api.admin_validators import (
    MAX_DESCRIPTION_LENGTH,
    MAX_NAME_LENGTH,
    parse_optional_instagram_handle,
    validate_email,
    validate_phone_fields,
    validate_string_length,
)
from app.db.models import Contact, Note, SalesLead, SalesLeadEvent
from app.db.models.enums import (
    ContactSource,
    ContactType,
    FunnelStage,
    LeadEventType,
    LeadLostReason,
    LeadType,
)
from app.exceptions import ValidationError


def parse_lead_filters(event: Mapping[str, Any]) -> dict[str, Any]:
    """Parse list/query filters for the lead list endpoint."""
    limit = parse_admin_limit(event)
    raw_cursor = query_param(event, "cursor")
    sort = (query_param(event, "sort") or "created_at").strip().lower()
    if sort not in {"created_at", "updated_at", "funnel_stage", "contact_name"}:
        raise ValidationError("Invalid sort field", field="sort")
    if raw_cursor and sort != "created_at":
        raise ValidationError(
            "cursor is only supported when sort is created_at",
            field="cursor",
        )
    cursor_created_at, cursor_id = parse_lead_cursor(raw_cursor)
    sort_dir = (query_param(event, "sort_dir") or "desc").strip().lower()
    if sort_dir not in {"asc", "desc"}:
        raise ValidationError("sort_dir must be asc or desc", field="sort_dir")

    return {
        "limit": limit,
        "cursor_created_at": cursor_created_at,
        "cursor_id": cursor_id,
        "stage": _parse_enum_list(query_param(event, "stage"), FunnelStage, "stage"),
        "source": _parse_enum_list(
            query_param(event, "source"), ContactSource, "source"
        ),
        "lead_type": _parse_enum_list(
            query_param(event, "lead_type"), LeadType, "lead_type"
        ),
        "assigned_to": _parse_optional_text(query_param(event, "assigned_to")),
        "unassigned": _parse_bool(query_param(event, "unassigned"), default=False),
        "date_from": parse_optional_datetime(
            query_param(event, "date_from"), "date_from"
        ),
        "date_to": parse_optional_datetime(query_param(event, "date_to"), "date_to"),
        "search": _parse_optional_text(query_param(event, "search")),
        "sort": sort,
        "sort_dir": sort_dir,
    }


def parse_create_lead_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and normalize create-lead request payload."""
    first_name = validate_string_length(
        body.get("first_name"),
        "first_name",
        max_length=MAX_NAME_LENGTH,
        required=True,
    )
    if first_name is None:
        raise ValidationError("first_name is required", field="first_name")
    source = _parse_enum_value(body.get("source"), ContactSource, "source")
    lead_type = _parse_enum_value(body.get("lead_type"), LeadType, "lead_type")
    email = validate_email(body.get("email"))
    phone_in_body = "phone_region" in body or "phone_number" in body
    skip_phone_update = not phone_in_body
    phone_region: str | None = None
    phone_national_number: str | None = None
    if phone_in_body:
        phone_region_raw = body.get("phone_region")
        phone_number_raw = body.get("phone_number")
        if phone_region_raw is None and phone_number_raw is None:
            phone_region, phone_national_number = None, None
        else:
            if phone_region_raw is None or phone_number_raw is None:
                raise ValidationError(
                    "phone_region and phone_number must both be provided or both null",
                    field="phone_number",
                )
            phone_region, phone_national_number = validate_phone_fields(
                phone_region_raw, phone_number_raw
            )
    return {
        "first_name": first_name,
        "last_name": validate_string_length(
            body.get("last_name"),
            "last_name",
            max_length=MAX_NAME_LENGTH,
            required=False,
        ),
        "email": email,
        "phone_region": phone_region,
        "phone_national_number": phone_national_number,
        "skip_phone_update": skip_phone_update,
        "instagram_handle": parse_optional_instagram_handle(
            body.get("instagram_handle")
        ),
        "source": source,
        "source_detail": validate_string_length(
            body.get("source_detail"),
            "source_detail",
            max_length=MAX_DESCRIPTION_LENGTH,
            required=False,
        ),
        "lead_type": lead_type,
        "contact_type": _parse_optional_enum_value(
            body.get("contact_type"),
            ContactType,
            "contact_type",
        )
        or ContactType.PARENT,
        "assigned_to": _parse_optional_text(body.get("assigned_to")),
        "assigned_to_provided": "assigned_to" in body,
        "note": validate_string_length(
            body.get("note"),
            "note",
            max_length=MAX_DESCRIPTION_LENGTH,
            required=False,
        ),
    }


def parse_update_lead_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and normalize update-lead request payload."""
    if not body:
        raise ValidationError("At least one field is required", field="body")

    funnel_stage = _parse_optional_enum_value(
        body.get("funnel_stage"),
        FunnelStage,
        "funnel_stage",
    )
    lost_reason = _parse_optional_enum_value(
        body.get("lost_reason"),
        LeadLostReason,
        "lost_reason",
    )
    if funnel_stage == FunnelStage.LOST and not lost_reason:
        raise ValidationError(
            "lost_reason is required when funnel_stage is lost",
            field="lost_reason",
        )

    return {
        "funnel_stage": funnel_stage,
        "lost_reason": lost_reason,
        "assigned_to": _parse_optional_text(body.get("assigned_to")),
        "assigned_to_provided": "assigned_to" in body,
    }


def serialize_lead_summary(lead: SalesLead) -> dict[str, Any]:
    """Serialize lead list row payload."""
    computed_days_in_stage = getattr(lead, "_computed_days_in_stage", None)
    computed_last_activity_at = getattr(lead, "_computed_last_activity_at", None)
    days_in_stage: int
    last_activity_at: str | None
    if computed_days_in_stage is not None and computed_last_activity_at is not None:
        days_in_stage = int(computed_days_in_stage)
        if isinstance(computed_last_activity_at, datetime):
            last_activity_at = computed_last_activity_at.isoformat()
        else:
            last_activity_at = (
                str(computed_last_activity_at) if computed_last_activity_at else None
            )
    else:
        events = sorted(
            lead.events,
            key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC),
            reverse=True,
        )
        days_in_stage = _compute_days_in_stage(lead, events)
        last_activity_at = _last_activity_at(lead, events)
    return {
        "id": str(lead.id),
        "contact": _serialize_contact(lead.contact),
        "lead_type": lead.lead_type.value,
        "funnel_stage": lead.funnel_stage.value,
        "assigned_to": lead.assigned_to,
        "created_at": lead.created_at.isoformat() if lead.created_at else None,
        "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
        "converted_at": lead.converted_at.isoformat() if lead.converted_at else None,
        "lost_at": lead.lost_at.isoformat() if lead.lost_at else None,
        "lost_reason": lead.lost_reason.value if lead.lost_reason else None,
        "days_in_stage": days_in_stage,
        "last_activity_at": last_activity_at,
        "tags": _extract_contact_tags(lead.contact),
    }


def serialize_lead_detail(lead: SalesLead) -> dict[str, Any]:
    """Serialize lead detail payload including events and notes."""
    events = sorted(
        lead.events,
        key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    notes = sorted(
        lead.notes,
        key=lambda item: item.created_at or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    summary = serialize_lead_summary(lead)
    summary["events"] = [_serialize_event(item) for item in events]
    summary["notes"] = [serialize_note(item) for item in notes]
    summary["family"] = None
    summary["organization"] = None
    return summary


def serialize_note(note: Note) -> dict[str, Any]:
    """Serialize a note payload."""
    return {
        "id": str(note.id),
        "content": note.content,
        "created_by": note.created_by,
        "created_at": note.created_at.isoformat() if note.created_at else None,
        "updated_at": note.updated_at.isoformat() if note.updated_at else None,
    }


def parse_optional_datetime(raw_value: str | None, field: str) -> datetime | None:
    """Parse optional datetime field in ISO-8601 format."""
    if not raw_value:
        return None
    try:
        normalized = raw_value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValidationError(
            f"{field} must be a valid ISO datetime", field=field
        ) from exc
    return _normalize_datetime(parsed)


def encode_lead_cursor(lead: SalesLead) -> str | None:
    """Encode lead cursor for pagination."""
    if not lead.created_at:
        return None
    payload = json.dumps(
        {
            "created_at": _normalize_datetime(lead.created_at).isoformat(),
            "id": str(lead.id),
        }
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("utf-8")
    return encoded.rstrip("=")


def parse_lead_cursor(cursor: str | None) -> tuple[datetime | None, UUID | None]:
    """Parse a lead list cursor payload."""
    if not cursor:
        return None, None
    try:
        padding = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(cursor + padding))
        created_at_raw = payload["created_at"]
        lead_id_raw = payload["id"]
        if not isinstance(created_at_raw, str):
            raise ValueError("created_at must be a string")
        created_at = _normalize_datetime(
            datetime.fromisoformat(created_at_raw.replace("Z", "+00:00"))
        )
        lead_id = UUID(str(lead_id_raw))
        return created_at, lead_id
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValidationError("Invalid cursor", field="cursor") from exc


def _serialize_contact(contact: Contact | None) -> dict[str, Any]:
    if contact is None:
        return {
            "id": None,
            "first_name": None,
            "last_name": None,
            "email": None,
            "phone_region": None,
            "phone_national_number": None,
            "phone_e164": None,
            "instagram_handle": None,
            "source": None,
            "source_detail": None,
            "contact_type": None,
            "relationship_type": None,
        }
    return {
        "id": str(contact.id),
        "first_name": contact.first_name,
        "last_name": contact.last_name,
        "email": contact.email,
        "phone_region": contact.phone_region,
        "phone_national_number": contact.phone_national_number,
        "phone_e164": contact.phone_e164,
        "instagram_handle": contact.instagram_handle,
        "source": contact.source.value if contact.source else None,
        "source_detail": contact.source_detail,
        "contact_type": contact.contact_type.value if contact.contact_type else None,
        "relationship_type": (
            contact.relationship_type.value if contact.relationship_type else None
        ),
    }


def _serialize_event(event: SalesLeadEvent) -> dict[str, Any]:
    return {
        "id": str(event.id),
        "event_type": event.event_type.value,
        "from_stage": event.from_stage.value if event.from_stage else None,
        "to_stage": event.to_stage.value if event.to_stage else None,
        "metadata": event.metadata_json,
        "created_by": event.created_by,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


def _compute_days_in_stage(lead: SalesLead, events: Sequence[SalesLeadEvent]) -> int:
    now = datetime.now(UTC)
    relevant = [
        event
        for event in events
        if event.event_type == LeadEventType.STAGE_CHANGED
        and event.to_stage == lead.funnel_stage
        and event.created_at is not None
    ]
    stage_start = relevant[0].created_at if relevant else lead.created_at
    if stage_start is None:
        return 0
    stage_start_utc = _normalize_datetime(stage_start)
    return max((now - stage_start_utc).days, 0)


def _last_activity_at(lead: SalesLead, events: Sequence[SalesLeadEvent]) -> str | None:
    timestamps = [lead.updated_at, lead.created_at]
    timestamps.extend(event.created_at for event in events)
    valid = [value for value in timestamps if value is not None]
    if not valid:
        return None
    latest = max(_normalize_datetime(item) for item in valid)
    return latest.isoformat()


def _extract_contact_tags(contact: Contact | None) -> list[str]:
    if contact is None:
        return []
    tags = [tag.name for tag in contact.tags if tag.name]
    return sorted(set(tags))


def _parse_enum_list(raw_value: str | None, enum_type: Any, field: str) -> list[Any]:
    if not raw_value:
        return []
    values: list[Any] = []
    for entry in raw_value.split(","):
        normalized = entry.strip().lower()
        if not normalized:
            continue
        values.append(_parse_enum_value(normalized, enum_type, field))
    return values


def _parse_enum_value(raw_value: Any, enum_type: Any, field: str) -> Any:
    if raw_value is None:
        raise ValidationError(f"{field} is required", field=field)
    try:
        return enum_type(str(raw_value).strip().lower())
    except ValueError as exc:
        raise ValidationError(f"Invalid value for {field}", field=field) from exc


def _parse_optional_enum_value(
    raw_value: Any, enum_type: Any, field: str
) -> Any | None:
    if raw_value is None:
        return None
    normalized = str(raw_value).strip()
    if not normalized:
        return None
    return _parse_enum_value(normalized, enum_type, field)


def _parse_optional_text(raw_value: Any) -> str | None:
    if raw_value is None:
        return None
    text = str(raw_value).strip()
    return text or None


def _parse_bool(raw_value: str | None, *, default: bool) -> bool:
    if raw_value is None or raw_value == "":
        return default
    value = raw_value.strip().lower()
    if value in {"true", "1", "yes"}:
        return True
    if value in {"false", "0", "no"}:
        return False
    raise ValidationError("Value must be true or false", field="unassigned")


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def max_datetime(first: datetime | None, second: datetime) -> datetime:
    """Return the later of two datetimes when the first may be unset."""
    if first is None:
        return second
    return first if first >= second else second


def min_datetime(first: datetime | None, second: datetime) -> datetime:
    """Return the earlier of two datetimes when the first may be unset."""
    if first is None:
        return second
    return first if first <= second else second


def count_leads_in_window(
    repository: Any,
    *,
    date_from: datetime,
    date_to: datetime,
) -> int:
    """Count leads in an inclusive window; empty when the range is inverted."""
    if date_from > date_to:
        return 0
    return repository.count_leads(date_from=date_from, date_to=date_to)
