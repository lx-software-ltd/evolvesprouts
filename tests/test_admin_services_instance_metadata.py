"""Tests for instance cohort and tag_ids parsing."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.api.admin_services_payloads import (
    parse_create_instance_payload,
    parse_update_instance_payload,
)
from app.db.models import (
    ConsultationDetails,
    EventDetails,
    Service,
    ServiceInstance,
    ServiceInstanceTag,
    Tag,
    TrainingCourseDetails,
    TrainingInstanceDetails,
)
from app.db.models.enums import (
    ConsultationFormat,
    ConsultationPricingModel,
    EventCategory,
    InstanceStatus,
    ServiceDeliveryMode,
    ServiceStatus,
    ServiceType,
    TrainingFormat,
    TrainingPricingUnit,
)
from app.exceptions import ValidationError

pytestmark = pytest.mark.filterwarnings("ignore::sqlalchemy.exc.SAWarning")


def _minimal_training_service() -> Service:
    sid = uuid4()
    return Service(
        id=sid,
        service_type=ServiceType.TRAINING_COURSE,
        title="Course",
        service_key="course-template",
        booking_system=None,
        description=None,
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.ONLINE,
        status=ServiceStatus.PUBLISHED,
        created_by="tester",
    )


def _minimal_consultation_service() -> Service:
    sid = uuid4()
    return Service(
        id=sid,
        service_type=ServiceType.CONSULTATION,
        title="Consult",
        service_key="consult-template",
        booking_system=None,
        description=None,
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.ONLINE,
        status=ServiceStatus.PUBLISHED,
        created_by="tester",
    )


def test_parse_create_consultation_instance_rejects_consultation_details_payload() -> (
    None
):
    service = _minimal_consultation_service()
    body = {
        "slug": "tier-instance",
        "consultation_details": {
            "pricing_model": "package",
            "price": "10.00",
            "currency": "HKD",
            "package_sessions": 3,
        },
    }
    with pytest.raises(ValidationError) as exc:
        parse_create_instance_payload(body, service)
    assert "Consultation pricing now lives" in exc.value.message
    assert exc.value.field == "consultation_details"


def test_parse_create_consultation_instance_without_pricing_payload_succeeds() -> None:
    service = _minimal_consultation_service()
    body = {"slug": "clean-consult-instance"}
    parsed = parse_create_instance_payload(body, service)
    assert parsed["slug"] == "clean-consult-instance"
    assert parsed["type_details"] == {}


def test_parse_update_consultation_instance_rejects_consultation_details_payload() -> (
    None
):
    service = _minimal_consultation_service()
    body = {
        "status": "scheduled",
        "consultation_details": {"pricing_model": "free"},
    }
    with pytest.raises(ValidationError) as exc:
        parse_update_instance_payload(body, service)
    assert "Consultation pricing now lives" in exc.value.message
    assert exc.value.field == "consultation_details"


def test_parse_update_consultation_instance_rejects_loose_pricing_model() -> None:
    service = _minimal_consultation_service()
    body = {"status": "scheduled", "pricing_model": "hourly"}
    with pytest.raises(ValidationError) as exc:
        parse_update_instance_payload(body, service)
    assert exc.value.field == "consultation_details"
    service = _minimal_training_service()
    body = {
        "slug": "spring-2026-run",
        "cohort": "Spring-2026",
        "training_details": {
            "training_format": "group",
            "price": "10.00",
            "currency": "HKD",
            "pricing_unit": "per_person",
        },
    }
    parsed = parse_create_instance_payload(body, service)
    assert parsed["cohort"] == "spring-2026"


def test_parse_create_instance_payload_rejects_invalid_cohort_field() -> None:
    service = _minimal_training_service()
    body = {
        "slug": "valid-slug",
        "cohort": "Bad_Slug",
        "training_details": {
            "training_format": "group",
            "price": "10.00",
            "currency": "HKD",
            "pricing_unit": "per_person",
        },
    }
    with pytest.raises(ValidationError) as exc:
        parse_create_instance_payload(body, service)
    assert exc.value.field == "cohort"


def test_parse_create_instance_payload_rejects_deprecated_age_group() -> None:
    service = _minimal_training_service()
    body = {
        "slug": "x",
        "age_group": "0-1",
        "training_details": {
            "training_format": "group",
            "price": "10.00",
            "currency": "HKD",
            "pricing_unit": "per_person",
        },
    }
    with pytest.raises(ValidationError) as exc:
        parse_create_instance_payload(body, service)
    assert exc.value.field == "age_group"


def test_parse_update_instance_payload_rejects_deprecated_age_group() -> None:
    service = _minimal_training_service()
    body = {"status": "scheduled", "age_group": "0-1"}
    with pytest.raises(ValidationError) as exc:
        parse_update_instance_payload(body, service)
    assert exc.value.field == "age_group"


def test_parse_create_instance_payload_accepts_tag_ids() -> None:
    service = _minimal_training_service()
    t1, t2 = uuid4(), uuid4()
    body = {
        "slug": "tagged-run",
        "tag_ids": [str(t2), str(t1)],
        "training_details": {
            "training_format": "group",
            "price": "10.00",
            "currency": "HKD",
            "pricing_unit": "per_person",
        },
    }
    parsed = parse_create_instance_payload(body, service)
    assert parsed["tag_ids"] == [t2, t1]


def test_parse_create_training_instance_accepts_zero_price() -> None:
    service = _minimal_training_service()
    body = {
        "slug": "free-run",
        "training_details": {
            "training_format": "group",
            "price": "0",
            "currency": "HKD",
            "pricing_unit": "per_person",
        },
    }
    parsed = parse_create_instance_payload(body, service)
    assert parsed["type_details"]["price"] == Decimal("0")


def test_parse_create_training_instance_rejects_negative_price() -> None:
    service = _minimal_training_service()
    body = {
        "slug": "bad-price",
        "training_details": {
            "training_format": "group",
            "price": "-1.00",
            "currency": "HKD",
            "pricing_unit": "per_person",
        },
    }
    with pytest.raises(ValidationError) as exc:
        parse_create_instance_payload(body, service)
    assert exc.value.field == "price"
    assert "must be >= 0" in exc.value.message


def test_training_instance_round_trip_cohort_tags_in_memory() -> None:
    """ORM-only check: fields map and serializer ordering matches tag name (case-insensitive)."""
    from app.api.admin_services_serializers import serialize_instance

    service = _minimal_training_service()
    inst_id = uuid4()
    tag_ba = Tag(
        id=uuid4(),
        name="Beta",
        color=None,
        description=None,
        created_by="t",
    )
    tag_aa = Tag(
        id=uuid4(),
        name="alpha",
        color=None,
        description=None,
        created_by="t",
    )
    instance = ServiceInstance(
        id=inst_id,
        service_id=service.id,
        title=None,
        slug="cohort-instance-1",
        description=None,
        cover_image_s3_key=None,
        status=InstanceStatus.SCHEDULED,
        delivery_mode=None,
        location_id=None,
        max_capacity=None,
        waitlist_enabled=False,
        instructor_id=None,
        cohort="spring-2026",
        notes=None,
        created_by="tester",
        external_url=None,
    )
    instance.service = service
    link_ba = ServiceInstanceTag(
        service_instance_id=inst_id,
        tag_id=tag_ba.id,
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
    )
    link_ba.tag = tag_ba
    link_aa = ServiceInstanceTag(
        service_instance_id=inst_id,
        tag_id=tag_aa.id,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    link_aa.tag = tag_aa
    instance.instance_tags = [link_ba, link_aa]
    instance.training_details = TrainingInstanceDetails(
        instance_id=inst_id,
        training_format=TrainingFormat.GROUP,
        price=Decimal("10.00"),
        currency="HKD",
        pricing_unit=TrainingPricingUnit.PER_PERSON,
    )
    instance.session_slots = []
    instance.ticket_tiers = []
    instance.partner_organization_links = []

    payload = serialize_instance(instance)
    assert "age_group" not in payload
    assert payload["capacity_enrolled_count"] == 0
    assert payload["cohort"] == "spring-2026"
    assert [t["name"] for t in payload["tags"]] == ["alpha", "Beta"]
    assert payload["tag_ids"] == [str(tag_aa.id), str(tag_ba.id)]
    assert payload["eventbrite_sync_status"] == "pending"
    assert payload["eventbrite_event_url"] is None


def test_serialize_instance_resolves_from_parent_service_when_missing() -> None:
    """Effective fields fall back to the parent service template."""
    from app.api.admin_services_serializers import serialize_instance

    sid = uuid4()
    loc_id = uuid4()
    service = Service(
        id=sid,
        service_type=ServiceType.TRAINING_COURSE,
        title="Parent title",
        service_key="parent-slug",
        booking_system=None,
        description="Parent body",
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.IN_PERSON,
        status=ServiceStatus.PUBLISHED,
        created_by="tester",
        location_id=loc_id,
    )
    service.training_course_details = TrainingCourseDetails(
        service_id=sid,
        pricing_unit=TrainingPricingUnit.PER_FAMILY,
        default_price=Decimal("88.50"),
        default_currency="USD",
    )

    inst_id = uuid4()
    instance = ServiceInstance(
        id=inst_id,
        service_id=sid,
        title=None,
        slug="instance-public-slug",
        description=None,
        cover_image_s3_key=None,
        status=InstanceStatus.SCHEDULED,
        delivery_mode=None,
        location_id=None,
        max_capacity=None,
        waitlist_enabled=False,
        instructor_id=None,
        cohort=None,
        notes=None,
        created_by="tester",
        external_url=None,
    )
    instance.service = service
    instance.instance_tags = []
    instance.session_slots = []
    instance.ticket_tiers = []
    instance.partner_organization_links = []

    payload = serialize_instance(instance)
    assert payload["resolved_title"] == "Parent title"
    assert payload["resolved_slug"] == "instance-public-slug"
    assert payload["resolved_description"] == "Parent body"
    assert payload["resolved_delivery_mode"] == "in_person"
    assert payload["resolved_location_id"] == str(loc_id)
    assert payload["training_details"] is None
    assert payload["resolved_training_details"] == {
        "training_format": "group",
        "price": "88.50",
        "currency": "USD",
        "pricing_unit": "per_family",
    }


def test_serialize_instance_resolves_event_and_consultation_from_service() -> None:
    from app.api.admin_services_serializers import serialize_instance

    sid = uuid4()
    inst_id = uuid4()

    event_service = Service(
        id=sid,
        service_type=ServiceType.EVENT,
        title="Evt",
        service_key="evt-template",
        booking_system=None,
        description=None,
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.ONLINE,
        status=ServiceStatus.PUBLISHED,
        created_by="t",
    )
    event_service.event_details = EventDetails(
        service_id=sid,
        event_category=EventCategory.OPEN_HOUSE,
        default_price=Decimal("25.00"),
        default_currency="HKD",
    )
    ev_instance = ServiceInstance(
        id=inst_id,
        service_id=sid,
        title="Inst",
        slug="open-house-instance",
        description=None,
        cover_image_s3_key=None,
        status=InstanceStatus.SCHEDULED,
        delivery_mode=None,
        location_id=None,
        max_capacity=None,
        waitlist_enabled=False,
        instructor_id=None,
        cohort=None,
        notes=None,
        created_by="t",
        external_url=None,
    )
    ev_instance.service = event_service
    ev_instance.instance_tags = []
    ev_instance.session_slots = []
    ev_instance.ticket_tiers = []
    ev_instance.partner_organization_links = []

    ev_payload = serialize_instance(ev_instance)
    assert ev_payload["event_ticket_tiers"] == []
    assert len(ev_payload["resolved_event_ticket_tiers"]) == 1
    tier0 = ev_payload["resolved_event_ticket_tiers"][0]
    assert tier0["name"] == "open_house"
    assert tier0["price"] == "25.00"
    assert tier0["currency"] == "HKD"

    csid = uuid4()
    cinst = uuid4()
    cons_service = Service(
        id=csid,
        service_type=ServiceType.CONSULTATION,
        title="Cons",
        service_key="cons-template",
        booking_system=None,
        description=None,
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.ONLINE,
        status=ServiceStatus.PUBLISHED,
        created_by="t",
    )
    cons_service.consultation_details = ConsultationDetails(
        service_id=csid,
        consultation_format=ConsultationFormat.ONE_ON_ONE,
        max_group_size=None,
        duration_minutes=60,
        pricing_model=ConsultationPricingModel.HOURLY,
        default_hourly_rate=Decimal("120.00"),
        default_package_price=None,
        default_package_sessions=None,
        default_currency="HKD",
    )
    cons_instance = ServiceInstance(
        id=cinst,
        service_id=csid,
        title="C",
        slug="cons-instance-1",
        description=None,
        cover_image_s3_key=None,
        status=InstanceStatus.SCHEDULED,
        delivery_mode=None,
        location_id=None,
        max_capacity=None,
        waitlist_enabled=False,
        instructor_id=None,
        cohort=None,
        notes=None,
        created_by="t",
        external_url=None,
    )
    cons_instance.service = cons_service
    cons_instance.instance_tags = []
    cons_instance.session_slots = []
    cons_instance.ticket_tiers = []
    cons_instance.partner_organization_links = []

    c_payload = serialize_instance(cons_instance)
    assert c_payload["consultation_details"] is None
    assert c_payload["resolved_consultation_details"] == {
        "pricing_model": "hourly",
        "price": "120.00",
        "currency": "HKD",
        "package_sessions": None,
    }


def _minimal_event_service_for_instance_payload() -> Service:
    sid = uuid4()
    return Service(
        id=sid,
        service_type=ServiceType.EVENT,
        title="Evt",
        service_key="evt-template",
        booking_system=None,
        description=None,
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.ONLINE,
        status=ServiceStatus.PUBLISHED,
        created_by="t",
    )


def test_parse_create_instance_payload_accepts_capacity_left_override() -> None:
    service = _minimal_event_service_for_instance_payload()
    service.event_details = EventDetails(
        service_id=service.id,
        event_category=EventCategory.WORKSHOP,
        default_price=Decimal("10.00"),
        default_currency="HKD",
    )
    body = {
        "slug": "evt-inst",
        "capacity_left_override": 3,
        "session_slots": [
            {
                "starts_at": "2026-06-01T10:00:00+00:00",
                "ends_at": "2026-06-01T12:00:00+00:00",
                "sort_order": 0,
            }
        ],
        "event_ticket_tiers": [
            {
                "name": "workshop",
                "price": "10.00",
                "currency": "HKD",
                "max_quantity": None,
                "sort_order": 0,
            }
        ],
    }
    parsed = parse_create_instance_payload(body, service)
    assert parsed["capacity_left_override"] == 3


def test_parse_update_instance_payload_capacity_left_override_explicit_null() -> None:
    service = _minimal_event_service_for_instance_payload()
    service.event_details = EventDetails(
        service_id=service.id,
        event_category=EventCategory.WORKSHOP,
        default_price=Decimal("10.00"),
        default_currency="HKD",
    )
    body = {
        "status": "open",
        "capacity_left_override": None,
        "event_ticket_tiers": [
            {
                "name": "workshop",
                "price": "10.00",
                "currency": "HKD",
                "max_quantity": None,
                "sort_order": 0,
            }
        ],
    }
    parsed = parse_update_instance_payload(body, service)
    assert "capacity_left_override" in parsed
    assert parsed["capacity_left_override"] is None


def test_parse_update_instance_payload_omits_capacity_left_override_when_absent() -> (
    None
):
    service = _minimal_event_service_for_instance_payload()
    service.event_details = EventDetails(
        service_id=service.id,
        event_category=EventCategory.WORKSHOP,
        default_price=Decimal("10.00"),
        default_currency="HKD",
    )
    body = {
        "status": "open",
        "event_ticket_tiers": [
            {
                "name": "workshop",
                "price": "10.00",
                "currency": "HKD",
                "max_quantity": None,
                "sort_order": 0,
            }
        ],
    }
    parsed = parse_update_instance_payload(body, service)
    assert "capacity_left_override" not in parsed


def test_serialize_instance_capacity_left_override_and_effective() -> None:
    from app.api.admin_services_serializers import serialize_instance

    sid = uuid4()
    inst_id = uuid4()
    service = Service(
        id=sid,
        service_type=ServiceType.EVENT,
        title="Evt",
        service_key="evt-template",
        booking_system=None,
        description=None,
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.ONLINE,
        status=ServiceStatus.PUBLISHED,
        created_by="t",
    )
    service.event_details = EventDetails(
        service_id=sid,
        event_category=EventCategory.WORKSHOP,
        default_price=Decimal("10.00"),
        default_currency="HKD",
    )
    instance = ServiceInstance(
        id=inst_id,
        service_id=sid,
        title=None,
        slug="evt-row",
        description=None,
        cover_image_s3_key=None,
        status=InstanceStatus.OPEN,
        delivery_mode=None,
        location_id=None,
        max_capacity=10,
        capacity_left_override=4,
        waitlist_enabled=False,
        instructor_id=None,
        cohort=None,
        notes=None,
        created_by="t",
        external_url=None,
    )
    instance.service = service
    instance.instance_tags = []
    instance.session_slots = []
    instance.ticket_tiers = []
    instance.partner_organization_links = []
    payload = serialize_instance(instance, capacity_enrolled_count=8)
    assert payload["capacity_left_override"] == 4
    assert payload["capacity_left_effective"] == 2

    unlimited = ServiceInstance(
        id=uuid4(),
        service_id=sid,
        title=None,
        slug="evt-row-2",
        description=None,
        cover_image_s3_key=None,
        status=InstanceStatus.OPEN,
        delivery_mode=None,
        location_id=None,
        max_capacity=None,
        capacity_left_override=9,
        waitlist_enabled=False,
        instructor_id=None,
        cohort=None,
        notes=None,
        created_by="t",
        external_url=None,
    )
    unlimited.service = service
    unlimited.instance_tags = []
    unlimited.session_slots = []
    unlimited.ticket_tiers = []
    unlimited.partner_organization_links = []
    p2 = serialize_instance(unlimited, capacity_enrolled_count=0)
    assert p2["capacity_left_override"] == 9
    assert p2["capacity_left_effective"] is None


def test_serialize_tier_consultation_service_emits_own_consultation_details() -> None:
    """Per-tier consultation services carry pricing on ``service.consultation_details``."""
    from app.api.admin_services_serializers import serialize_instance

    csid = uuid4()
    cinst = uuid4()
    cons_service = Service(
        id=csid,
        service_type=ServiceType.CONSULTATION,
        title="Family Consultation: Essentials",
        service_key="family-consultation-essentials",
        booking_system="consultation-booking",
        description=None,
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.ONLINE,
        status=ServiceStatus.PUBLISHED,
        created_by="t",
        service_tier="essentials",
        location_id=None,
    )
    cons_service.consultation_details = ConsultationDetails(
        service_id=csid,
        consultation_format=ConsultationFormat.ONE_ON_ONE,
        max_group_size=None,
        duration_minutes=90,
        pricing_model=ConsultationPricingModel.HOURLY,
        default_hourly_rate=Decimal("150.00"),
        default_package_price=None,
        default_package_sessions=None,
        default_currency="HKD",
    )
    cons_instance = ServiceInstance(
        id=cinst,
        service_id=csid,
        title="Booking",
        slug="family-consultation-essentials-20380101120000-deadbeef",
        description=None,
        cover_image_s3_key=None,
        status=InstanceStatus.OPEN,
        delivery_mode=None,
        location_id=None,
        max_capacity=1,
        waitlist_enabled=False,
        instructor_id=None,
        cohort=None,
        notes=None,
        created_by="public-reservation",
        external_url=None,
    )
    cons_instance.service = cons_service
    cons_instance.instance_tags = []
    cons_instance.session_slots = []
    cons_instance.ticket_tiers = []
    cons_instance.partner_organization_links = []

    payload = serialize_instance(cons_instance)
    assert payload["consultation_details"] is None
    assert payload["resolved_consultation_details"] == {
        "pricing_model": "hourly",
        "price": "150.00",
        "currency": "HKD",
        "package_sessions": None,
    }


def test_serialize_instance_includes_eventbrite_event_url() -> None:
    from app.api.admin_services_serializers import serialize_instance

    service = _minimal_training_service()
    instance = ServiceInstance(
        id=uuid4(),
        service_id=service.id,
        title=None,
        slug="eventbrite-url-instance",
        description=None,
        cover_image_s3_key=None,
        status=InstanceStatus.OPEN,
        delivery_mode=None,
        location_id=None,
        max_capacity=None,
        waitlist_enabled=False,
        instructor_id=None,
        cohort=None,
        notes=None,
        created_by="tester",
        external_url=None,
        eventbrite_event_url="https://www.eventbrite.com/e/mealtime-workshop",
    )
    instance.service = service
    instance.instance_tags = []
    instance.training_details = None
    instance.session_slots = []
    instance.ticket_tiers = []
    instance.partner_organization_links = []

    payload = serialize_instance(instance)
    assert (
        payload["eventbrite_event_url"]
        == "https://www.eventbrite.com/e/mealtime-workshop"
    )
    assert payload["eventbrite_last_error"] is None

    instance.eventbrite_last_error = (
        "Eventbrite would not unpublish this event: orders exist."
    )
    payload = serialize_instance(instance)
    assert payload["eventbrite_last_error"] == instance.eventbrite_last_error

    instance.eventbrite_last_error = "  "
    payload = serialize_instance(instance)
    assert payload["eventbrite_last_error"] is None
