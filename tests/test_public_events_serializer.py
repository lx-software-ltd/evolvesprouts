"""Unit tests for public calendar event serialization."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.api import public_events
from app.db.models.enums import InstanceStatus, ServiceType


def _tag_link(name: str) -> Any:
    return SimpleNamespace(tag=SimpleNamespace(name=name))


def _partner_link(partner_key: str, sort_order: int) -> Any:
    return SimpleNamespace(
        sort_order=sort_order,
        organization=SimpleNamespace(partner_key=partner_key),
    )


def test_event_ticket_tier_price_and_booking_system_default() -> None:
    service = SimpleNamespace(
        title="Svc",
        description="Desc",
        service_type=ServiceType.EVENT,
        service_key=None,
        booking_system=None,
        event_details=SimpleNamespace(
            event_category=SimpleNamespace(value="workshop"),
            default_price=Decimal("99"),
            default_currency="HKD",
        ),
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier=None,
        location=None,
    )
    starts = datetime(2026, 5, 1, 10, 0, tzinfo=UTC)
    ends = datetime(2026, 5, 1, 12, 0, tzinfo=UTC)
    loc = SimpleNamespace(name="Venue", address="1 Rd", lat=None, lng=None)
    inst = SimpleNamespace(
        id=uuid4(),
        slug="my-event",
        title=None,
        description=None,
        status=InstanceStatus.OPEN,
        max_capacity=None,
        external_url=None,
        eventbrite_event_url=None,
        cohort=None,
        delivery_mode=None,
        service=service,
        session_slots=[
            SimpleNamespace(
                id=uuid4(),
                sort_order=0,
                starts_at=starts,
                ends_at=ends,
                location=loc,
            )
        ],
        location=loc,
        ticket_tiers=[
            SimpleNamespace(
                id=uuid4(),
                sort_order=0,
                created_at=datetime(2026, 1, 1, tzinfo=UTC),
                price=Decimal("250.00"),
                currency="HKD",
            )
        ],
        instance_tags=[],
        partner_organization_links=[],
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert "id" not in out
    assert "service_instance_id" not in out
    assert out["slug"] == "my-event"
    assert out["service_type"] == "event"
    assert "service_key" in out
    assert out["service_key"] is None
    assert out["booking_system"] == "event-booking"
    assert out["categories"] == ["workshop"]
    assert out["price"] == 250
    assert out["currency"] == "HKD"
    assert out["tags"] == []
    assert out["partners"] == []
    assert out["is_fully_booked"] is False


def test_event_default_price_when_no_tiers() -> None:
    service = SimpleNamespace(
        title="Svc",
        description="Desc",
        service_type=ServiceType.EVENT,
        service_key="x",
        booking_system=None,
        event_details=SimpleNamespace(
            event_category=SimpleNamespace(value="seminar"),
            default_price=Decimal("10.50"),
            default_currency="USD",
        ),
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier=None,
        location=None,
    )
    inst = _minimal_instance(service, ticket_tiers=[])
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["price"] == 11
    assert out["currency"] == "USD"
    assert "booking_system" in out


def test_event_no_price_when_no_tiers_and_no_default() -> None:
    service = SimpleNamespace(
        title="Svc",
        description="Desc",
        service_type=ServiceType.EVENT,
        service_key="x",
        booking_system=None,
        event_details=SimpleNamespace(
            event_category=SimpleNamespace(value="seminar"),
            default_price=None,
            default_currency="HKD",
        ),
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier=None,
        location=None,
    )
    inst = _minimal_instance(service, ticket_tiers=[])
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert "price" not in out
    assert "currency" not in out


def test_external_url_precedence() -> None:
    service = _event_service()
    inst = _minimal_instance(
        service,
        external_url="https://example.com/new",
        eventbrite_event_url="https://eventbrite.com/old",
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["external_url"] == "https://example.com/new"


def test_external_url_eventbrite_only() -> None:
    service = _event_service()
    inst = _minimal_instance(
        service,
        external_url=None,
        eventbrite_event_url="https://eventbrite.com/e/1",
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["external_url"] == "https://eventbrite.com/e/1"


def test_instance_tags_sorted_case_insensitive() -> None:
    service = _event_service()
    inst = _minimal_instance(
        service,
        instance_tags=[
            _tag_link("zebra"),
            _tag_link("Alpha"),
            _tag_link("beta"),
        ],
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["tags"] == ["Alpha", "beta", "zebra"]


def test_tags_include_service_tier_when_set() -> None:
    """Non-empty service_tier is merged into tags (sorted with instance tags)."""
    service = _event_service()
    service.service_tier = "premium"
    inst = _minimal_instance(
        service,
        instance_tags=[_tag_link("zebra"), _tag_link("Alpha")],
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["service_tier"] == "premium"
    assert out["tags"] == ["Alpha", "premium", "zebra"]


def test_serialized_event_includes_service_key_from_parent() -> None:
    """Calendar JSON always includes service_key (nullable) from parent service."""
    service = _event_service()
    service.service_key = "easter-workshops"
    inst = _minimal_instance(service)
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert "service_key" in out
    assert out["service_key"] == "easter-workshops"


def test_training_course_tags_dedupe_tier_with_instance_tags() -> None:
    service = SimpleNamespace(
        title="MBA",
        description="Course",
        service_type=ServiceType.TRAINING_COURSE,
        service_key="my-best-auntie-training-course",
        booking_system=None,
        event_details=None,
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier="0-1",
        location=None,
    )
    inst = _minimal_instance(
        service,
        cohort="May 2026",
        training_details=SimpleNamespace(price=Decimal("350"), currency="HKD"),
        instance_tags=[_tag_link("0-1"), _tag_link("other")],
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["tags"] == ["0-1", "other"]


def test_partners_follow_link_order() -> None:
    service = _event_service()
    inst = _minimal_instance(
        service,
        partner_organization_links=[
            _partner_link("first", 0),
            _partner_link("second", 1),
        ],
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["partners"] == ["first", "second"]


def test_training_mba_booking_and_category() -> None:
    service = SimpleNamespace(
        title="MBA",
        description="Course",
        service_type=ServiceType.TRAINING_COURSE,
        service_key="my-best-auntie-training-course",
        booking_system=None,
        event_details=None,
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier="0-1",
        location=None,
    )
    inst = _minimal_instance(
        service,
        cohort="May 2026",
        training_details=SimpleNamespace(price=Decimal("350"), currency="HKD"),
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["service_type"] == "training_course"
    assert out["service_key"] == "my-best-auntie-training-course"
    assert out["booking_system"] == "my-best-auntie-booking"
    assert out["categories"] == ["Training Course"]
    assert out["price"] == 350
    assert out["currency"] == "HKD"
    assert out["service_tier"] == "0-1"
    assert out["cohort"] == "May 2026"
    assert out["title"] == "MBA 0-1 - May 2026"
    assert out["tags"] == ["0-1"]


def test_public_calendar_title_appends_tier_and_formatted_cohort() -> None:
    """Title suffix uses tier, a spaced dash, and cohort segments capitalized."""
    service = SimpleNamespace(
        title="bla bla bla",
        description="Course",
        service_type=ServiceType.TRAINING_COURSE,
        service_key="my-best-auntie-training-course",
        booking_system=None,
        event_details=None,
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier="1-3",
        location=None,
    )
    inst = _minimal_instance(service, cohort="may-26")
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["title"] == "bla bla bla 1-3 - May 26"
    assert out["cohort"] == "may-26"
    assert out["tags"] == ["1-3"]


def test_public_calendar_title_unchanged_without_tier_or_cohort() -> None:
    service = SimpleNamespace(
        title="Only Base",
        description="Course",
        service_type=ServiceType.TRAINING_COURSE,
        service_key="my-best-auntie-training-course",
        booking_system=None,
        event_details=None,
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier=None,
        location=None,
    )
    inst = _minimal_instance(
        service,
        slug="my-best-auntie-1-3-04-26",
        cohort=None,
        training_details=SimpleNamespace(price=Decimal("1"), currency="HKD"),
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["title"] == "Only Base"


def test_training_non_mba_omits_booking_system() -> None:
    service = SimpleNamespace(
        title="Other",
        description="Course",
        service_type=ServiceType.TRAINING_COURSE,
        service_key="other-course",
        booking_system=None,
        event_details=None,
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier=None,
        location=None,
    )
    inst = _minimal_instance(
        service,
        training_details=SimpleNamespace(price=Decimal("1"), currency="HKD"),
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert "booking_system" not in out
    assert out["service_tier"] is None


def test_training_mba_infers_service_tier_from_instance_slug() -> None:
    service = SimpleNamespace(
        title="MBA",
        description="Course",
        service_type=ServiceType.TRAINING_COURSE,
        service_key="my-best-auntie-training-course",
        booking_system=None,
        event_details=None,
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier=None,
        location=None,
    )
    inst = _minimal_instance(
        service,
        slug="my-best-auntie-1-3-04-26",
        cohort="apr-26",
        training_details=SimpleNamespace(price=Decimal("9000"), currency="HKD"),
    )
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["service_tier"] == "1-3"
    assert out["title"] == "MBA 1-3 - Apr 26"
    assert out["tags"] == ["1-3"]
    assert "id" not in out


def test_virtual_clears_location_and_url_even_with_coords() -> None:
    service = SimpleNamespace(
        title="Svc",
        description="D",
        service_type=ServiceType.EVENT,
        service_key="e",
        booking_system=None,
        event_details=SimpleNamespace(
            event_category=SimpleNamespace(value="workshop"),
            default_price=None,
            default_currency="HKD",
        ),
        delivery_mode=SimpleNamespace(value="online"),
        service_tier=None,
        location=None,
    )
    loc = SimpleNamespace(name="X", address="Y", lat=Decimal("1"), lng=Decimal("2"))
    inst = _minimal_instance(service, delivery_mode=SimpleNamespace(value="online"))
    inst.session_slots[0].location = loc
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location"] == "virtual"
    assert out["location_name"] is None
    assert out["location_address"] is None
    assert out["location_url"] == ""
    assert out["location_tbc"] is False


def test_physical_coord_location_url() -> None:
    service = _event_service()
    loc = SimpleNamespace(
        name="V", address="A", lat=Decimal("22.3"), lng=Decimal("114.1")
    )
    inst = _minimal_instance(service)
    inst.session_slots[0].location = loc
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location"] == "physical"
    assert out["location_url"].startswith("https://www.google.com/maps/dir/")
    assert "%2C" in out["location_url"]


def test_physical_address_only_location_url() -> None:
    from urllib.parse import quote_plus

    from app.utils.maps import _BASE

    service = _event_service()
    addr = "Queen's Rd Central"
    loc = SimpleNamespace(name="V", address=addr, lat=None, lng=None)
    inst = _minimal_instance(service)
    inst.session_slots[0].location = loc
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location_url"] == f"{_BASE}{quote_plus(addr)}"


def test_no_location_empty_url() -> None:
    service = _event_service()
    service.location = None
    inst = _minimal_instance(service)
    inst.session_slots[0].location = None
    inst.location = None
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location_url"] == ""
    assert out["location_tbc"] is True


def test_primary_location_prefers_slot_over_instance_and_service() -> None:
    service = _event_service()
    slot_loc = SimpleNamespace(name="SlotVenue", address="S1", lat=None, lng=None)
    inst_loc = SimpleNamespace(name="InstVenue", address="I1", lat=None, lng=None)
    svc_loc = SimpleNamespace(name="SvcVenue", address="V1", lat=None, lng=None)
    service.location = svc_loc
    inst = _minimal_instance(service)
    inst.session_slots[0].location = slot_loc
    inst.location = inst_loc
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location_name"] == "SlotVenue"
    assert out["location_tbc"] is False


def test_primary_location_falls_back_to_instance_when_slot_unset() -> None:
    service = _event_service()
    inst_loc = SimpleNamespace(name="InstVenue", address="I1", lat=None, lng=None)
    svc_loc = SimpleNamespace(name="SvcVenue", address="V1", lat=None, lng=None)
    service.location = svc_loc
    inst = _minimal_instance(service)
    inst.session_slots[0].location = None
    inst.location = inst_loc
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location_name"] == "InstVenue"
    assert out["location_tbc"] is False


def test_primary_location_does_not_use_service_when_slot_and_instance_unset() -> None:
    service = _event_service()
    svc_loc = SimpleNamespace(name="SvcVenue", address="V1", lat=None, lng=None)
    service.location = svc_loc
    inst = _minimal_instance(service)
    inst.session_slots[0].location = None
    inst.location = None
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location_name"] is None
    assert out["location_address"] is None
    assert out["location_url"] == ""
    assert out["location_tbc"] is True


def test_primary_location_all_null() -> None:
    service = _event_service()
    service.location = None
    inst = _minimal_instance(service)
    inst.session_slots[0].location = None
    inst.location = None
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location_name"] is None
    assert out["location_address"] is None
    assert out["location_tbc"] is True


def test_partner_venue_location_name_falls_back_to_organization_name() -> None:
    """Partner CRM locations often omit ``locations.name``; use the org display name."""
    loc_id = uuid4()
    venue = SimpleNamespace(
        id=loc_id,
        name=None,
        address="99 Partner Rd",
        lat=None,
        lng=None,
    )
    org = SimpleNamespace(
        name="Springfield Community Center",
        partner_key="springfield-cc",
        location_id=loc_id,
    )
    link = SimpleNamespace(sort_order=0, organization=org)
    service = _event_service()
    service.location = None
    inst = _minimal_instance(service, partner_organization_links=[link])
    inst.session_slots[0].location = venue
    inst.location = venue
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location_name"] == "Springfield Community Center"
    assert out["partners"] == ["springfield-cc"]


def test_location_without_partner_match_does_not_use_partner_name() -> None:
    """Only substitute when the resolved location is a linked partner's org location."""
    loc_id = uuid4()
    other_id = uuid4()
    venue = SimpleNamespace(
        id=loc_id,
        name=None,
        address="Somewhere",
        lat=None,
        lng=None,
    )
    org = SimpleNamespace(
        name="Partner Org",
        partner_key="partner",
        location_id=other_id,
    )
    link = SimpleNamespace(sort_order=0, organization=org)
    service = _event_service()
    inst = _minimal_instance(service, partner_organization_links=[link])
    inst.session_slots[0].location = venue
    inst.location = venue
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["location_name"] is None


