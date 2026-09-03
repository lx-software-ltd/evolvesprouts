"""Tests for native reservation persistence and post-success hooks."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.api.public_reservations import (
    _handle_public_reservation,
    _validate_discount_code_redemption_scope,
    _validate_reservation_payload,
)
from app.db.models import InstanceSessionSlot
from app.db.models.enums import DiscountType, ServiceType


class _FakeBeginNestedCM:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *_a: object) -> bool:
        return False


def _resolved_instance_stub(
    instance_id: object,
    service_id: object,
    *,
    service_key: str = "my-best-auntie-training-course",
    service_type_value: str = "training_course",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=instance_id,
        service=SimpleNamespace(
            id=service_id,
            service_key=service_key,
            service_type=SimpleNamespace(value=service_type_value),
        ),
    )


def _reservation_body(**overrides: object) -> dict[str, Any]:
    base: dict[str, Any] = {
        "attendeeName": "Test User",
        "attendeeEmail": "u@example.com",
        "attendeePhone": "91234567",
        "attendeeCountry": "HK",
        "serviceKey": "my-best-auntie-training-course",
        "serviceInstanceSlug": "test-cohort",
        "serviceTier": "3-5 years",
        "paymentMethod": "bank_transfer",
        "totalAmount": 100,
        "title": "Course",
        "agreedToTermsAndConditions": True,
        "locale": "en",
    }
    base.update(overrides)
    return base


def test_validate_reservation_payload_rejects_unknown_booking_system() -> None:
    from app.exceptions import ValidationError

    body = _reservation_body(bookingSystem="not-a-real-flow")
    with pytest.raises(ValidationError) as excinfo:
        _validate_reservation_payload(body)
    assert getattr(excinfo.value, "field", None) == "bookingSystem"


def test_validate_reservation_payload_normalizes_booking_system_case() -> None:
    body = _reservation_body(bookingSystem="EVENT-BOOKING")
    out = _validate_reservation_payload(body)
    assert out["booking_system"] == "event-booking"


def test_validate_reservation_payload_accepts_service_instance_cohort() -> None:
    body = _reservation_body(
        serviceInstanceCohort="  April MBA  ",
    )
    out = _validate_reservation_payload(body)
    assert out["service_instance_cohort"] == "April MBA"


def test_validate_reservation_payload_normalizes_mixed_case_service_instance_slug() -> (
    None
):
    body = _reservation_body(
        serviceInstanceSlug="My-Cohort-Slug",
    )
    out = _validate_reservation_payload(body)
    assert out["service_instance_slug"] == "my-cohort-slug"


def _post_event(api_gateway_event: Any, body: dict[str, Any]) -> dict[str, Any]:
    return api_gateway_event(
        method="POST",
        path="/v1/reservations",
        body=json.dumps(body),
        headers={"X-Turnstile-Token": "tok"},
    )


def _patch_public_reservation_db_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Minimal fakes so reservation persistence does not require real DB helpers."""
    monkeypatch.setattr(
        "app.api.public_reservations._validate_payment_confirmation",
        lambda *_a, **_k: None,
    )

    class _FakeDiscountRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_code(self, _code: str) -> None:
            return None

        def validate_and_increment(self, _code_id: object) -> bool:
            return True

        def decrement_uses(self, _code_id: object) -> bool:
            return True

    monkeypatch.setattr(
        "app.api.public_reservations.ensure_contact_lead",
        lambda *a, **k: (SimpleNamespace(id=uuid4()), True),
    )

    class _FakeInstanceRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_with_service_by_slug(self, slug: str) -> SimpleNamespace | None:
            if slug.strip().lower() == "test-cohort":
                return _resolved_instance_stub(uuid4(), uuid4())
            return None

    class _FakeEnrollmentRepo:
        def __init__(self, _session: object) -> None:
            pass

        def contact_has_enrollment_for_instance(self, **_kwargs: object) -> bool:
            return False

        def create_enrollment(self, _enrollment: object) -> object:
            return _enrollment

        def try_create_enrollment_with_capacity_guard(
            self, enrollment: object
        ) -> tuple[object | None, str | None]:
            return enrollment, None

    monkeypatch.setattr(
        "app.api.public_reservations.DiscountCodeRepository",
        _FakeDiscountRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.ServiceInstanceRepository",
        _FakeInstanceRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.EnrollmentRepository",
        _FakeEnrollmentRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.record_reservation_customer_payment",
        lambda *a, **k: (None, None, False),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.set_audit_context",
        lambda *a, **k: None,
    )


