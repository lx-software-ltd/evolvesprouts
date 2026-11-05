"""Shared Eventbrite sync fakes for payload and logo tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from app.db.models import (
    EventbriteSyncStatus,
    InstanceStatus,
    ServiceDeliveryMode,
    ServiceType,
)
from app.services import eventbrite_sync


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


class _Session:
    def commit(self) -> None:
        return None


def _install_sync_fakes(
    monkeypatch: Any,
    instance: _Instance,
    *,
    remote_status: str = "draft",
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def _request(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        path = str(kwargs["path"])
        if path.startswith("/organizations/") and path.endswith("/events/"):
            return {
                "id": "1001",
                "url": "https://www.eventbrite.com/e/1001",
                "status": "draft",
            }
        if path.endswith("/ticket_classes/"):
            return {"id": "2002"}
        return {
            "id": "1001",
            "url": "https://www.eventbrite.com/e/1001",
            "status": remote_status,
        }

    monkeypatch.setenv("EVENTBRITE_API_TOKEN", "token-value")
    monkeypatch.setenv("EVENTBRITE_ORGANIZATION_ID", "org-1")
    monkeypatch.setattr(eventbrite_sync, "eventbrite_request", _request)
    monkeypatch.setattr(
        eventbrite_sync,
        "load_instance_for_eventbrite_sync",
        lambda _session, _instance_id: instance,
    )
    return calls
