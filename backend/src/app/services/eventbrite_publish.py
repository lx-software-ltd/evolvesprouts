"""Publish and unpublish decisions for an existing Eventbrite event."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.db.models import InstanceStatus
from app.utils.logging import get_logger

logger = get_logger(__name__)

_WANTS_PUBLIC = {InstanceStatus.OPEN, InstanceStatus.FULL}
_WANTS_HIDDEN = {InstanceStatus.CANCELLED, InstanceStatus.COMPLETED}
_PUBLIC_REMOTE = {"live", "started"}
_CLOSED_REMOTE = {"ended", "completed", "canceled"}

UNPUBLISH_NOTICE = (
    "Eventbrite would not unpublish this event because it has orders. "
    "Tickets stay on sale until this is handled in Eventbrite."
)
UNKNOWN_STATUS_NOTICE = "Eventbrite event status was missing, so publish was skipped."


class UnpublishRejected(Exception):
    """Eventbrite refused to unpublish. The listing stays on sale."""


def publish_action(instance_status: Any, remote_status: str) -> str:
    """Return publish, unpublish, closed, unknown, or none."""
    remote = remote_status.strip().lower()
    if instance_status in _WANTS_PUBLIC:
        if remote == "draft":
            return "publish"
        if remote in _PUBLIC_REMOTE:
            return "none"
        if remote in _CLOSED_REMOTE:
            return "closed"
        return "unknown"
    if instance_status in _WANTS_HIDDEN and remote in _PUBLIC_REMOTE:
        return "unpublish"
    return "none"


def closed_event_notice(remote_status: str) -> str:
    status = remote_status.strip().lower()
    return (
        f"Eventbrite event is {status} and cannot be published again. "
        "A new Eventbrite event is required."
    )


def apply_publish_state(
    *,
    instance_status: Any,
    remote_status: str,
    event_id: str,
    call: Callable[[str, str], Any],
) -> str | None:
    """Publish or unpublish when needed. Return a notice, or None."""
    action = publish_action(instance_status, remote_status)
    if action == "publish":
        call("POST", f"/events/{event_id}/publish/")
        return None
    if action == "unpublish":
        try:
            call("POST", f"/events/{event_id}/unpublish/")
        except UnpublishRejected:
            logger.warning(
                "Eventbrite unpublish was rejected",
                extra={"event_id": event_id},
            )
            return UNPUBLISH_NOTICE
        return None
    if action == "closed":
        logger.warning(
            "Eventbrite event cannot be published again",
            extra={"event_id": event_id, "remote_status": remote_status},
        )
        return closed_event_notice(remote_status)
    if action == "unknown":
        logger.warning(
            "Eventbrite event status was missing",
            extra={"event_id": event_id},
        )
        return UNKNOWN_STATUS_NOTICE
    return None