def test_max_capacity_none_omits_spaces() -> None:
    service = _event_service()
    inst = _minimal_instance(service, max_capacity=None)
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert "spaces_total" not in out
    assert "spaces_left" not in out


def test_spaces_left_override_null_matches_remaining() -> None:
    service = _event_service()
    inst = _minimal_instance(service, max_capacity=10, capacity_left_override=None)
    out = public_events._serialize_public_event(inst, enrollment_counts={inst.id: 3})
    assert out["spaces_total"] == 10
    assert out["spaces_left"] == 7


def test_spaces_left_override_below_remaining_wins() -> None:
    service = _event_service()
    inst = _minimal_instance(service, max_capacity=10, capacity_left_override=2)
    out = public_events._serialize_public_event(inst, enrollment_counts={inst.id: 3})
    assert out["spaces_left"] == 2


def test_spaces_left_override_above_remaining_clamped() -> None:
    service = _event_service()
    inst = _minimal_instance(service, max_capacity=10, capacity_left_override=99)
    out = public_events._serialize_public_event(inst, enrollment_counts={inst.id: 3})
    assert out["spaces_left"] == 7


def test_spaces_left_override_ignored_when_max_capacity_none() -> None:
    service = _event_service()
    inst = _minimal_instance(service, max_capacity=None, capacity_left_override=3)
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert "spaces_total" not in out
    assert "spaces_left" not in out


