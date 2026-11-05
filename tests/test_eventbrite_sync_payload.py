"""Eventbrite event payload datetime format and sync request sequence."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import pytest
from app.db.models import (
    EventbriteSyncStatus,
    InstanceStatus,
    ServiceDeliveryMode,
    ServiceType,
)
from app.services import eventbrite_sync
from app.services.eventbrite_sync import (
    EventbriteSyncError,
    _build_event_payload,
    _compute_instance_hash,
    sync_instance_to_eventbrite,
)


class _Slot:
    def __init__(
        self,
        *,
        starts_at: datetime,
        ends_at: datetime,
        sort_order: int,
    ) -> None:
        self.id = uuid4()
        self.starts_at = starts_at
        self.ends_at = ends_at
        self.sort_order = sort_order


class _Tier:
    def __init__(self, currency: str = "HKD") -> None:
        self.id = uuid4()
        self.name = "General"
        self.description = "Workshop seat"
        self.price = Decimal("150.00")
        self.currency = currency
        self.max_quantity = 12
        self.sort_order = 0


class _Service:
    def __init__(self) -> None:
        self.service_type = ServiceType.EVENT
        self.title = "Workshop"
        self.description = "A workshop"
        self.delivery_mode = ServiceDeliveryMode.IN_PERSON


class _Instance:
    def __init__(self, slots: list[_Slot]) -> None:
        self.id = UUID("22222222-2222-2222-2222-222222222222")
        self.service_id = UUID("33333333-3333-3333-3333-333333333333")
        self.title = "Mealtime Workshop"
        self.description = "Hands-on session"
        self.status = InstanceStatus.OPEN
        self.delivery_mode = None
        self.service = _Service()
        self.session_slots = slots
        self.ticket_tiers = [_Tier()]
        self.eventbrite_event_id = None
        self.eventbrite_event_url = None
        self.eventbrite_ticket_class_map: dict[str, str] = {}
        self.eventbrite_last_payload_hash = None
        self.eventbrite_sync_status = EventbriteSyncStatus.PENDING
        self.eventbrite_last_error = None
        self.eventbrite_retry_count = 0
        self.eventbrite_last_synced_at = None


def _instance_at(start: datetime, end: datetime) -> _Instance:
    midpoint = start + (end - start) / 2
    return _Instance(
        [
            _Slot(starts_at=midpoint, ends_at=end, sort_order=2),
            _Slot(starts_at=start, ends_at=midpoint, sort_order=1),
        ]
    )


def _workshop() -> _Instance:
    hong_kong = timezone(timedelta(hours=8))
    return _instance_at(
        datetime(2026, 11, 20, 18, 0, tzinfo=hong_kong),
        datetime(2026, 11, 20, 20, 0, tzinfo=hong_kong),
    )


def test_build_event_payload_uses_zulu_utc_and_configured_timezone(
    monkeypatch: Any,
) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "Asia/Hong_Kong")
    payload = _build_event_payload(_workshop())

    assert payload["start"] == {
        "timezone": "Asia/Hong_Kong",
        "utc": "2026-11-20T10:00:00Z",
    }
    assert payload["end"] == {
        "timezone": "Asia/Hong_Kong",
        "utc": "2026-11-20T12:00:00Z",
    }


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


@pytest.mark.parametrize("raw", ["UTC+08:00", "Etc/GMT-8", "GMT", " "])
def test_build_event_payload_falls_back_to_utc_for_unusable_timezone(
    monkeypatch: Any,
    raw: str,
) -> None:
    warnings: list[tuple[Any, ...]] = []
    monkeypatch.setattr(
        eventbrite_sync.logger,
        "warning",
        lambda *args, **_kwargs: warnings.append(args),
    )
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", raw)

    payload = _build_event_payload(_workshop())

    assert payload["start"]["timezone"] == "UTC"
    if raw.strip():
        assert warnings
    else:
        assert warnings == []


def test_build_event_payload_rejects_naive_session_times(monkeypatch: Any) -> None:
    monkeypatch.delenv("EVENTBRITE_DEFAULT_TIMEZONE", raising=False)

    with pytest.raises(EventbriteSyncError, match="timezone"):
        _build_event_payload(
            _instance_at(
                datetime(2026, 11, 20, 10, 0),
                datetime(2026, 11, 20, 12, 0),
            )
        )


def test_payload_hash_changes_when_display_timezone_changes(monkeypatch: Any) -> None:
    instance = _workshop()
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    utc_hash = _compute_instance_hash(instance)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "Asia/Hong_Kong")
    hong_kong_hash = _compute_instance_hash(instance)
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "Etc/GMT-8")
    fallback_hash = _compute_instance_hash(instance)

    assert utc_hash != hong_kong_hash
    assert fallback_hash == utc_hash


class _Session:
    def commit(self) -> None:
        return None


def _install_sync_fakes(monkeypatch: Any, instance: _Instance) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def _request(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        path = str(kwargs["path"])
        if path.startswith("/organizations/") and path.endswith("/events/"):
            return {"id": "1001", "url": "https://www.eventbrite.com/e/1001"}
        if path.endswith("/ticket_classes/"):
            return {"id": "2002"}
        return {"id": "1001", "url": "https://www.eventbrite.com/e/1001"}

    monkeypatch.setenv("EVENTBRITE_API_TOKEN", "token-value")
    monkeypatch.setenv("EVENTBRITE_ORGANIZATION_ID", "org-1")
    monkeypatch.setattr(eventbrite_sync, "eventbrite_request", _request)
    monkeypatch.setattr(
        eventbrite_sync,
        "load_instance_for_eventbrite_sync",
        lambda _session, _instance_id: instance,
    )
    return calls


def test_sync_creates_updates_ticket_and_publishes(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "Asia/Hong_Kong")
    instance = _workshop()
    calls = _install_sync_fakes(monkeypatch, instance)

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert [call["path"] for call in calls] == [
        "/organizations/org-1/events/",
        "/events/1001/",
        "/events/1001/ticket_classes/",
        "/events/1001/publish/",
    ]
    created = calls[0]["payload"]["event"]
    assert created["start"]["utc"] == "2026-11-20T10:00:00Z"
    assert created["end"]["utc"] == "2026-11-20T12:00:00Z"
    assert created["start"]["timezone"] == "Asia/Hong_Kong"
    ticket = calls[2]["payload"]["ticket_class"]
    assert ticket["quantity_total"] == 12
    assert isinstance(ticket["quantity_total"], int)
    assert ticket["cost"] == "HKD,15000"
    assert ticket["free"] is False

    calls.clear()
    second = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)
    assert second["status"] == "noop"
    assert calls == []

    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "America/New_York")
    third = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)
    assert third["status"] == "synced"
    assert [call["path"] for call in calls] == [
        "/events/1001/",
        f"/events/1001/ticket_classes/{instance.eventbrite_ticket_class_map[str(instance.ticket_tiers[0].id)]}/",
        "/events/1001/publish/",
    ]
    assert calls[0]["payload"]["event"]["start"]["timezone"] == "America/New_York"
    assert "venue_id" not in calls[0]["payload"]["event"]


class _Area:
    def __init__(
        self,
        level: str,
        name: str,
        *,
        code: str | None = None,
        parent: _Area | None = None,
    ) -> None:
        self.level = level
        self.name = name
        self.code = code
        self.parent = parent


class _Location:
    def __init__(self, area: _Area) -> None:
        self.name = "Hong Kong Island"
        self.address = None
        self.lat = None
        self.lng = None
        self.area = area


def _island_location() -> _Location:
    country = _Area("country", "Hong Kong", code="HK")
    city = _Area("city", "Hong Kong", parent=country)
    district = _Area("district", "Hong Kong Island", parent=city)
    return _Location(district)


def test_sync_publishes_overview_and_creates_venue(
    monkeypatch: Any, tmp_path: Any
) -> None:
    from pathlib import Path

    from app.services.eventbrite_sync import EventbriteSyncError

    page = {
        "en": {
            "outline": {"title": "Why this room", "description": "Helpers practice."},
        }
    }
    directory = Path(tmp_path)
    (directory / "sample-workshop.json").write_text(
        __import__("json").dumps(page),
        encoding="utf-8",
    )
    monkeypatch.setenv("EVENTBRITE_LANDING_PAGES_DIR", str(directory))
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.slug = "sample-workshop"
    instance.location = _island_location()
    calls = _install_sync_fakes(monkeypatch, instance)

    def _request(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        path = str(kwargs["path"])
        method = str(kwargs["method"])
        if path.startswith("/organizations/") and path.endswith("/events/"):
            return {"id": "1001", "url": "https://www.eventbrite.com/e/1001"}
        if path.endswith("/venues/"):
            return {"id": "3003"}
        if path.endswith("/ticket_classes/"):
            return {"id": "2002"}
        if "structured_content" in path and method == "GET":
            raise EventbriteSyncError(
                "Eventbrite API request failed (404): structured content"
            )
        if "structured_content" in path:
            return {"ok": True}
        if path == "/events/1001/" and method == "GET":
            return {"id": "1001", "venue_id": None}
        return {"id": "1001", "url": "https://www.eventbrite.com/e/1001"}

    monkeypatch.setattr(eventbrite_sync, "eventbrite_request", _request)
    calls.clear()

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    paths = [call["path"] for call in calls]
    assert paths == [
        "/organizations/org-1/events/",
        "/events/1001/",
        "/organizations/org-1/venues/",
        "/events/1001/",
        "/events/1001/structured_content/?purpose=listing",
        "/events/1001/structured_content/1/",
        "/events/1001/ticket_classes/",
        "/events/1001/publish/",
    ]
    update = calls[3]["payload"]["event"]
    assert update["description"]["html"] == "Hands-on session"
    assert update["venue_id"] == "3003"
    assert "<h2>" not in update["description"]["html"]
    overview = calls[5]["payload"]
    assert overview["publish"] is True
    assert overview["purpose"] == "listing"
    assert "Why this room" in overview["modules"][0]["data"]["body"]["text"]
    venue = calls[2]["payload"]["venue"]
    assert venue["name"] == "Hong Kong Island"
    assert venue["address"]["country"] == "HK"
    assert venue["address"]["city"] == "Hong Kong"


def test_venue_without_country_code_is_skipped() -> None:
    from app.services.eventbrite_venue import eventbrite_venue_body

    instance = _workshop()
    instance.location = _Location(_Area("district", "Island"))

    assert eventbrite_venue_body(instance) is None
