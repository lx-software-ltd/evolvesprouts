"""Public calendar events feed handlers.

GET responses for routes reachable via the public website CloudFront ``/www/*``
proxy must include a ``Cache-Control`` header: use a shared-cache friendly value
on success (200) and ``no-store`` on errors (for example 405) so CloudFront never
retains unsafe responses. Any new allowlisted GET handler must follow the same
contract.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.instance_capacity import compute_capacity_left_effective
from app.db.engine import get_engine
from app.db.models import Service, ServiceInstance
from app.db.models.enums import InstanceStatus, ServiceType
from app.db.models.service_instance import InstanceSessionSlot
from app.db.repositories.service_instance import ServiceInstanceRepository

if TYPE_CHECKING:
    from app.db.models.location import Location
from app.utils import (
    CACHE_CONTROL_NO_STORE,
    method_not_allowed,
    public_cacheable_json_response,
)
from app.utils.logging import get_logger
from app.utils.maps import build_google_maps_directions_url
from app.utils.public_slug import PUBLIC_INSTANCE_SLUG_PATTERN

logger = get_logger(__name__)

_MBA_TRAINING_SERVICE_KEY = "my-best-auntie-training-course"
_LEGACY_MBA_SERVICE_SLUG = (
    "my-best-auntie"  # old public filter value; normalized in _parse_service_key only
)

_SERVICE_KEY_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_PUBLIC_INSTANCE_SLUG_MAX_LEN = 128  # matches service_instances.slug varchar(128)
_SERVICE_KEY_MAX_LEN = 80  # matches services.service_key varchar(80)


def handle_public_events(
    event: Mapping[str, Any],
    method: str,
) -> dict[str, Any]:
    """Handle GET /v1/calendar/public and /www/v1/calendar/public."""
    if method != "GET":
        logger.info(
            "Handling public events feed request",
            extra={"method": method},
        )
        return method_not_allowed(
            event, headers={"Cache-Control": CACHE_CONTROL_NO_STORE}
        )

    query = event.get("queryStringParameters") or {}
    slug = _parse_public_instance_slug(query.get("slug"))
    service_types = _parse_service_type_filter(query.get("service_type"))
    service_key = _parse_service_key(query.get("service_key"))

    logger.info(
        "Handling public events feed request",
        extra={
            "method": method,
            "filter.service_type": (
                sorted(t.value for t in service_types)
                if service_types is not None
                else None
            ),
            "filter.slug": slug,
            "filter.service_key": service_key,
        },
    )

    with Session(get_engine()) as session:
        repository = ServiceInstanceRepository(session)
        items = _fetch_public_offerings(
            repository,
            now=datetime.now(UTC),
            service_types=service_types,
            slug=slug,
            service_key=service_key,
        )
    # Keep a temporary alias for older consumers while "events" is canonical.
    return public_cacheable_json_response(
        200, {"events": items, "items": items}, event=event
    )


def _parse_public_instance_slug(raw: str | None) -> str | None:
    if raw is None:
        return None
    trimmed = raw.strip()
    if not trimmed or len(trimmed) > _PUBLIC_INSTANCE_SLUG_MAX_LEN:
        return None
    normalized = trimmed.lower()
    if not PUBLIC_INSTANCE_SLUG_PATTERN.fullmatch(normalized):
        return None
    return normalized


def _parse_service_type_filter(raw: str | None) -> set[ServiceType] | None:
    if raw is None:
        return None
    if raw == "event":
        return {ServiceType.EVENT}
    if raw == "training_course":
        return {ServiceType.TRAINING_COURSE}
    return None


def _parse_service_key(raw: str | None) -> str | None:
    """Normalize and validate the `service_key` query parameter.

    Returns a lowercase key ready for comparison against ``lower(services.service_key)``
    in the repository, or None when input is missing, blank, too long, or
    malformed. Trims whitespace, then lowercases before pattern validation so
    mixed-case slugs are accepted. Follows the silent-ignore policy used for
    other public calendar query parameters.
    """
    if raw is None:
        return None
    trimmed = raw.strip()
    if not trimmed or len(trimmed) > _SERVICE_KEY_MAX_LEN:
        return None
    # Lowercase before pattern match so mixed-case input (e.g. MY-BEST-AUNTIE)
    # is accepted; the OpenAPI pattern is lowercase-only.
    normalized = trimmed.lower()
    if normalized == _LEGACY_MBA_SERVICE_SLUG:
        normalized = _MBA_TRAINING_SERVICE_KEY
    if not _SERVICE_KEY_PATTERN.fullmatch(normalized):
        return None
    return normalized


def _fetch_public_offerings(
    repository: ServiceInstanceRepository,
    *,
    now: datetime,
    service_types: set[ServiceType] | None,
    slug: str | None,
    service_key: str | None,
) -> list[dict[str, Any]]:
    rows = repository.list_public_offerings(
        limit=100,
        now=now,
        service_types=service_types,
        slug=slug,
        service_key=service_key,
    )
    capacity_instance_ids = [row.id for row in rows if row.max_capacity is not None]
    enrollment_counts = repository.get_enrollment_counts_for_instances(
        capacity_instance_ids
    )
    out: list[dict[str, Any]] = []
    for instance in rows:
        raw_slug = instance.slug
        slug = (raw_slug or "").strip()
        if not slug or not PUBLIC_INSTANCE_SLUG_PATTERN.fullmatch(slug):
            logger.warning(
                "Public calendar feed skipped instance without valid slug",
                extra={"instance_id": str(instance.id)},
            )
            continue
        out.append(
            _serialize_public_event(instance, enrollment_counts=enrollment_counts)
        )
    return out


def _resolve_primary_location(
    instance: ServiceInstance,
    slots: list[InstanceSessionSlot],
) -> Location | None:
    if slots and slots[0].location is not None:
        return slots[0].location
    if instance.location is not None:
        return instance.location
    # Public calendar query eagerly loads ``instance.service`` (and ``Service.location``).
    service = getattr(instance, "service", None)
    if service is None:
        return None
    return service.location


def _resolve_primary_price(
    instance: ServiceInstance,
) -> tuple[int | None, str | None]:
    # Consultation is not returned by list_public_offerings; if serialized elsewhere,
    # price/currency are intentionally omitted (no training_details / ticket path).
    service = instance.service
    if service.service_type == ServiceType.EVENT:
        if instance.ticket_tiers:
            sorted_tiers = sorted(
                instance.ticket_tiers,
                key=lambda tier: (tier.sort_order, tier.created_at, tier.id),
            )
            selected = sorted_tiers[0]
            return _decimal_to_int_price(selected.price), selected.currency
        details = service.event_details
        if details is not None and details.default_price is not None:
            return _decimal_to_int_price(
                details.default_price
            ), details.default_currency
        return None, None
    if service.service_type == ServiceType.TRAINING_COURSE:
        td = instance.training_details
        if td is not None:
            return _decimal_to_int_price(td.price), td.currency
        return None, None
    return None, None


def _resolve_booking_system(service: Service) -> str | None:
    if service.booking_system:
        return service.booking_system
    if service.service_type == ServiceType.EVENT:
        return "event-booking"
    if service.service_type == ServiceType.TRAINING_COURSE:
        key = (service.service_key or "").strip().lower()
        if key == _MBA_TRAINING_SERVICE_KEY:
            return "my-best-auntie-booking"
        return None
    return None


def _resolve_categories(service: Service) -> list[str]:
    if service.service_type == ServiceType.EVENT:
        details = service.event_details
        if details is not None:
            return [details.event_category.value]
        return []
    if service.service_type == ServiceType.TRAINING_COURSE:
        return ["Training Course"]
    return []


def _resolve_tags(
    instance: ServiceInstance,
    *,
    service_tier: str | None = None,
) -> list[str]:
    links = instance.instance_tags
    names = {link.tag.name for link in links if link.tag and link.tag.name}
    tier = (service_tier or "").strip()
    if tier:
        names.add(tier)
    return sorted(names, key=str.casefold)


def _resolve_partners(instance: ServiceInstance) -> list[str]:
    return [
        link.organization.partner_key
        for link in instance.partner_organization_links
        if link.organization is not None and link.organization.partner_key
    ]


def _partner_display_name_for_location(
    instance: ServiceInstance,
    location: Location,
) -> str | None:
    """Partner org display name when ``location`` is that partner's CRM location."""
    loc_id = getattr(location, "id", None)
    if loc_id is None:
        return None
    for link in instance.partner_organization_links:
        org = link.organization
        if org is None or org.location_id is None:
            continue
        if org.location_id != loc_id:
            continue
        label = _clean_text(org.name)
        if label is not None:
            return label
    return None


