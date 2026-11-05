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

UNKNOWN_STATUS_NOTICE = "Eventbrite event status was missing, so publish was skipped."
_UNPUBLISH_FALLBACK = "Eventbrite rejected the request."


class UnpublishRejected(Exception):
    """Eventbrite refused to unpublish. The listing stays published."""


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


def is_closed_remote(remote_status: str) -> bool:
    return remote_status.strip().lower() in _CLOSED_REMOTE


def eventbrite_error_detail(message: str) -> str:
    """Return the Eventbrite sentence from an API error, or the whole message."""
    text = message.strip()
    marker = "): "
    index = text.rfind(marker)
    if index != -1:
        text = text[index + len(marker) :].strip()
    return text or _UNPUBLISH_FALLBACK


def unpublish_notice(instance_status: Any, eventbrite_message: str) -> str:
    detail = eventbrite_error_detail(eventbrite_message)
    lead = f"Eventbrite would not unpublish this event: {detail}"
    if instance_status == InstanceStatus.COMPLETED:
        return f"{lead} A paid event can be unpublished after it is paid out."
    return f"{lead} The listing stays published until this is handled in Eventbrite."


def closed_event_notice(remote_status: str) -> str:
    status = remote_status.strip().lower()
    return (
        f"Eventbrite event is {status} and cannot be published again. "
        "A new Eventbrite event is required."
    )


def closed_remote_notice(instance_status: Any, remote_status: str) -> str:
    if instance_status in _WANTS_PUBLIC:
        return closed_event_notice(remote_status)
    status = remote_status.strip().lower() or "closed"
    return f"Eventbrite event is {status}, so this sync left it unchanged."


def notice_for_closed_remote(
    *,
    instance_status: Any,
    remote_status: str,
    event_id: str,
) -> str:
    """Notice for a remote event that can no longer be edited."""
    notice = closed_remote_notice(instance_status, remote_status)
    logger.warning(
        "Eventbrite event is closed, so updates were skipped",
        extra={
            "event_id": event_id,
            "remote_status": remote_status.strip().lower(),
        },
    )
    return notice


def guard_unpublish(call: Callable[[str, str], Any]) -> Callable[[str, str], Any]:
    """Turn a 400 from unpublish into UnpublishRejected. Other errors pass through."""

    def _call(method: str, path: str) -> Any:
        from app.services.eventbrite_sync import EventbriteSyncError

        try:
            return call(method, path)
        except EventbriteSyncError as exc:
            if path.endswith("/unpublish/") and "(400)" in str(exc):
                raise UnpublishRejected(str(exc)) from exc
            raise

    return _call


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
        except UnpublishRejected as exc:
            detail = eventbrite_error_detail(str(exc))
            logger.warning(
                "Eventbrite unpublish was rejected",
                extra={"event_id": event_id, "eventbrite_message": detail},
            )
            return unpublish_notice(instance_status, detail)
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