def test_spaces_left_override_zero_renders_zero() -> None:
    service = _event_service()
    inst = _minimal_instance(service, max_capacity=10, capacity_left_override=0)
    out = public_events._serialize_public_event(inst, enrollment_counts={inst.id: 1})
    assert out["spaces_left"] == 0
    assert out["is_fully_booked"] is False


def test_spaces_left_enrollments_ge_max_still_zero() -> None:
    service = _event_service()
    inst = _minimal_instance(service, max_capacity=8, capacity_left_override=5)
    out = public_events._serialize_public_event(inst, enrollment_counts={inst.id: 10})
    assert out["spaces_left"] == 0


def test_max_capacity_with_enrollments() -> None:
    service = _event_service()
    inst = _minimal_instance(service, max_capacity=8)
    out = public_events._serialize_public_event(inst, enrollment_counts={inst.id: 10})
    assert out["spaces_total"] == 8
    assert out["spaces_left"] == 0


def test_serialize_public_event_requires_valid_slug() -> None:
    service = _event_service()
    inst = _minimal_instance(service, slug="")
    with pytest.raises(ValueError):
        public_events._serialize_public_event(inst, enrollment_counts={})


def test_serialize_public_event_rejects_slug_not_matching_pattern() -> None:
    service = _event_service()
    inst = _minimal_instance(service, slug="Not_Valid")
    with pytest.raises(ValueError):
        public_events._serialize_public_event(inst, enrollment_counts={})


