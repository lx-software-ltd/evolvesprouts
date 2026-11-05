"""Publish decisions for an event that already exists on Eventbrite."""

from __future__ import annotations

from typing import Any

import pytest
from app.db.models import InstanceStatus
from app.services import eventbrite_publish
from app.services.eventbrite_publish import (
    UNKNOWN_STATUS_NOTICE,
    closed_event_notice,
    closed_remote_notice,
    publish_action,
    unpublish_notice,
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


@pytest.mark.parametrize(
    ("instance_status", "detail", "tail"),
    [
        (
            InstanceStatus.CANCELLED,
            "You cannot unpublish this event.",
            "The listing stays published until this is handled in Eventbrite.",
        ),
        (
            InstanceStatus.COMPLETED,
            "This event has not been paid out.",
            "A paid event can be unpublished after it is paid out.",
        ),
    ],
)
def test_rejected_unpublish_stays_synced_and_quotes_eventbrite(
    monkeypatch: Any,
    instance_status: InstanceStatus,
    detail: str,
    tail: str,
) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.status = instance_status
    instance.eventbrite_event_id = "1001"
    message = f"Eventbrite API request failed (400): {detail}"
    calls = _install_sync_fakes(
        monkeypatch,
        instance,
        remote_status="live",
        fail_paths={"/unpublish/": EventbriteSyncError(message)},
    )
    warnings: list[dict[str, Any]] = []
    monkeypatch.setattr(
        eventbrite_publish.logger,
        "warning",
        lambda *_args, **kwargs: warnings.append(kwargs.get("extra") or {}),
    )

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert instance.eventbrite_sync_status.value == "synced"
    assert instance.eventbrite_retry_count == 0
    assert instance.eventbrite_last_error == unpublish_notice(instance_status, message)
    assert instance.eventbrite_last_error is not None
    assert detail in instance.eventbrite_last_error
    assert tail in instance.eventbrite_last_error
    assert "tickets stay on sale" not in instance.eventbrite_last_error
    assert instance.eventbrite_last_payload_hash
    assert warnings[0]["eventbrite_message"] == detail
    assert "/events/1001/unpublish/" in [call["path"] for call in calls]


def test_unpublish_server_error_fails_the_sync(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.status = InstanceStatus.CANCELLED
    instance.eventbrite_event_id = "1001"
    message = "Eventbrite API request failed (500): unavailable"
    _install_sync_fakes(
        monkeypatch,
        instance,
        remote_status="live",
        fail_paths={"/unpublish/": EventbriteSyncError(message)},
    )

    with pytest.raises(EventbriteSyncError, match="500"):
        sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert instance.eventbrite_sync_status.value == "failed"
    assert instance.eventbrite_retry_count == 1
    assert instance.eventbrite_last_error == message


def test_closed_remote_event_is_left_unchanged(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.eventbrite_event_id = "1001"
    instance.eventbrite_ticket_class_map = {"tier": "9009"}
    calls = _install_sync_fakes(monkeypatch, instance, remote_status="canceled")

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert [call["path"] for call in calls] == ["/events/1001/"]
    assert instance.eventbrite_last_error == closed_event_notice("canceled")
    assert instance.eventbrite_ticket_class_map == {"tier": "9009"}
    assert instance.eventbrite_retry_count == 0
    assert instance.eventbrite_last_payload_hash

    calls.clear()
    second = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)
    assert second["status"] == "noop"
    assert calls == []


def test_closed_hidden_event_does_not_ask_for_a_new_listing(
    monkeypatch: Any,
) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.status = InstanceStatus.CANCELLED
    instance.eventbrite_event_id = "1001"
    calls = _install_sync_fakes(monkeypatch, instance, remote_status="ended")

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert [call["path"] for call in calls] == ["/events/1001/"]
    notice = closed_remote_notice(InstanceStatus.CANCELLED, "ended")
    assert instance.eventbrite_last_error == notice
    assert "new Eventbrite event" not in notice


def test_missing_remote_status_skips_publish(monkeypatch: Any) -> None:
    monkeypatch.setenv("EVENTBRITE_DEFAULT_TIMEZONE", "UTC")
    instance = _workshop()
    instance.eventbrite_event_id = "1001"
    calls = _install_sync_fakes(monkeypatch, instance, remote_status="  ")

    result = sync_instance_to_eventbrite(session=_Session(), instance_id=instance.id)

    assert result["status"] == "synced"
    assert "/events/1001/publish/" not in [call["path"] for call in calls]
    assert "/events/1001/ticket_classes/" in [call["path"] for call in calls]
    assert instance.eventbrite_last_error == UNKNOWN_STATUS_NOTICE
