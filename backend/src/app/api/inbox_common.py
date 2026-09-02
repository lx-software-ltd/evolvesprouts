"""Shared inbox conversation helpers for admin and public WhatsApp/Meta routes."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from uuid import UUID

from app.db.models.enums import MetaChannel
from app.exceptions import ValidationError

MAX_INBOX_SEARCH_LENGTH = 120


def parse_inbox_search(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None
    normalized = raw_value.strip()
    if not normalized:
        return None
    if len(normalized) > MAX_INBOX_SEARCH_LENGTH:
        raise ValidationError("q is too long", field="q")
    return normalized


def parse_meta_channel(raw_value: str | None) -> MetaChannel | None:
    if raw_value is None or not raw_value.strip():
        return None
    normalized = raw_value.strip().lower()
    try:
        return MetaChannel(normalized)
    except ValueError as exc:
        raise ValidationError(
            "channel must be facebook or instagram", field="channel"
        ) from exc


def normalize_inbox_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def encode_last_message_cursor(
    last_message_at: datetime | None, row_id: UUID
) -> str | None:
    if last_message_at is None:
        return None
    payload = json.dumps(
        {
            "last_message_at": normalize_inbox_datetime(last_message_at).isoformat(),
            "id": str(row_id),
        }
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")


def parse_last_message_cursor(
    cursor: str | None,
) -> tuple[datetime | None, UUID | None]:
    if not cursor:
        return None, None
    try:
        padding = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(cursor + padding))
        last_message_at_raw = payload["last_message_at"]
        if not isinstance(last_message_at_raw, str):
            raise ValueError("last_message_at must be a string")
        last_message_at = normalize_inbox_datetime(
            datetime.fromisoformat(last_message_at_raw.replace("Z", "+00:00"))
        )
        return last_message_at, UUID(str(payload["id"]))
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValidationError("Invalid cursor", field="cursor") from exc


def isoformat_inbox_datetime(value: datetime | None) -> str | None:
    return normalize_inbox_datetime(value).isoformat() if value is not None else None