def test_dates_use_dense_part_after_sort_order() -> None:
    service = _event_service()
    s1 = datetime(2026, 5, 2, 10, 0, tzinfo=UTC)
    e1 = datetime(2026, 5, 2, 11, 0, tzinfo=UTC)
    s2 = datetime(2026, 5, 1, 10, 0, tzinfo=UTC)
    e2 = datetime(2026, 5, 1, 11, 0, tzinfo=UTC)
    loc = SimpleNamespace(name="V", address="1 St", lat=None, lng=None)
    inst = _minimal_instance(service)
    inst.session_slots = [
        SimpleNamespace(
            id=uuid4(),
            sort_order=1,
            starts_at=s1,
            ends_at=e1,
            location=loc,
        ),
        SimpleNamespace(
            id=uuid4(),
            sort_order=0,
            starts_at=s2,
            ends_at=e2,
            location=loc,
        ),
    ]
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["dates"] == [
        {
            "part": 1,
            "start_datetime": s2.isoformat(),
            "end_datetime": e2.isoformat(),
        },
        {
            "part": 2,
            "start_datetime": s1.isoformat(),
            "end_datetime": e1.isoformat(),
        },
    ]


def test_fully_booked_flag() -> None:
    service = _event_service()
    inst = _minimal_instance(service, status=InstanceStatus.FULL)
    out = public_events._serialize_public_event(inst, enrollment_counts={})
    assert out["booking_status"] == "fully_booked"
    assert out["is_fully_booked"] is True