def test_handle_public_reservation_returns_409_when_instance_capacity_full(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    _patch_public_reservation_db_helpers(monkeypatch)

    contact_id = uuid4()
    instance_uuid = uuid4()

    class _FakeDiscountRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_code(self, _code: str) -> None:
            return None

    class _FakeInstanceRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_with_service_by_slug(self, slug: str) -> SimpleNamespace | None:
            if slug == "full-cohort":
                return _resolved_instance_stub(instance_uuid, uuid4())
            return None

    class _FakeEnrollmentRepo:
        def __init__(self, _session: object) -> None:
            pass

        def contact_has_enrollment_for_instance(self, **_kwargs: object) -> bool:
            return False

        def try_create_enrollment_with_capacity_guard(
            self, _enrollment: object
        ) -> tuple[None, str]:
            return None, "capacity_full"

    monkeypatch.setattr(
        "app.api.public_reservations.DiscountCodeRepository",
        _FakeDiscountRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.ServiceInstanceRepository",
        _FakeInstanceRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.EnrollmentRepository",
        _FakeEnrollmentRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.record_reservation_customer_payment",
        lambda *a, **k: (None, None, False),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.set_audit_context",
        lambda *a, **k: None,
    )

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create_with_event(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr("app.api.public_reservations.SalesLead", _FakeSalesLead)

    class _FakeSession:
        def commit(self) -> None:
            return None

        def begin(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

        def begin_nested(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.SalesLeadRepository",
        _FakeLeadRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )

    body = _reservation_body(serviceInstanceSlug="full-cohort")
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 409
    body_json = json.loads(resp["body"])
    assert body_json.get("field") == "serviceInstanceSlug"


def test_handle_public_reservation_accepts_free_payment_zero_total(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    _patch_public_reservation_db_helpers(monkeypatch)
    hooks = MagicMock()
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        hooks,
    )

    contact_id = uuid4()

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create_with_event(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(
        "app.api.public_reservations.SalesLead",
        _FakeSalesLead,
    )

    class _FakeSession:
        def commit(self) -> None:
            return None

        def begin(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

        def begin_nested(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.SalesLeadRepository",
        _FakeLeadRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )

    body = _reservation_body(
        paymentMethod="free",
        totalAmount=0,
        reservationPendingUntilPaymentConfirmed=False,
    )
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    hooks.assert_called_once()
    payload = hooks.call_args[0][0]
    assert payload["payment_method"] == "free"


def test_handle_public_reservation_skips_lead_when_enrollment_exists(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    _patch_public_reservation_db_helpers(monkeypatch)
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        MagicMock(),
    )
    ensure = MagicMock()
    monkeypatch.setattr("app.api.public_reservations.ensure_contact_lead", ensure)

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = uuid4()
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeEnrollmentRepo:
        def __init__(self, _session: object) -> None:
            pass

        def contact_has_enrollment_for_instance(self, **_kwargs: object) -> bool:
            return True

    class _FakeSession:
        def begin(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.EnrollmentRepository",
        _FakeEnrollmentRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )

    event = _post_event(api_gateway_event, _reservation_body())
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    ensure.assert_not_called()


def test_handle_public_reservation_rejects_free_with_nonzero_total(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    body = _reservation_body(
        paymentMethod="free",
        totalAmount=500,
        reservationPendingUntilPaymentConfirmed=False,
    )
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 400


def test_handle_public_reservation_rejects_zero_total_without_free_method(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    body = _reservation_body(
        paymentMethod="bank_transfer",
        totalAmount=0,
        reservationPendingUntilPaymentConfirmed=False,
    )
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 400


def test_handle_public_reservation_forces_pending_false_for_free_even_if_client_sends_true(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    _patch_public_reservation_db_helpers(monkeypatch)
    hooks = MagicMock()
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        hooks,
    )

    contact_id = uuid4()

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create_with_event(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(
        "app.api.public_reservations.SalesLead",
        _FakeSalesLead,
    )

    class _FakeSession:
        def commit(self) -> None:
            return None

        def begin(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

        def begin_nested(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.SalesLeadRepository",
        _FakeLeadRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )

    body = _reservation_body(
        paymentMethod="free",
        totalAmount=0,
        reservationPendingUntilPaymentConfirmed=True,
    )
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    payload = hooks.call_args[0][0]
    assert payload["reservation_pending_until_payment_confirmed"] is False


def test_handle_public_reservation_runs_hooks_after_persist(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    _patch_public_reservation_db_helpers(monkeypatch)
    hooks = MagicMock()
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        hooks,
    )

    contact_id = uuid4()

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create_with_event(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(
        "app.api.public_reservations.SalesLead",
        _FakeSalesLead,
    )

    class _FakeSession:
        def commit(self) -> None:
            return None

        def begin(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

        def begin_nested(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.SalesLeadRepository",
        _FakeLeadRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )

    event = _post_event(api_gateway_event, _reservation_body())
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    hooks.assert_called_once()
    payload = hooks.call_args[0][0]
    assert payload["attendee_email"] == "u@example.com"
    assert payload["payment_method"] == "bank_transfer"


def test_handle_public_reservation_accepts_missing_service_tier(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Event-style bookings omit serviceTier; persistence and hooks still succeed."""
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    _patch_public_reservation_db_helpers(monkeypatch)
    hooks = MagicMock()
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        hooks,
    )

    contact_id = uuid4()

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create_with_event(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(
        "app.api.public_reservations.SalesLead",
        _FakeSalesLead,
    )

    class _FakeSession:
        def commit(self) -> None:
            return None

        def begin(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

        def begin_nested(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.SalesLeadRepository",
        _FakeLeadRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )

    body = _reservation_body()
    del body["serviceTier"]
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    hooks.assert_called_once()
    payload = hooks.call_args[0][0]
    assert payload.get("service_tier") is None


def test_handle_public_reservation_event_booking_skips_booking_child_allocation(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    booking_child_spy = MagicMock()
    monkeypatch.setattr(
        "app.api.public_reservations._create_booking_instance_for_service",
        booking_child_spy,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    _patch_public_reservation_db_helpers(monkeypatch)
    hooks = MagicMock()
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        hooks,
    )

    contact_id = uuid4()
    template_instance_id = uuid4()
    service_id = uuid4()
    enrollment_target: dict[str, Any] = {}

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create_with_event(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(
        "app.api.public_reservations.SalesLead",
        _FakeSalesLead,
    )

    class _FakeInstanceRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_with_service_by_slug(self, slug: str) -> SimpleNamespace | None:
            if slug.strip().lower() == "test-cohort":
                return _resolved_instance_stub(
                    template_instance_id, service_id, service_type_value="event"
                )
            return None

    class _FakeEnrollmentRepo:
        def __init__(self, _session: object) -> None:
            pass

        def contact_has_enrollment_for_instance(self, **_kwargs: object) -> bool:
            return False

        def create_enrollment(self, _enrollment: object) -> object:
            return _enrollment

        def try_create_enrollment_with_capacity_guard(
            self, enrollment: object
        ) -> tuple[object | None, str | None]:
            enrollment_target["instance_id"] = enrollment.instance_id
            return enrollment, None

    monkeypatch.setattr(
        "app.api.public_reservations.ServiceInstanceRepository",
        _FakeInstanceRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.EnrollmentRepository",
        _FakeEnrollmentRepo,
    )

    class _FakeSession:
        def commit(self) -> None:
            return None

        def begin(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

        def begin_nested(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.SalesLeadRepository",
        _FakeLeadRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )

    body = _reservation_body(bookingSystem="event-booking")
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    booking_child_spy.assert_not_called()
    assert enrollment_target["instance_id"] == template_instance_id


def test_handle_public_reservation_mba_style_skips_booking_child_allocation(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Omitted ``bookingSystem`` is not a per-booking flow; enroll on the template instance."""
    booking_child_spy = MagicMock()
    monkeypatch.setattr(
        "app.api.public_reservations._create_booking_instance_for_service",
        booking_child_spy,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    _patch_public_reservation_db_helpers(monkeypatch)
    hooks = MagicMock()
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        hooks,
    )

    contact_id = uuid4()
    template_instance_id = uuid4()
    service_id = uuid4()
    enrollment_target: dict[str, Any] = {}

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create_with_event(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSalesLead:
        def __init__(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(
        "app.api.public_reservations.SalesLead",
        _FakeSalesLead,
    )

    class _FakeInstanceRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_with_service_by_slug(self, slug: str) -> SimpleNamespace | None:
            if slug.strip().lower() == "test-cohort":
                return _resolved_instance_stub(template_instance_id, service_id)
            return None

    class _FakeEnrollmentRepo:
        def __init__(self, _session: object) -> None:
            pass

        def contact_has_enrollment_for_instance(self, **_kwargs: object) -> bool:
            return False

        def create_enrollment(self, _enrollment: object) -> object:
            return _enrollment

        def try_create_enrollment_with_capacity_guard(
            self, enrollment: object
        ) -> tuple[object | None, str | None]:
            enrollment_target["instance_id"] = enrollment.instance_id
            return enrollment, None

    monkeypatch.setattr(
        "app.api.public_reservations.ServiceInstanceRepository",
        _FakeInstanceRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.EnrollmentRepository",
        _FakeEnrollmentRepo,
    )

    class _FakeSession:
        def commit(self) -> None:
            return None

        def begin(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

        def begin_nested(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.SalesLeadRepository",
        _FakeLeadRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )

    body = _reservation_body()
    del body["serviceTier"]
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    booking_child_spy.assert_not_called()
    assert enrollment_target["instance_id"] == template_instance_id


def test_handle_public_reservation_validation_rejects_missing_terms(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    body = _reservation_body()
    del body["agreedToTermsAndConditions"]
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 400


def test_discount_redemption_rejects_service_scope_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.exceptions import ValidationError

    svc = uuid4()
    other = uuid4()

    class _FakeRow:
        service_id = svc
        instance_id = None
        discount_type = DiscountType.PERCENTAGE
        active = True
        valid_from = None
        valid_until = None
        max_uses = None
        current_uses = 0

    class _FakeDiscountRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_code(self, _code: str) -> object:
            return _FakeRow()

    monkeypatch.setattr(
        "app.api.public_reservations.DiscountCodeRepository",
        _FakeDiscountRepo,
    )

    resolved = _resolved_instance_stub(uuid4(), other)
    payload = {
        "discount_code": "SAVE",
        "service_key": "my-best-auntie-training-course",
        "booking_system": "my-best-auntie-booking",
    }
    with pytest.raises(ValidationError):
        _validate_discount_code_redemption_scope(
            object(),
            payload,
            resolved_service=resolved.service,
            resolved_instance=resolved,
        )


def test_discount_redemption_rejects_instance_scope_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.exceptions import ValidationError

    inst = uuid4()
    other_inst = uuid4()

    class _FakeRow:
        service_id = uuid4()
        instance_id = inst
        discount_type = DiscountType.PERCENTAGE
        active = True
        valid_from = None
        valid_until = None
        max_uses = None
        current_uses = 0

    class _FakeDiscountRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_code(self, _code: str) -> object:
            return _FakeRow()

    monkeypatch.setattr(
        "app.api.public_reservations.DiscountCodeRepository",
        _FakeDiscountRepo,
    )

    resolved = _resolved_instance_stub(other_inst, uuid4())
    payload = {"discount_code": "SAVE", "service_key": "cohort-1"}
    with pytest.raises(ValidationError) as excinfo:
        _validate_discount_code_redemption_scope(
            object(),
            payload,
            resolved_service=resolved.service,
            resolved_instance=resolved,
        )
    assert getattr(excinfo.value, "field", None) == "discountCode"


def test_discount_redemption_rejects_referral_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.exceptions import ValidationError

    class _FakeRow:
        service_id = None
        instance_id = None
        discount_type = DiscountType.REFERRAL
        active = True
        valid_from = None
        valid_until = None
        max_uses = None
        current_uses = 0

    class _FakeDiscountRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_code(self, _code: str) -> object:
            return _FakeRow()

    monkeypatch.setattr(
        "app.api.public_reservations.DiscountCodeRepository",
        _FakeDiscountRepo,
    )

    stub = _resolved_instance_stub(uuid4(), uuid4())
    with pytest.raises(ValidationError) as excinfo:
        _validate_discount_code_redemption_scope(
            object(),
            {"discount_code": "REF"},
            resolved_service=stub.service,
            resolved_instance=stub,
        )
    assert getattr(excinfo.value, "field", None) == "discountCode"


def test_handle_public_reservation_writes_discount_metadata_and_creates_enrollment(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    monkeypatch.setattr(
        "app.api.public_reservations._validate_payment_confirmation",
        lambda *_a, **_k: None,
    )
    hooks = MagicMock()
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        hooks,
    )

    contact_id = uuid4()
    instance_uuid = uuid4()
    discount_uuid = uuid4()

    class _FakeDcRow:
        id = discount_uuid
        service_id = None
        instance_id = None
        discount_type = DiscountType.PERCENTAGE
        active = True
        valid_from = None
        valid_until = None
        max_uses = None
        current_uses = 0

    class _FakeDiscountRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_code(self, code: str) -> object | None:
            if code.strip().lower() == "spring10":
                return _FakeDcRow()
            return None

        def validate_and_increment(self, code_id: object) -> bool:
            assert code_id == discount_uuid
            return True

        def decrement_uses(self, _code_id: object) -> bool:
            return True

    class _FakeInstanceRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_with_service_by_slug(self, slug: str) -> SimpleNamespace | None:
            if slug == "cohort-a":
                return _resolved_instance_stub(instance_uuid, uuid4())
            return None

    created_enrollments: list[object] = []

    class _FakeEnrollmentRepo:
        def __init__(self, _session: object) -> None:
            pass

        def contact_has_enrollment_for_instance(self, **_kwargs: object) -> bool:
            return False

        def try_create_enrollment_with_capacity_guard(
            self, enrollment: object
        ) -> tuple[object | None, str | None]:
            created_enrollments.append(enrollment)
            return enrollment, None

    monkeypatch.setattr(
        "app.api.public_reservations.DiscountCodeRepository",
        _FakeDiscountRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.ServiceInstanceRepository",
        _FakeInstanceRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.EnrollmentRepository",
        _FakeEnrollmentRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.record_reservation_customer_payment",
        lambda *a, **k: (None, None, False),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.set_audit_context",
        lambda *a, **k: None,
    )

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    lead_calls: list[dict[str, object]] = []

    def _fake_ensure(*_a: object, **kwargs: object) -> tuple[SimpleNamespace, bool]:
        lead_calls.append(kwargs)
        return SimpleNamespace(id=uuid4()), True

    monkeypatch.setattr(
        "app.api.public_reservations.ensure_contact_lead",
        _fake_ensure,
    )

    class _FakeSession:
        def commit(self) -> None:
            return None

        def begin(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

        def flush(self) -> None:
            return None

        def delete(self, *_a: object, **_k: object) -> None:
            return None

        def begin_nested(self) -> _FakeBeginNestedCM:
            return _FakeBeginNestedCM()

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.ensure_discount_code_eligible_for_instance",
        lambda *_a, **_k: None,
    )

    body = _reservation_body(
        discountCode="SPRING10",
        serviceInstanceSlug="cohort-a",
    )
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    assert len(created_enrollments) == 1
    en = created_enrollments[0]
    assert en.instance_id == instance_uuid
    assert en.contact_id == contact_id
    assert en.discount_code_id == discount_uuid
    assert lead_calls and lead_calls[0].get("metadata")
    meta = lead_calls[0]["metadata"]
    assert isinstance(meta, dict)
    assert meta.get("discount_code") == "SPRING10"
    assert meta.get("discount_code_id") == str(discount_uuid)


def test_intro_call_new_enrollment_persists_slot_before_free_payment_record(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Slot insert (add + flush) must run before ``record_reservation_customer_payment``."""
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    monkeypatch.setattr(
        "app.api.public_reservations._validate_payment_confirmation",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        MagicMock(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.set_audit_context",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "app.api.public_reservations._create_booking_instance_for_service",
        lambda *_a, **_k: SimpleNamespace(
            id=uuid4(), slug="intro-call-free-15min-20360616030000-deadbeef"
        ),
    )

    slot_start = datetime(2036, 6, 16, 3, 0, 0, tzinfo=UTC)
    slot_end = slot_start + timedelta(minutes=15)
    monkeypatch.setattr(
        "app.api.public_reservations._enforce_intro_call_invariants",
        lambda *_a, **_k: (slot_start, slot_end),
    )

    contact_id = uuid4()
    service_uuid = uuid4()
    intro_catalog_svc = SimpleNamespace(
        id=service_uuid,
        service_key="intro-call",
        title="Intro",
        delivery_mode=MagicMock(),
        location_id=None,
        service_type=ServiceType.INTRO_CALL,
    )

    class _FakeDiscountRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_code(self, _code: str) -> None:
            return None

    class _FakeInstanceRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create_instance(self, booking: object, **_kw: object) -> object:
            booking.id = uuid4()
            return booking

    class _FakeEnrollmentRepo:
        def __init__(self, _session: object) -> None:
            pass

        def contact_has_enrollment_for_instance(self, **_kwargs: object) -> bool:
            return False

        def try_create_enrollment_with_capacity_guard(
            self, enrollment: object
        ) -> tuple[object | None, str | None]:
            return enrollment, None

    ops_holder: dict[str, list[str]] = {"ops": []}

    def _record_payment(*_a: object, **_k: object) -> tuple[None, None, bool]:
        ops = ops_holder["ops"]
        assert "add_intro_slot" in ops
        idx_add = ops.index("add_intro_slot")
        assert any(
            i > idx_add and op == "flush" for i, op in enumerate(ops)
        ), "expected flush after intro slot add before payment record"
        return (None, None, False)

    monkeypatch.setattr(
        "app.api.public_reservations.DiscountCodeRepository",
        _FakeDiscountRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.ServiceInstanceRepository",
        _FakeInstanceRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.EnrollmentRepository",
        _FakeEnrollmentRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.record_reservation_customer_payment",
        _record_payment,
    )

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    monkeypatch.setattr(
        "app.api.public_reservations.ensure_contact_lead",
        lambda *_a, **_k: (SimpleNamespace(id=uuid4()), True),
    )

    class _FakeTxn:
        def __enter__(self) -> None:
            return None

        def __exit__(self, *_a: object) -> bool:
            return False

    class _FakeSession:
        def __init__(self) -> None:
            self.ops = ops_holder["ops"]

        def begin(self) -> _FakeTxn:
            return _FakeTxn()

        def begin_nested(self) -> _FakeTxn:
            return _FakeTxn()

        def add(self, entity: object) -> None:
            if isinstance(entity, InstanceSessionSlot):
                self.ops.append("add_intro_slot")

        def flush(self) -> None:
            self.ops.append("flush")

        def execute(self, *_a: object, **_k: object) -> MagicMock:
            out = MagicMock()
            out.scalar_one_or_none.return_value = intro_catalog_svc
            return out

        def commit(self) -> None:
            return None

        def delete(self, *_a: object, **_k: object) -> None:
            return None

        def get(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.AuditService",
        lambda *_a, **_k: MagicMock(),
    )

    body = {
        "attendeeName": "Pat Parent",
        "attendeeEmail": "pat@example.com",
        "attendeePhone": "",
        "serviceKey": "intro-call",
        "serviceInstanceSlug": "intro-call-free-15min",
        "paymentMethod": "free",
        "totalAmount": 0,
        "title": "Intro",
        "agreedToTermsAndConditions": True,
        "locale": "en",
        "bookingSystem": "intro-call-booking",
        "primarySessionStartIso": slot_start.isoformat().replace("+00:00", "Z"),
        "primarySessionEndIso": slot_end.isoformat().replace("+00:00", "Z"),
        "marketingOptIn": False,
    }
    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    assert "add_intro_slot" in ops_holder["ops"]


def test_handle_public_reservation_consultation_booking_accepts_extra_slot_start_only(
    api_gateway_event: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Extra ``sessionSlots`` rows may omit ``endIso``; end is derived from primary duration."""
    monkeypatch.setattr(
        "app.api.public_reservations.verify_turnstile_token",
        lambda *_a, **_k: True,
    )
    monkeypatch.setattr(
        "app.api.public_reservations._validate_payment_confirmation",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        "app.services.calendar_blockers.raise_if_consultation_reservation_blocked",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        "app.api.public_reservations._run_reservation_post_success_hooks",
        MagicMock(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.set_audit_context",
        lambda *a, **k: None,
    )

    booking_child_id = uuid4()
    service_uuid = uuid4()
    consult_catalog_svc = SimpleNamespace(
        id=service_uuid,
        service_key="family-consultation-essentials",
        title="Essentials",
        delivery_mode=MagicMock(),
        location_id=None,
        service_type=ServiceType.CONSULTATION,
    )
    monkeypatch.setattr(
        "app.api.public_reservations._create_booking_instance_for_service",
        lambda *_a, **_k: SimpleNamespace(
            id=booking_child_id,
            slug="consult-book-20360701103000-abcd1234",
        ),
    )

    class _FakeDiscountRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_code(self, _code: str) -> None:
            return None

    class _FakeInstanceRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create_instance(self, booking: object, **_kw: object) -> object:
            booking.id = booking_child_id
            return booking

    class _FakeEnrollmentRepo:
        def __init__(self, _session: object) -> None:
            pass

        def contact_has_enrollment_for_instance(self, **_kwargs: object) -> bool:
            return False

        def try_create_enrollment_with_capacity_guard(
            self, enrollment: object
        ) -> tuple[object | None, str | None]:
            return enrollment, None

    ops_holder: dict[str, int] = {"slots": 0}

    monkeypatch.setattr(
        "app.api.public_reservations.DiscountCodeRepository",
        _FakeDiscountRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.ServiceInstanceRepository",
        _FakeInstanceRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.EnrollmentRepository",
        _FakeEnrollmentRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.record_reservation_customer_payment",
        lambda *a, **k: (None, None, False),
    )

    contact_id = uuid4()

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def upsert_by_email(self, _email: str, **kwargs: object) -> tuple[object, bool]:
            c = MagicMock()
            c.id = contact_id
            c.phone_region = None
            c.phone_national_number = None
            return c, True

        def update(self, *_a: object, **_k: object) -> None:
            return None

    monkeypatch.setattr(
        "app.api.public_reservations.ensure_contact_lead",
        lambda *_a, **_k: (SimpleNamespace(id=uuid4()), True),
    )

    class _FakeTxn:
        def __enter__(self) -> None:
            return None

        def __exit__(self, *_a: object) -> bool:
            return False

    class _FakeSession:
        def begin(self) -> _FakeTxn:
            return _FakeTxn()

        def begin_nested(self) -> _FakeTxn:
            return _FakeTxn()

        def add(self, entity: object) -> None:
            if isinstance(entity, InstanceSessionSlot):
                ops_holder["slots"] += 1

        def flush(self) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> MagicMock:
            out = MagicMock()
            out.scalar_one_or_none.return_value = consult_catalog_svc
            return out

        def commit(self) -> None:
            return None

        def delete(self, *_a: object, **_k: object) -> None:
            return None

        def get(self, *_a: object, **_k: object) -> None:
            return None

    class _FakeSessionCM:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setattr(
        "app.api.public_reservations.ContactRepository",
        _FakeContactRepo,
    )
    monkeypatch.setattr(
        "app.api.public_reservations.Session",
        lambda _e: _FakeSessionCM(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.get_engine",
        lambda: object(),
    )
    monkeypatch.setattr(
        "app.api.public_reservations.AuditService",
        lambda *_a, **_k: MagicMock(),
    )

    body = _reservation_body(
        paymentMethod="free",
        totalAmount=0,
        reservationPendingUntilPaymentConfirmed=False,
    )
    body["serviceKey"] = "family-consultation-essentials"
    body["bookingSystem"] = "consultation-booking"
    body["primarySessionStartIso"] = "2026-07-01T01:00:00.000Z"
    body["primarySessionEndIso"] = "2026-07-01T04:00:00.000Z"
    body["sessionSlots"] = [{"startIso": "2026-07-02T06:00:00.000Z"}]

    event = _post_event(api_gateway_event, body)
    resp = _handle_public_reservation(event, "POST")
    assert resp["statusCode"] == 202
    assert ops_holder["slots"] == 2
