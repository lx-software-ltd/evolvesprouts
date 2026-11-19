"""Turn one Meta webhook entry into Direct-message events."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

_MESSAGE_FIELDS = frozenset({"messages"})
_ECHO_FIELDS = frozenset({"message_echoes"})
_MAX_FIELD_NAME_LENGTH = 64


def collect_messaging_events(
    entry: Mapping[str, Any],
) -> tuple[list[Mapping[str, Any]], list[str]]:
    """Return DM events and change field names that are not Direct messages.

    ``messages`` and ``message_echoes`` put the event on ``value``.
    ``message_echoes`` is forced outbound. Feed, comment, and mention
    changes are named in the ignored list and are not returned.
    """
    events = list(_as_list(entry.get("messaging")))
    events.extend(_as_list(entry.get("standby")))
    ignored: list[str] = []
    for change in _as_list(entry.get("changes")):
        field_name = _field_name(change.get("field"))
        value = change.get("value")
        if not isinstance(value, Mapping):
            if field_name:
                ignored.append(field_name)
            continue
        if field_name in _ECHO_FIELDS:
            events.append(_echo_event(value))
            continue
        if field_name in _MESSAGE_FIELDS:
            events.append(value)
            continue
        nested = _as_list(value.get("messaging"))
        if nested:
            events.extend(nested)
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
