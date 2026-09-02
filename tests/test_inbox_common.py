from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.api.inbox_common import (
    encode_last_message_cursor,
    isoformat_inbox_datetime,
    parse_inbox_search,
    parse_last_message_cursor,
    parse_meta_channel,
)
from app.db.models.enums import MetaChannel
from app.exceptions import ValidationError


def test_parse_meta_channel_accepts_known_values_and_rejects_others() -> None:
    assert parse_meta_channel(None) is None
    assert parse_meta_channel("  ") is None
    assert parse_meta_channel(" Instagram ") is MetaChannel.INSTAGRAM
    with pytest.raises(ValidationError, match="channel must be facebook or instagram"):
        parse_meta_channel("tiktok")


def test_parse_inbox_search_normalizes_and_rejects_long_values() -> None:
    assert parse_inbox_search(None) is None
    assert parse_inbox_search("  ") is None
    assert parse_inbox_search("  alice  ") == "alice"
    with pytest.raises(ValidationError, match="q is too long"):
        parse_inbox_search("x" * 121)


def test_last_message_cursor_round_trip() -> None:
    row_id = uuid4()
    last_message_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    cursor = encode_last_message_cursor(last_message_at, row_id)
    assert cursor is not None
    parsed_at, parsed_id = parse_last_message_cursor(cursor)
    assert parsed_id == row_id
    assert parsed_at == last_message_at
    assert encode_last_message_cursor(None, row_id) is None
    assert parse_last_message_cursor(None) == (None, None)
    with pytest.raises(ValidationError, match="Invalid cursor"):
        parse_last_message_cursor("%%%")


def test_isoformat_inbox_datetime_handles_naive_utc() -> None:
    naive = datetime(2026, 1, 2, 3, 4, 5)
    assert isoformat_inbox_datetime(naive) == "2026-01-02T03:04:05+00:00"
    assert isoformat_inbox_datetime(None) is None
