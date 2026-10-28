"""Public feed and reservation rules for event instance status.

Scheduled events stay in admin and still block the venue calendar. They are
omitted from the public events feed and cannot be reserved. Scheduled
training courses stay public.
"""

from __future__ import annotations

from typing import Any

from app.db.models.enums import InstanceStatus, ServiceType

_BOOKABLE_EVENT_STATUSES = frozenset(
    {
        InstanceStatus.OPEN.value,
        InstanceStatus.FULL.value,
        InstanceStatus.IN_PROGRESS.value,
    }
)


def _enum_value(value: Any) -> str | None:
    if value is None:
        return None
    raw = getattr(value, "value", value)
    return str(raw)


def _service_type_value(instance: Any) -> str | None:
    service = getattr(instance, "service", None)
    return _enum_value(getattr(service, "service_type", None))


def include_on_public_calendar(instance: Any) -> bool:
    """Return whether a repository row may appear on the public calendar feed."""
    scheduled_event = (
        _service_type_value(instance) == ServiceType.EVENT.value
        and _enum_value(getattr(instance, "status", None))
        == InstanceStatus.SCHEDULED.value
    )
    return not scheduled_event


def event_instance_is_bookable(instance: Any) -> bool:
    """Event reservations require open, full, or in progress."""
    if _service_type_value(instance) != ServiceType.EVENT.value:
        return True
    return _enum_value(getattr(instance, "status", None)) in _BOOKABLE_EVENT_STATUSES
