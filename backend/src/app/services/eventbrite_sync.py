"""Eventbrite sync orchestration for service instances."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from hashlib import sha256
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.db.models import (
    EventbriteSyncStatus,
    InstanceStatus,
    ServiceDeliveryMode,
    ServiceType,
)
from app.db.repositories import ServiceInstanceRepository
from app.services.eventbrite_client import EventbriteApiError, eventbrite_request
from app.services.secrets import get_secret_json
from app.utils.logging import get_logger

logger = get_logger(__name__)

_DEFAULT_EVENTBRITE_API_BASE_URL = "https://www.eventbriteapi.com/v3"
_ENV_EVENTBRITE_DEFAULT_TIMEZONE = "EVENTBRITE_DEFAULT_TIMEZONE"
_DEFAULT_EVENTBRITE_TIMEZONE = "UTC"


class EventbriteSyncError(Exception):
    """Raised when Eventbrite sync cannot complete."""


@dataclass(frozen=True)
class _EventbriteConfig:
    token: str
    organization_id: str


def sync_instance_to_eventbrite(
    *,
    session: Session,
    instance_id: UUID,
) -> dict[str, Any]:
    """Create or update one Eventbrite event from a DB instance."""
    repository = ServiceInstanceRepository(session)
    instance = repository.get_by_id_with_details(instance_id)
    if instance is None:
        raise EventbriteSyncError("Instance not found")
    if instance.service is None:
        raise EventbriteSyncError("Instance service relation is missing")
    if instance.service.service_type != ServiceType.EVENT:
        raise EventbriteSyncError("Only event instances can be synced to Eventbrite")

    payload_hash = _compute_instance_hash(instance)
    if (
        instance.eventbrite_last_payload_hash == payload_hash
        and instance.eventbrite_sync_status == EventbriteSyncStatus.SYNCED
    ):
        return {
            "status": "noop",
            "event_id": instance.eventbrite_event_id,
            "reason": "payload_unchanged",
        }

    config = _load_config()
    instance.eventbrite_sync_status = EventbriteSyncStatus.SYNCING
    instance.eventbrite_last_error = None
    session.commit()

    try:
        if not instance.eventbrite_event_id:
            created_event_id, created_event_url = _create_event(instance, config=config)
            instance.eventbrite_event_id = created_event_id
            instance.eventbrite_event_url = created_event_url
            session.commit()

        if instance.eventbrite_event_id is None:
            raise EventbriteSyncError("Eventbrite event id is missing after create")

        _update_event(instance, config=config)
        ticket_map = _sync_ticket_classes(instance, config=config)
        _apply_publish_state(instance, config=config)

        instance.eventbrite_ticket_class_map = ticket_map
        instance.eventbrite_last_payload_hash = payload_hash
        instance.eventbrite_last_synced_at = datetime.now(UTC)
        instance.eventbrite_last_error = None
        instance.eventbrite_retry_count = 0
        instance.eventbrite_sync_status = EventbriteSyncStatus.SYNCED
        session.commit()
        logger.info(
            "Eventbrite sync succeeded",
            extra={
                "instance_id": str(instance_id),
                "eventbrite_event_id": instance.eventbrite_event_id,
            },
        )
        return {
            "status": "synced",
            "event_id": instance.eventbrite_event_id,
            "event_url": instance.eventbrite_event_url,
        }
    except Exception as exc:
        instance.eventbrite_sync_status = EventbriteSyncStatus.FAILED
        instance.eventbrite_last_error = str(exc)
        instance.eventbrite_retry_count = int(instance.eventbrite_retry_count or 0) + 1
        session.commit()
        logger.exception(
            "Eventbrite sync failed",
            extra={"instance_id": str(instance_id), "error": str(exc)},
        )
        raise


def _load_config() -> _EventbriteConfig:
    token = os.getenv("EVENTBRITE_API_TOKEN", "").strip()
    if not token:
        secret_arn = os.getenv("EVENTBRITE_TOKEN_SECRET_ARN", "").strip()
        if secret_arn:
            secret_payload = get_secret_json(secret_arn)
            token_candidate = str(secret_payload.get("token") or "").strip()
            if token_candidate:
                token = token_candidate
    organization_id = os.getenv("EVENTBRITE_ORGANIZATION_ID", "").strip()
    if not token or not organization_id:
        raise EventbriteSyncError("Eventbrite token and organization id are required")
    return _EventbriteConfig(token=token, organization_id=organization_id)


def _eventbrite_call(
    *,
    method: str,
    path: str,
    config: _EventbriteConfig,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base_url = _eventbrite_api_base_url()
    try:
        return eventbrite_request(
            method=method,
            base_url=base_url,
            path=path,
            token=config.token,
            payload=payload,
        )
    except EventbriteApiError as exc:
        raise EventbriteSyncError(str(exc)) from exc


def _event_url(event_id: str) -> str:
    public_base_url = os.getenv("EVENTBRITE_PUBLIC_BASE_URL", "").strip()
    if public_base_url:
        return f"{public_base_url.rstrip('/')}/e/{event_id}"
    return ""


def _create_event(
    instance: Any, *, config: _EventbriteConfig
) -> tuple[str, str | None]:
    body = {"event": _build_event_payload(instance)}
    response = _eventbrite_call(
        method="POST",
        path=f"/organizations/{config.organization_id}/events/",
        config=config,
        payload=body,
    )
    event_id = str(response.get("id") or "").strip()
    if not event_id:
        raise EventbriteSyncError("Eventbrite create event response missing id")
    return event_id, _extract_event_url(response)


def _update_event(instance: Any, *, config: _EventbriteConfig) -> None:
    event_id = str(instance.eventbrite_event_id or "").strip()
    if not event_id:
        raise EventbriteSyncError("Eventbrite event id is required for update")
    body = {"event": _build_event_payload(instance)}
    response = _eventbrite_call(
        method="POST",
        path=f"/events/{event_id}/",
        config=config,
        payload=body,
    )
    instance.eventbrite_event_url = (
        _extract_event_url(response) or instance.eventbrite_event_url
    )


def _sync_ticket_classes(instance: Any, *, config: _EventbriteConfig) -> dict[str, str]:
    event_id = str(instance.eventbrite_event_id or "").strip()
    if not event_id:
        raise EventbriteSyncError("Eventbrite event id is required for ticket sync")

    existing_map = dict(instance.eventbrite_ticket_class_map or {})
    next_map: dict[str, str] = {}
    for tier in sorted(instance.ticket_tiers, key=lambda row: row.sort_order):
        local_tier_id = str(tier.id)
        remote_ticket_class_id = existing_map.get(local_tier_id)
        ticket_body = {"ticket_class": _build_ticket_class_payload(tier)}
        if remote_ticket_class_id:
            _eventbrite_call(
                method="POST",
                path=f"/events/{event_id}/ticket_classes/{remote_ticket_class_id}/",
                config=config,
                payload=ticket_body,
            )
            next_map[local_tier_id] = remote_ticket_class_id
            continue

        created = _eventbrite_call(
            method="POST",
            path=f"/events/{event_id}/ticket_classes/",
            config=config,
            payload=ticket_body,
        )
        created_id = str(created.get("id") or "").strip()
        if not created_id:
            raise EventbriteSyncError("Ticket class create response missing id")
        next_map[local_tier_id] = created_id
    return next_map


def _apply_publish_state(instance: Any, *, config: _EventbriteConfig) -> None:
    event_id = str(instance.eventbrite_event_id or "").strip()
    if not event_id:
        raise EventbriteSyncError("Eventbrite event id is required for publish state")
    if instance.status in {InstanceStatus.OPEN, InstanceStatus.FULL}:
        _eventbrite_call(
            method="POST",
            path=f"/events/{event_id}/publish/",
            config=config,
        )
        return
    if instance.status in {InstanceStatus.CANCELLED, InstanceStatus.COMPLETED}:
        _eventbrite_call(
            method="POST",
            path=f"/events/{event_id}/unpublish/",
            config=config,
        )


def _build_event_payload(instance: Any) -> dict[str, Any]:
    ordered_slots = sorted(instance.session_slots, key=lambda item: item.sort_order)
    if not ordered_slots:
        raise EventbriteSyncError("Event instances require at least one session slot")
    first_slot = ordered_slots[0]
    last_slot = ordered_slots[-1]

    timezone_name = _eventbrite_timezone_name()
    currency = _resolve_currency(instance)
    title = (instance.title or instance.service.title or "").strip()
    if not title:
        raise EventbriteSyncError("Event title is required")
    description = (instance.description or instance.service.description or "").strip()
    if not description:
        description = title

    resolved_delivery_mode = instance.delivery_mode or instance.service.delivery_mode
    payload: dict[str, Any] = {
        "name": {"html": title},
        "description": {"html": description},
        "start": {
            "timezone": timezone_name,
            "utc": _format_eventbrite_utc(first_slot.starts_at),
        },
        "end": {
            "timezone": timezone_name,
            "utc": _format_eventbrite_utc(last_slot.ends_at),
        },
        "currency": currency,
        "online_event": resolved_delivery_mode == ServiceDeliveryMode.ONLINE,
        "listed": True,
    }
    return payload


def _build_ticket_class_payload(tier: Any) -> dict[str, Any]:
    is_free = _is_zero_or_less(tier.price)
    payload: dict[str, Any] = {
        "name": tier.name,
        "description": tier.description,
        "free": is_free,
        "quantity_total": int(tier.max_quantity)
        if tier.max_quantity is not None
        else None,
    }
    payload = {key: value for key, value in payload.items() if value is not None}
    if not is_free:
        amount = _decimal_to_minor_units(tier.price)
        payload["cost"] = f"{tier.currency.upper()},{amount}"
    return payload


def _extract_event_url(response: dict[str, Any]) -> str | None:
    for key in ("url", "vanity_url", "resource_uri"):
        raw = response.get(key)
        if isinstance(raw, str) and raw.strip():
            if key == "resource_uri":
                event_id = str(response.get("id") or "").strip()
                if event_id:
                    fallback_url = _event_url(event_id)
                    if fallback_url:
                        return fallback_url
                continue
            return raw.strip()
    return None


def _compute_instance_hash(instance: Any) -> str:
    payload = {
        "id": str(instance.id),
        "service_id": str(instance.service_id),
        "title": instance.title,
        "description": instance.description,
        "status": instance.status.value,
        "delivery_mode": instance.delivery_mode.value
        if instance.delivery_mode
        else None,
        "slots": [
            {
                "id": str(slot.id),
                "starts_at": slot.starts_at.astimezone(UTC).isoformat(),
                "ends_at": slot.ends_at.astimezone(UTC).isoformat(),
                "sort_order": slot.sort_order,
            }
            for slot in sorted(instance.session_slots, key=lambda row: row.sort_order)
        ],
        "tiers": [
            {
                "id": str(tier.id),
                "name": tier.name,
                "description": tier.description,
                "price": str(tier.price),
                "currency": tier.currency,
                "max_quantity": tier.max_quantity,
                "sort_order": tier.sort_order,
            }
            for tier in sorted(instance.ticket_tiers, key=lambda row: row.sort_order)
        ],
        "timezone": _eventbrite_timezone_name(),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256(encoded).hexdigest()


def _resolve_currency(instance: Any) -> str:
    if instance.ticket_tiers:
        first_currency = str(instance.ticket_tiers[0].currency or "").strip().upper()
        if len(first_currency) == 3:
            return first_currency
    fallback = os.getenv("EVENTBRITE_DEFAULT_CURRENCY", "").strip().upper()
    if len(fallback) == 3:
        return fallback
    raise EventbriteSyncError(
        "Eventbrite currency is required in ticket tiers or EVENTBRITE_DEFAULT_CURRENCY"
    )


def _eventbrite_api_base_url() -> str:
    return os.getenv(
        "EVENTBRITE_API_BASE_URL", _DEFAULT_EVENTBRITE_API_BASE_URL
    ).strip()


def _format_eventbrite_utc(value: datetime) -> str:
    """Format an instant as Eventbrite ``YYYY-MM-DDThh:mm:ssZ``."""
    if value.tzinfo is None:
        raise EventbriteSyncError("Event session times must include a timezone")
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _eventbrite_timezone_name() -> str:
    """IANA timezone Eventbrite should display.

    Unset, invalid, and ``Etc/`` zones use ``UTC``. A bad value is logged
    and does not fail the sync.
    """
    configured = os.getenv(_ENV_EVENTBRITE_DEFAULT_TIMEZONE, "").strip()
    if not configured:
        return _DEFAULT_EVENTBRITE_TIMEZONE
    if _is_eventbrite_timezone(configured):
        return configured
    logger.warning(
        "Invalid Eventbrite timezone, using UTC",
        extra={
            "env": _ENV_EVENTBRITE_DEFAULT_TIMEZONE,
            "zone_id": configured,
        },
    )
    return _DEFAULT_EVENTBRITE_TIMEZONE


def _is_eventbrite_timezone(zone_id: str) -> bool:
    """True for ``UTC`` or an area/location IANA name Eventbrite can store."""
    if zone_id != "UTC" and (zone_id.startswith("Etc/") or "/" not in zone_id):
        return False
    try:
        ZoneInfo(zone_id)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def _decimal_to_minor_units(value: Decimal) -> int:
    return int((value * Decimal("100")).quantize(Decimal("1")))


def _is_zero_or_less(value: Decimal) -> bool:
    return value <= Decimal("0")