def _resolve_external_url(instance: ServiceInstance) -> str | None:
    return instance.external_url or instance.eventbrite_event_url or None


def _derive_training_service_tier_from_instance_slug(
    instance_slug: str | None,
    service_key: str | None,
) -> str | None:
    """Infer age tier from instance slug when parent ``services.service_tier`` is unset."""
    if not instance_slug:
        return None
    key = (service_key or "").strip().lower()
    if key != _MBA_TRAINING_SERVICE_KEY:
        return None
    prefix = "my-best-auntie-"
    if not instance_slug.startswith(prefix):
        return None
    rest = instance_slug[len(prefix) :]
    for tier in ("0-1", "1-3", "3-6"):
        if rest.startswith(f"{tier}-"):
            return tier
    return None


def _resolve_public_calendar_service_tier(instance: ServiceInstance) -> str | None:
    service = instance.service
    if service.service_tier is not None:
        return service.service_tier
    return _derive_training_service_tier_from_instance_slug(
        instance.slug,
        getattr(service, "service_key", None),
    )


def _format_cohort_code_for_public_title(cohort: str) -> str:
    """Turn a hyphenated cohort code into title words (e.g. ``may-26`` -> ``May 26``)."""
    parts = [p.strip() for p in cohort.split("-") if p.strip()]
    if not parts:
        return cohort.strip()
    return " ".join(p.capitalize() for p in parts)


