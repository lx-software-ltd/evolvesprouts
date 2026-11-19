"""Turn one Meta webhook entry into Direct-message events.

Live Instagram Login and Page deliveries use ``entry.messaging``. The App
Dashboard test button, and some Page subscriptions, use ``entry.changes``.
A change may put the event on ``value`` or under ``value.messaging``. Page
replies use ``field`` ``message_echoes``. Standby uses ``entry.standby``.
Comment, mention, and feed changes are not messages.

Each event is returned with a flag. When the flag is false, storing the
message must not open a contact or sales lead for a thread that does not
exist yet. ``message_echoes`` uses that flag. ``entry.messaging`` echoes
do not.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

_MESSAGE_FIELDS = frozenset({"messages"})
_ECHO_FIELDS = frozenset({"message_echoes"})
_MAX_FIELD_NAME_LENGTH = 64

MessagingEvent = tuple[Mapping[str, Any], bool]


def collect_messaging_events(
    entry: Mapping[str, Any],
) -> tuple[list[MessagingEvent], list[str]]:
    """Return ``(event, open_crm_if_new)`` pairs and ignored change field names.

    Nested ``value.messaging`` is expanded before the ``messages`` and
    ``message_echoes`` branches, so a wrapper object is not stored as the
    event. ``message_echoes`` is forced outbound and does not open CRM for
    a new thread. Feed, comment, and mention names are ignored.
    """
    events: list[MessagingEvent] = [
        (event, True) for event in _as_list(entry.get("messaging"))
    ]
    events.extend((event, True) for event in _as_list(entry.get("standby")))
    ignored: list[str] = []
    for change in _as_list(entry.get("changes")):
        field_name = _field_name(change.get("field"))
        value = change.get("value")
        if not isinstance(value, Mapping):
            if field_name:
                ignored.append(field_name)
            continue
        open_crm_if_new = field_name not in _ECHO_FIELDS
        nested = _as_list(value.get("messaging"))
        if nested:
            events.extend(
                (
                    _echo_event(event) if not open_crm_if_new else event,
                    open_crm_if_new,
                )
                for event in nested
            )
            continue
        if field_name in _ECHO_FIELDS:
            events.append((_echo_event(value), False))
            continue
        if field_name in _MESSAGE_FIELDS:
            events.append((value, True))
            continue
        if field_name:
            ignored.append(field_name)
    return events, ignored


def _echo_event(value: Mapping[str, Any]) -> dict[str, Any]:
    message = value.get("message")
    if isinstance(message, Mapping) and message.get("is_echo"):
        return dict(value)
    echoed = dict(message) if isinstance(message, Mapping) else {}
    echoed["is_echo"] = True
    copied = dict(value)
    copied["message"] = echoed
    return copied


def _field_name(raw_value: Any) -> str:
    if not isinstance(raw_value, str):
        return ""
    name = raw_value.strip()
    if not name:
        return ""
    return name[:_MAX_FIELD_NAME_LENGTH]


def _as_list(value: Any) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]