def _event_service() -> Any:
    return SimpleNamespace(
        title="Svc",
        description="Desc",
        service_type=ServiceType.EVENT,
        service_key="slug",
        booking_system=None,
        event_details=SimpleNamespace(
            event_category=SimpleNamespace(value="workshop"),
            default_price=None,
            default_currency="HKD",
        ),
        delivery_mode=SimpleNamespace(value="in_person"),
        service_tier=None,
        location=None,
    )


def _minimal_instance(
    service: Any,
    *,
    status: InstanceStatus = InstanceStatus.OPEN,
    slug: str | None = "slug",
    ticket_tiers: list[Any] | None = None,
    instance_tags: list[Any] | None = None,
    partner_organization_links: list[Any] | None = None,
    external_url: str | None = None,
    eventbrite_event_url: str | None = None,
    max_capacity: int | None = 10,
    capacity_left_override: int | None = None,
    cohort: str | None = None,
    training_details: Any = None,
    delivery_mode: Any = None,
) -> Any:
    starts = datetime(2026, 5, 1, 10, 0, tzinfo=UTC)
    ends = datetime(2026, 5, 1, 12, 0, tzinfo=UTC)
    loc = SimpleNamespace(name="V", address="1 St", lat=None, lng=None)
    return SimpleNamespace(
        id=uuid4(),
        slug=slug,
        title=None,
        description=None,
        status=status,
        max_capacity=max_capacity,
        capacity_left_override=capacity_left_override,
        external_url=external_url,
        eventbrite_event_url=eventbrite_event_url,
        cohort=cohort,
        delivery_mode=delivery_mode,
        service=service,
        session_slots=[
            SimpleNamespace(
                id=uuid4(),
                sort_order=0,
                starts_at=starts,
                ends_at=ends,
                location=loc,
            )
        ],
        location=loc,
        ticket_tiers=ticket_tiers
        if ticket_tiers is not None
        else [
            SimpleNamespace(
                id=uuid4(),
                sort_order=0,
                created_at=datetime(2026, 1, 1, tzinfo=UTC),
                price=Decimal("1"),
                currency="HKD",
            )
        ],
        training_details=training_details,
        instance_tags=instance_tags or [],
        partner_organization_links=partner_organization_links or [],
    )
