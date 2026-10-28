"""Public calendar and reservation visibility for event instance status."""

from __future__ import annotations

from types import SimpleNamespace

from app.api.public_event_visibility import (
    event_instance_is_bookable,
    include_on_public_calendar,
)
from app.db.models.enums import InstanceStatus, ServiceType


def _row(service_type: ServiceType, status: InstanceStatus) -> SimpleNamespace:
    return SimpleNamespace(
        status=status,
        service=SimpleNamespace(service_type=service_type),
    )


def test_scheduled_event_is_hidden_and_not_bookable() -> None:
    row = _row(ServiceType.EVENT, InstanceStatus.SCHEDULED)
    assert include_on_public_calendar(row) is False
    assert event_instance_is_bookable(row) is False


def test_open_full_and_in_progress_events_stay_public() -> None:
    for status in (
        InstanceStatus.OPEN,
        InstanceStatus.FULL,
        InstanceStatus.IN_PROGRESS,
    ):
        row = _row(ServiceType.EVENT, status)
        assert include_on_public_calendar(row) is True
        assert event_instance_is_bookable(row) is True


def test_cancelled_and_completed_events_are_not_bookable() -> None:
    for status in (InstanceStatus.CANCELLED, InstanceStatus.COMPLETED):
        row = _row(ServiceType.EVENT, status)
        assert include_on_public_calendar(row) is True
        assert event_instance_is_bookable(row) is False


def test_scheduled_training_course_stays_public_and_bookable() -> None:
    row = _row(ServiceType.TRAINING_COURSE, InstanceStatus.SCHEDULED)
    assert include_on_public_calendar(row) is True
    assert event_instance_is_bookable(row) is True


def test_string_valued_service_type_matches_repository_stubs() -> None:
    row = SimpleNamespace(
        status=SimpleNamespace(value="open"),
        service=SimpleNamespace(service_type=SimpleNamespace(value="event")),
    )
    assert include_on_public_calendar(row) is True
    assert event_instance_is_bookable(row) is True
