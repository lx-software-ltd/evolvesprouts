from __future__ import annotations

import json
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.api import admin_enrollments
from app.api.admin_services_payloads import parse_update_enrollment_payload
from app.db.models import Contact, Family
from app.db.models.enums import BillingBillToKind, EnrollmentStatus, RelationshipType
from app.exceptions import ValidationError


def _patch_enrollment_discount_scope_ok(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        admin_enrollments,
        "service_id_for_instance",
        lambda _session, _instance_id: uuid4(),
    )
    monkeypatch.setattr(
        admin_enrollments,
        "ensure_discount_code_eligible_for_instance",
        lambda *_a, **_k: None,
    )


def test_create_enrollment_rejects_invalid_or_exhausted_discount_code(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    instance_id = uuid4()
    discount_code_id = uuid4()

    class _FakeSession:
        def commit(self) -> None:
            raise AssertionError("commit should not run when discount code is invalid")

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            self._session = _FakeSession()

        def __enter__(self) -> _FakeSession:
            return self._session

        def __exit__(self, *_args: Any) -> bool:
            return False

    class _FakeDiscountCodeRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def validate_and_increment(self, _code_id: Any) -> bool:
            return False

    class _FakeEnrollmentRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def create_enrollment(self, _enrollment: Any) -> Any:
            raise AssertionError(
                "create_enrollment should not run for invalid discount code"
            )

    monkeypatch.setattr(admin_enrollments, "Session", _SessionCtx)
    monkeypatch.setattr(admin_enrollments, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_enrollments, "set_audit_context", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(admin_enrollments, "parse_body", lambda _event: {})
    monkeypatch.setattr(
        admin_enrollments,
        "parse_create_enrollment_payload",
        lambda _body: {
            "contact_id": uuid4(),
            "family_id": None,
            "organization_id": None,
            "ticket_tier_id": None,
            "discount_code_id": discount_code_id,
            "status": EnrollmentStatus.REGISTERED,
            "amount_paid": None,
            "currency": None,
            "notes": None,
        },
    )
    monkeypatch.setattr(
        admin_enrollments,
        "DiscountCodeRepository",
        _FakeDiscountCodeRepository,
    )
    monkeypatch.setattr(
        admin_enrollments,
        "EnrollmentRepository",
        _FakeEnrollmentRepository,
    )
    _patch_enrollment_discount_scope_ok(monkeypatch)

    with pytest.raises(ValidationError, match="Discount code is invalid"):
        admin_enrollments._create_enrollment(
            api_gateway_event(
                method="POST", path="/v1/admin/services/x/instances/y/enrollments"
            ),
            instance_id=instance_id,
            actor_sub="test-admin-sub-12345",
        )


def test_create_enrollment_with_discount_code_calls_validate_and_increment(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    instance_id = uuid4()
    discount_code_id = uuid4()
    contact_id = uuid4()

    class _FakeSession:
        def commit(self) -> None:
            return None

        def flush(self) -> None:
            return None

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            self._session = _FakeSession()

        def __enter__(self) -> _FakeSession:
            return self._session

        def __exit__(self, *_args: Any) -> bool:
            return False

    validate_calls: list[Any] = []

    class _FakeDiscountCodeRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def validate_and_increment(self, code_id: Any) -> bool:
            validate_calls.append(code_id)
            return True

    created_holder: dict[str, Any] = {}

    class _FakeEnrollment:
        def __init__(self, **kwargs: Any) -> None:
            self.__dict__.update(kwargs)

    class _FakeEnrollmentRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def create_enrollment(self, enrollment: Any) -> Any:
            created_holder["discount_code_id"] = enrollment.discount_code_id
            created_holder["amount_paid"] = enrollment.amount_paid
            return enrollment

    monkeypatch.setattr(admin_enrollments, "Session", _SessionCtx)
    monkeypatch.setattr(admin_enrollments, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_enrollments, "set_audit_context", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        admin_enrollments,
        "batch_enrollment_party_display_names",
        lambda _session, rows: ["—"] * len(rows),
    )
    monkeypatch.setattr(
        admin_enrollments,
        "parse_body",
        lambda _event: json.loads(_event["body"]),
    )
    monkeypatch.setattr(
        admin_enrollments,
        "parse_create_enrollment_payload",
        lambda _body: {
            "contact_id": contact_id,
            "family_id": None,
            "organization_id": None,
            "ticket_tier_id": None,
            "discount_code_id": discount_code_id,
            "status": EnrollmentStatus.REGISTERED,
            "amount_paid": None,
            "currency": None,
            "notes": None,
        },
    )
    monkeypatch.setattr(
        admin_enrollments,
        "DiscountCodeRepository",
        _FakeDiscountCodeRepository,
    )
    monkeypatch.setattr(admin_enrollments, "Enrollment", _FakeEnrollment)
    monkeypatch.setattr(
        admin_enrollments,
        "EnrollmentRepository",
        _FakeEnrollmentRepository,
    )

    class _FakeServiceInstanceRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id(self, _instance_id: Any) -> None:
            return None

    monkeypatch.setattr(
        admin_enrollments,
        "ServiceInstanceRepository",
        _FakeServiceInstanceRepository,
    )
    monkeypatch.setattr(
        admin_enrollments,
        "serialize_enrollment",
        lambda e, **_kwargs: {
            "id": "new-1",
            "discount_code_id": str(e.discount_code_id),
        },
    )
    _patch_enrollment_discount_scope_ok(monkeypatch)

    response = admin_enrollments._create_enrollment(
        api_gateway_event(
            method="POST",
            path="/v1/admin/services/x/instances/y/enrollments",
            body=json.dumps(
                {
                    "contact_id": str(contact_id),
                    "discount_code_id": str(discount_code_id),
                }
            ),
        ),
        instance_id=instance_id,
        actor_sub="test-admin-sub-12345",
    )

    assert response["statusCode"] == 201
    assert validate_calls == [discount_code_id]
    assert created_holder["discount_code_id"] == discount_code_id
    assert created_holder["amount_paid"] is None


def test_update_enrollment_discount_swaps_usage_counts(
    monkeypatch: Any, api_gateway_event: Any
) -> None:
    target_instance_id = uuid4()
    enrollment_id = uuid4()
    old_dc = uuid4()
    new_dc = uuid4()

    class _FakeEnrollment:
        instance_id = target_instance_id
        discount_code_id = old_dc
        status = EnrollmentStatus.REGISTERED
        cancelled_at = None
        amount_paid = None
        currency = None
        notes = None

    decrement_calls: list[Any] = []
    increment_calls: list[Any] = []

    class _FakeDiscountRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def decrement_uses(self, code_id: Any) -> bool:
            decrement_calls.append(code_id)
            return True

        def validate_and_increment(self, code_id: Any) -> bool:
            increment_calls.append(code_id)
            return True

    class _FakeEnrollmentRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id(self, eid: Any) -> Any:
            if eid == enrollment_id:
                return _FakeEnrollment()
            return None

        def update(self, enrollment: Any) -> Any:
            return enrollment

    class _FakeSession:
        def commit(self) -> None:
            return None

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            self._session = _FakeSession()

        def __enter__(self) -> _FakeSession:
            return self._session

        def __exit__(self, *_args: Any) -> bool:
            return False

    monkeypatch.setattr(admin_enrollments, "Session", _SessionCtx)
    monkeypatch.setattr(admin_enrollments, "get_engine", lambda: object())
    monkeypatch.setattr(admin_enrollments, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(
        admin_enrollments,
        "batch_enrollment_party_display_names",
        lambda _session, rows: ["—"] * len(rows),
    )
    monkeypatch.setattr(
        admin_enrollments,
        "parse_body",
        lambda _e: json.loads(_e["body"]),
    )
    monkeypatch.setattr(
        admin_enrollments,
        "parse_update_enrollment_payload",
        lambda _body: {"discount_code_id": new_dc},
    )
    monkeypatch.setattr(admin_enrollments, "EnrollmentRepository", _FakeEnrollmentRepo)
    monkeypatch.setattr(admin_enrollments, "DiscountCodeRepository", _FakeDiscountRepo)
    monkeypatch.setattr(
        admin_enrollments,
        "serialize_enrollment",
        lambda e, **_kwargs: {
            "id": str(enrollment_id),
            "discount_code_id": str(e.discount_code_id),
        },
    )
    _patch_enrollment_discount_scope_ok(monkeypatch)

    resp = admin_enrollments._update_enrollment(
        api_gateway_event(
            method="PATCH",
            path="/v1/admin/services/x/instances/y/enrollments/z",
            body=json.dumps({"discount_code_id": str(new_dc)}),
        ),
        instance_id=target_instance_id,
        enrollment_id=enrollment_id,
        actor_sub="test-admin-sub-12345",
    )
    assert resp["statusCode"] == 200
    assert decrement_calls == [old_dc]
    assert increment_calls == [new_dc]


def test_parse_update_enrollment_payload_accepts_enrolled_at() -> None:
    parsed = parse_update_enrollment_payload(
        {"enrolled_at": "2026-05-01T08:30:00+00:00"}
    )
    assert parsed["enrolled_at"].year == 2026
    assert parsed["enrolled_at"].month == 5
    assert parsed["enrolled_at"].day == 1


def test_parse_update_enrollment_payload_rejects_cleared_enrolled_at() -> None:
    with pytest.raises(ValidationError, match="enrolled_at"):
        parse_update_enrollment_payload({"enrolled_at": None})


def test_parse_update_enrollment_payload_rejects_empty_enrolled_at() -> None:
    with pytest.raises(ValidationError, match="enrolled_at"):
        parse_update_enrollment_payload({"enrolled_at": ""})


def test_parse_update_enrollment_payload_accepts_promote_to_family_id() -> None:
    fid = uuid4()
    parsed = parse_update_enrollment_payload({"promote_to_family_id": str(fid)})
    assert parsed["promote_to_family_id"] == fid


def test_parse_update_enrollment_payload_accepts_promote_to_organization_id() -> None:
    oid = uuid4()
    parsed = parse_update_enrollment_payload({"promote_to_organization_id": str(oid)})
    assert parsed["promote_to_organization_id"] == oid


def test_parse_update_enrollment_payload_rejects_both_promote_fields() -> None:
    with pytest.raises(ValidationError, match="promote"):
        parse_update_enrollment_payload(
            {
                "promote_to_family_id": str(uuid4()),
                "promote_to_organization_id": str(uuid4()),
            }
        )


class _FakeScalarResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def __iter__(self) -> Iterator[Any]:
        return iter(self._rows)

    def all(self) -> list[Any]:
        return self._rows


def test_promote_contact_enrollment_to_family_updates_row(
    monkeypatch: Any, api_gateway_event: Any
) -> None:
    target_instance_id = uuid4()
    enrollment_id = uuid4()
    contact_uuid = uuid4()
    family_id = uuid4()
    member_id = uuid4()
    family_row = SimpleNamespace(
        id=family_id, relationship_type=RelationshipType.PROSPECT
    )
    member_contact = SimpleNamespace(
        id=member_id, relationship_type=RelationshipType.PROSPECT
    )

    class _MutableEnrollment:
        instance_id = target_instance_id
        contact_id: UUID | None = contact_uuid
        family_id: UUID | None = None
        organization_id: UUID | None = None
        bill_to_kind = None
        bill_to_contact_id: UUID | None = contact_uuid
        bill_to_family_id = None
        bill_to_organization_id = None
        discount_code_id = None
        status = EnrollmentStatus.REGISTERED
        cancelled_at = None
        amount_paid = None
        currency = None
        notes = None

    held: dict[str, Any] = {"row": _MutableEnrollment()}

    class _FakeEnrollmentRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id(self, eid: Any) -> Any:
            if eid == enrollment_id:
                return held["row"]
            return None

        def update(self, enrollment: Any) -> Any:
            return enrollment

    class _FakeDiscountRepo:
        def __init__(self, _session: Any) -> None:
            pass

    class _FakeSession:
        def commit(self) -> None:
            return None

        def get(self, model: Any, eid: Any) -> Any:
            if model is Family and eid == family_id:
                return family_row
            if model is Contact and eid == member_id:
                return member_contact
            return None

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            self._session = _FakeSession()

        def __enter__(self) -> _FakeSession:
            return self._session

        def __exit__(self, *_args: Any) -> bool:
            return False

    monkeypatch.setattr(admin_enrollments, "Session", _SessionCtx)
    monkeypatch.setattr(admin_enrollments, "get_engine", lambda: object())
    monkeypatch.setattr(admin_enrollments, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(
        admin_enrollments,
        "batch_enrollment_party_display_names",
        lambda _session, rows: ["—"] * len(rows),
    )
    monkeypatch.setattr(
        admin_enrollments,
        "parse_body",
        lambda _e: json.loads(_e["body"]),
    )
    monkeypatch.setattr(admin_enrollments, "EnrollmentRepository", _FakeEnrollmentRepo)
    monkeypatch.setattr(admin_enrollments, "DiscountCodeRepository", _FakeDiscountRepo)

    class _FakeSvcRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id(self, _iid: Any) -> None:
            return None

    monkeypatch.setattr(admin_enrollments, "ServiceInstanceRepository", _FakeSvcRepo)
    monkeypatch.setattr(
        admin_enrollments,
        "bulk_reconcile_instance_capacity_status",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_enrollments,
        "serialize_enrollment",
        lambda e, **_kwargs: {"id": str(enrollment_id), "family_id": str(e.family_id)},
    )
    _patch_enrollment_discount_scope_ok(monkeypatch)

    resp = admin_enrollments._update_enrollment(
        api_gateway_event(
            method="PATCH",
            path="/v1/admin/services/x/instances/y/enrollments/z",
            body=json.dumps(
                {"promote_to_family_id": str(family_id), "status": "registered"}
            ),
        ),
        instance_id=target_instance_id,
        enrollment_id=enrollment_id,
        actor_sub="test-admin-sub-12345",
    )
    assert resp["statusCode"] == 200
    row = held["row"]
    assert row.contact_id is None
    assert row.family_id == family_id
    assert row.organization_id is None
    assert row.bill_to_kind == BillingBillToKind.FAMILY
    assert row.bill_to_family_id == family_id
    assert row.bill_to_contact_id is None
    # Moving the enrollment onto a family must not promote CRM parties; only
    # full invoice payment allocation does that.
    assert family_row.relationship_type == RelationshipType.PROSPECT
    assert member_contact.relationship_type == RelationshipType.PROSPECT


def test_delete_enrollment_decrements_discount_usage(
    monkeypatch: Any, api_gateway_event: Any
) -> None:
    target_instance_id = uuid4()
    enrollment_id = uuid4()
    dc_id = uuid4()

    class _FakeEnrollment:
        instance_id = target_instance_id
        discount_code_id = dc_id

    decrement_calls: list[Any] = []

    class _FakeDiscountRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def decrement_uses(self, code_id: Any) -> bool:
            decrement_calls.append(code_id)
            return True

    class _FakeEnrollmentRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id(self, eid: Any) -> Any:
            if eid == enrollment_id:
                return _FakeEnrollment()
            return None

        def delete(self, _enrollment: Any) -> None:
            return None

    class _FakeSession:
        def commit(self) -> None:
            return None

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            self._session = _FakeSession()

        def __enter__(self) -> _FakeSession:
            return self._session

        def __exit__(self, *_args: Any) -> bool:
            return False

    monkeypatch.setattr(admin_enrollments, "Session", _SessionCtx)
    monkeypatch.setattr(admin_enrollments, "get_engine", lambda: object())
    monkeypatch.setattr(admin_enrollments, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(admin_enrollments, "EnrollmentRepository", _FakeEnrollmentRepo)
    monkeypatch.setattr(admin_enrollments, "DiscountCodeRepository", _FakeDiscountRepo)

    resp = admin_enrollments._delete_enrollment(
        api_gateway_event(
            method="DELETE", path="/v1/admin/services/x/instances/y/enrollments/z"
        ),
        instance_id=target_instance_id,
        enrollment_id=enrollment_id,
        actor_sub="test-admin-sub-12345",
    )
    assert resp["statusCode"] == 204
    assert decrement_calls == [dc_id]


def test_try_create_enrollment_capacity_guard_ignores_capacity_left_override() -> None:
    """Booking uses max_capacity vs enrollment count; override is display-only."""
    from contextlib import contextmanager

    from app.db.repositories.enrollment import EnrollmentRepository

    iid = uuid4()
    instance_row = SimpleNamespace(
        id=iid,
        max_capacity=10,
        capacity_left_override=2,
        waitlist_enabled=False,
    )

    class _ExecResult:
        def __init__(self, value: object) -> None:
            self._value = value

        def scalar_one_or_none(self) -> object:
            return self._value

    call_n = 0

    class _FakeSession:
        def execute(self, _stmt: object) -> _ExecResult:
            nonlocal call_n
            call_n += 1
            if call_n == 1:
                return _ExecResult(instance_row)
            if call_n == 2:
                return _ExecResult(3)
            raise AssertionError(f"unexpected execute call {call_n}")

        def begin_nested(self):
            @contextmanager
            def _cm():
                yield

            return _cm()

        def add(self, _obj: object) -> None:
            return None

        def flush(self) -> None:
            return None

        def refresh(self, _obj: object) -> None:
            return None

    enrollment = SimpleNamespace(instance_id=iid)
    repo = EnrollmentRepository(_FakeSession())  # type: ignore[arg-type]
    created, err = repo.try_create_enrollment_with_capacity_guard(enrollment)
    assert err is None
    assert created is enrollment
