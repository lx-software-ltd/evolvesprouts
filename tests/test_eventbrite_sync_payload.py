"""Eventbrite event payload datetime format."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import pytest

from app.db.models import ServiceDeliveryMode
from app.services.eventbrite_sync import EventbriteSyncError, _build_event_payload


class _Slot:
    def __init__(
        self,
        *,
        starts_at: datetime,
        ends_at: datetime,
        sort_order: int,
    ) -> None:
        self.starts_at = starts_at
        self.ends_at = ends_at
        self.sort_order = sort_order


class _Tier:
    def __init__(self, currency: str = "HKD") -> None:
        self.currency = currency


class _Service:
    def __init__(self) -> None:
        self.title = "Workshop"
        self.description = "A workshop"
        self.delivery_mode = ServiceDeliveryMode.IN_PERSON


class _Instance:
    def __init__(self, slots: list[_Slot]) -> None:
        self.title = "Mealtime Workshop"
        self.description = "Hands-on session"
        self.delivery_mode = None
        self.service = _Service()
        self.session_slots = slots
        self.ticket_tiers = [_Tier()]


def _instance_at(start: datetime, end: datetime) -> _Instance:
    return _Instance(
        [
            _Slot(starts_at=end, ends_at=end, sort_order=2),
            _Slot(starts_at=start, ends_at=start + timedelta(hours=1), sort_order=1),
        ]
    )


def test_build_event_payload_uses_zulu_utc_and_configured_timezone(
    monkeypatch: Any,
) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "Asia/Hong_Kong")
    hong_kong = timezone(timedelta(hours=8))
    payload = _build_event_payload(
        _instance_at(
            datetime(2026, 11, 20, 18, 0, tzinfo=hong_kong),
            datetime(2026, 11, 20, 20, 0, tzinfo=hong_kong),
        )
    )

    assert payload["start"] == {
        "timezone": "Asia/Hong_Kong",
        "utc": "2026-11-20T10:00:00Z",
    }
    assert payload["end"] == {
        "timezone": "Asia/Hong_Kong",
        "utc": "2026-11-20T12:00:00Z",
    }
    assert "+00:00" not in payload["start"]["utc"]
    assert "+00:00" not in payload["end"]["utc"]


def test_build_event_payload_strips_microseconds_from_utc_instants(
    monkeypatch: Any,
) -> None:
    monkeypatch.delenv("EVENTBRITE_DEFAULT_TIMEZONE", raising=False)
    payload = _build_event_payload(
        _instance_at(
            datetime(2026, 11, 20, 10, 0, 0, 123456, tzinfo=UTC),
            datetime(2026, 11, 20, 12, 0, 0, 999999, tzinfo=UTC),
        )
    )

    assert payload["start"]["utc"] == "2026-11-20T10:00:00Z"
    assert payload["end"]["utc"] == "2026-11-20T12:00:00Z"
    assert payload["start"]["timezone"] == "UTC"
    assert payload["end"]["timezone"] == "UTC"


def test_build_event_payload_rejects_invalid_timezone(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC+08:00")

    with pytest.raises(EventbriteSyncError, match="EVENTBRITE_DEFAULT_TIMEZONE"):
        _build_event_payload(
            _instance_at(
                datetime(2026, 11, 20, 10, 0, tzinfo=UTC),
                datetime(2026, 11, 20, 12, 0, tzinfo=UTC),
            )
        )


def test_build_event_payload_rejects_naive_session_times(monkeypatch: Any) -> None:
    monkeypatch.delenv("EVENTBRITE_DEFAULT_TIMEZONE", raising=False)

    with pytest.raises(EventbriteSyncError, match="timezone"):
        _build_event_payload(
            _instance_at(
                datetime(2026, 11, 20, 10, 0),
                datetime(2026, 11, 20, 12, 0),
            )
        )