def _build_public_calendar_display_title(
    base_title: str | None,
    *,
    service_tier: str | None,
    cohort: str | None,
) -> str:
    """Append ``{tier} - {cohort}`` to the base title when both tier and cohort are set."""
    base = (base_title or "").strip()
    tier = (service_tier or "").strip()
    raw_cohort = (cohort or "").strip()
    if not tier or not raw_cohort:
        return base
    cohort_display = _format_cohort_code_for_public_title(raw_cohort)
    suffix = f"{tier} - {cohort_display}"
    return f"{base} {suffix}".strip() if base else suffix


def _serialize_public_event(
    instance: ServiceInstance,
    *,
    enrollment_counts: dict[UUID, int],
) -> dict[str, Any]:
    service = instance.service
    base_title = instance.title or service.title
    service_tier = _resolve_public_calendar_service_tier(instance)
    title = _build_public_calendar_display_title(
        base_title,
        service_tier=service_tier,
        cohort=instance.cohort,
    )
    summary = instance.description or service.description

    slots = sorted(instance.session_slots, key=lambda s: (s.sort_order, s.starts_at))
    dates = [
        {
            "part": idx + 1,
            "start_datetime": _iso(s.starts_at),
            "end_datetime": _iso(s.ends_at),
        }
        for idx, s in enumerate(slots)
    ]

    primary_location = _resolve_primary_location(instance, slots)
    is_virtual = _is_virtual_delivery_mode(instance, service)

    location_name = (
        None
        if is_virtual
        else _clean_text(primary_location.name if primary_location else None)
    )
    if not is_virtual and primary_location is not None and location_name is None:
        partner_label = _partner_display_name_for_location(instance, primary_location)
        if partner_label is not None:
            location_name = partner_label
    location_address = (
        None
        if is_virtual
        else _clean_text(primary_location.address if primary_location else None)
    )
    location_url = ""
    if not is_virtual and primary_location is not None:
        derived = build_google_maps_directions_url(
            address=primary_location.address,
            lat=primary_location.lat,
            lng=primary_location.lng,
        )
        if derived is not None:
            location_url = derived

    price, currency = _resolve_primary_price(instance)
    booking_status = (
        "fully_booked" if instance.status == InstanceStatus.FULL else "open"
    )

    slug = instance.slug.strip()
    if not slug or not PUBLIC_INSTANCE_SLUG_PATTERN.fullmatch(slug):
        raise ValueError(
            "Public calendar serialization requires a non-empty slug matching "
            "the public slug pattern (caller must filter slug-less rows)."
        )

    payload: dict[str, Any] = {
        "slug": slug,
        "service_type": service.service_type.value,
        "service_key": service.service_key,
        "title": title,
        "summary": summary,
        "description": summary,
        "status": _map_instance_status(instance.status),
        "booking_status": booking_status,
        "is_fully_booked": booking_status == "fully_booked",
        "location": "virtual" if is_virtual else "physical",
        "location_name": location_name,
        "location_address": location_address,
        "location_url": location_url,
        "dates": dates,
        "tags": _resolve_tags(instance, service_tier=service_tier),
        "categories": _resolve_categories(service),
        "partners": _resolve_partners(instance),
    }

    booking_system = _resolve_booking_system(service)
    if booking_system is not None:
        payload["booking_system"] = booking_system

    if price is not None:
        payload["price"] = price
    if currency is not None:
        payload["currency"] = currency

    external_url = _resolve_external_url(instance)
    if external_url:
        payload["external_url"] = external_url

    payload["service_tier"] = service_tier
    if instance.cohort is not None:
        payload["cohort"] = instance.cohort

    if instance.max_capacity is not None:
        filled = enrollment_counts.get(instance.id, 0)
        payload["spaces_total"] = instance.max_capacity
        payload["spaces_left"] = compute_capacity_left_effective(
            max_capacity=instance.max_capacity,
            capacity_enrolled_count=filled,
            capacity_left_override=instance.capacity_left_override,
        )

    return payload


def _decimal_to_int_price(value: Decimal | None) -> int | None:
    if value is None:
        return None
    quantized = value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(quantized)


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _map_instance_status(status: InstanceStatus) -> str:
    if status == InstanceStatus.CANCELLED:
        return "cancelled"
    if status == InstanceStatus.COMPLETED:
        return "completed"
    return "open"


def _is_virtual_delivery_mode(instance: ServiceInstance, service: Service) -> bool:
    resolved = (
        instance.delivery_mode if instance.delivery_mode else service.delivery_mode
    )
    return resolved.value == "online"


def _iso(value: datetime | None) -> str:
    return value.isoformat() if value is not None else ""
