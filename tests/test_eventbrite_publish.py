"""Publish decisions for an event that already exists on Eventbrite."""

from __future__ import annotations

from typing import Any

import pytest
from app.db.models import InstanceStatus
from app.services.eventbrite_publish import (
    UNKNOWN_STATUS_NOTICE,
    UNPUBLISH_NOTICE,
    closed_event_notice,
    publish_action,
)
from app.services.eventbrite_sync import (
    EventbriteSyncError,
    sync_instance_to_eventbrite,
)

from tests.eventbrite_sync_fakes import _install_sync_fakes, _Session, _workshop


@pytest.mark.parametrize(
    ("instance_status", "remote_status", "action"),
    [
        (InstanceStatus.OPEN, "draft", "publish"),
        (InstanceStatus.FULL, "draft", "publish"),
        (InstanceStatus.OPEN, "live", "none"),
        (InstanceStatus.OPEN, "started", "none"),
        (InstanceStatus.OPEN, "canceled", "closed"),
        (InstanceStatus.OPEN, "ended", "closed"),
        (InstanceStatus.OPEN, "completed", "closed"),
        (InstanceStatus.OPEN, "", "unknown"),
        (InstanceStatus.CANCELLED, "live", "unpublish"),
        (InstanceStatus.COMPLETED, "started", "unpublish"),
        (InstanceStatus.CANCELLED, "draft", "none"),
        (InstanceStatus.SCHEDULED, "draft", "none"),
        (InstanceStatus.IN_PROGRESS, "live", "none"),
    ],
)
def test_publish_action(
    instance_status: InstanceStatus,
    remote_status: str,
    action: str,
) -> None:
    assert publish_action(instance_status, remote_status) == action


def test_live_event_is_updated_without_publish(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.eventbrite_event_id = "1001"
    calls = _install_sync_fakes(monkeypatch, instance, remote_status="live")

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert instance.eventbrite_last_error is None
    assert instance.eventbrite_sync_status.value == "synced"
    assert "/events/1001/publish/" not in [call["path"] for call in calls]
    assert calls[0]["method"] == "GET"
    assert calls[0]["path"] == "/events/1001/"


def test_cancelled_live_event_is_unpublished(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.status = InstanceStatus.CANCELLED
    instance.eventbrite_event_id = "1001"
    calls = _install_sync_fakes(monkeypatch, instance, remote_status="live")

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert [call["path"] for call in calls].count("/events/1001/unpublish/") == 1
    assert instance.eventbrite_last_error is None


def test_unpublish_rejected_for_orders_stays_synced(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.status = InstanceStatus.CANCELLED
    instance.eventbrite_event_id = "1001"
    calls = _install_sync_fakes(monkeypatch, instance, remote_status="live")
    installed = calls

    def _request(**kwargs: Any) -> dict[str, Any]:
        installed.append(kwargs)
        if str(kwargs["path"]).endswith("/unpublish/"):
            raise EventbriteSyncError(
                "Eventbrite API request failed (400): orders exist"
            )
        return {
            "id": "1001",
            "status": "live",
            "url": "https://www.eventbrite.com/e/1001",
        }

    from app.services import eventbrite_sync

    monkeypatch.setattr(eventbrite_sync, "eventbrite_request", _request)
    calls.clear()

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert instance.eventbrite_sync_status.value == "synced"
    assert instance.eventbrite_retry_count == 0
    assert instance.eventbrite_last_error == UNPUBLISH_NOTICE
    assert instance.eventbrite_last_payload_hash


def test_closed_remote_event_is_not_republished(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.eventbrite_event_id = "1001"
    calls = _install_sync_fakes(monkeypatch, instance, remote_status="canceled")

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert "/events/1001/publish/" not in [call["path"] for call in calls]
    assert instance.eventbrite_last_error == closed_event_notice("canceled")
    assert instance.eventbrite_retry_count == 0


def test_missing_remote_status_skips_publish(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.eventbrite_event_id = "1001"
    calls = _install_sync_fakes(monkeypatch, instance, remote_status="  ")

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert "/events/1001/publish/" not in [call["path"] for call in calls]
    assert instance.eventbrite_last_error == UNKNOWN_STATUS_NOTICE
