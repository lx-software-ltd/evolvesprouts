"""Regression tests for instance update after bulk partner link reconciliation."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pytest

from app.api import admin_service_instances
from app.api.admin_services_common import parse_update_instance_payload
from app.api.admin_request import RequestIdentity
from app.db.models.enums import (
    InstanceStatus,
    ServiceDeliveryMode,
    ServiceStatus,
    ServiceType,
)
from app.db.models.service import Service
from app.db.models.service_instance import ServiceInstance
from app.exceptions import ValidationError

pytestmark = pytest.mark.filterwarnings("ignore::sqlalchemy.exc.SAWarning")


def _admin_identity() -> RequestIdentity:
    return RequestIdentity(
        user_sub="test-admin-sub-12345",
        groups={"admin"},
        organization_ids={"org-1"},
    )


def _minimal_event_service() -> Service:
    sid = uuid4()
    return Service(
        id=sid,
        service_type=ServiceType.EVENT,
        title="Event",
        service_key="evt",
        booking_system=None,
        description=None,
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.IN_PERSON,
        status=ServiceStatus.PUBLISHED,
        created_by="tester",
    )


def test_parse_update_instance_payload_allows_partner_only_with_status_and_tiers() -> (
    None
):
    """PUT body may include only partner_organization_ids when status+tiers present."""
    service = _minimal_event_service()
    body = {
        "status": "scheduled",
        "event_ticket_tiers": [{"price": "10.00", "currency": "HKD"}],
        "partner_organization_ids": [str(uuid4())],
    }
    parsed = parse_update_instance_payload(body, service)
    assert "partner_organization_ids" in parsed


def test_update_instance_skips_repository_update_instance_after_partner_reconcile(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    """Commit path does not call repository update (no session.add on instance)."""
    service_id = uuid4()
    instance_id = uuid4()
    org_a = uuid4()
    org_b = uuid4()

    service = _minimal_event_service()
    service.id = service_id
    instance = ServiceInstance(
        id=instance_id,
        service_id=service_id,
        title="Inst",
        slug="inst-slug",
        description=None,
        cover_image_s3_key=None,
        status=InstanceStatus.SCHEDULED,
        delivery_mode=ServiceDeliveryMode.IN_PERSON,
        location_id=None,
        max_capacity=None,
        waitlist_enabled=False,
        instructor_id=None,
        cohort=None,
        notes=None,
        external_url=None,
        created_by="tester",
    )
    instance.service = service

    captured: dict[str, Any] = {}

    class _FakeSession:
        def commit(self) -> None:
            captured["committed"] = True

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            self._session = _FakeSession()

        def __enter__(self) -> _FakeSession:
            return self._session

        def __exit__(self, *_args: Any) -> bool:
            return False

    class _FakeServiceRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_with_details(self, sid: Any) -> Service:
            assert sid == service_id
            return service

    class _FakeInstanceRepository:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_with_details(self, iid: Any) -> ServiceInstance:
            assert iid == instance_id
            return instance

        def get_by_id_with_details_after(self, iid: Any) -> ServiceInstance | None:
            assert iid == instance_id
            return instance

    def _fake_parse_body(_event: Any) -> dict[str, Any]:
        return {
            "status": "scheduled",
            "event_ticket_tiers": [{"price": "10.00", "currency": "HKD"}],
            "partner_organization_ids": [str(org_b), str(org_a)],
        }

    def _fake_reconcile(
        session: Any,
        *,
        instance_id: Any,
        ordered_org_ids: list[Any],
    ) -> None:
        captured["reconcile_ids"] = list(ordered_org_ids)

    monkeypatch.setattr(admin_service_instances, "Session", _SessionCtx)
    monkeypatch.setattr(admin_service_instances, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_service_instances,
        "extract_identity",
        lambda _event: _admin_identity(),
    )
    monkeypatch.setattr(
        admin_service_instances, "set_audit_context", lambda *_a, **_k: None
    )
    monkeypatch.setattr(admin_service_instances, "parse_body", _fake_parse_body)
    monkeypatch.setattr(
        admin_service_instances,
        "parse_update_instance_payload",
        lambda body, svc: {
            "status": InstanceStatus.SCHEDULED,
            "type_details": {
                "event_ticket_tiers": [
                    {
                        "name": "workshop",
                        "description": None,
                        "price": Decimal("10.00"),
                        "currency": "HKD",
                        "max_quantity": None,
                        "sort_order": 0,
                    }
                ]
            },
            "partner_organization_ids": [org_b, org_a],
        },
    )
    monkeypatch.setattr(
        admin_service_instances,
        "validate_partner_organization_ids",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_service_instances,
        "reconcile_instance_partner_organizations",
        _fake_reconcile,
    )
    monkeypatch.setattr(
        admin_service_instances,
        "replace_service_instance_tags",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        admin_service_instances,
        "enqueue_eventbrite_instance_sync_by_id",
        lambda iid: captured.setdefault("sync_id", iid),
    )
    monkeypatch.setattr(
        admin_service_instances,
        "serialize_instance",
        lambda inst, **_kwargs: {"id": str(inst.id), "partner_ok": True},
    )
    monkeypatch.setattr(
        admin_service_instances,
        "ServiceRepository",
        _FakeServiceRepository,
    )
    monkeypatch.setattr(
        admin_service_instances,
        "ServiceInstanceRepository",
        _FakeInstanceRepository,
    )

    path = f"/v1/admin/services/{service_id}/instances/{instance_id}"
    response = admin_service_instances.handle_admin_service_instances_request(
        api_gateway_event(method="PUT", path=path, body="{}"),
        "PUT",
        path,
        service_id,
    )

    assert response["statusCode"] == 200
    assert captured.get("committed") is True
    assert captured.get("reconcile_ids") == [org_b, org_a]
    assert captured.get("sync_id") == instance_id
    body = json.loads(response["body"])
    assert body["instance"]["partner_ok"] is True


def test_parse_update_instance_payload_partner_only_without_tiers_raises() -> None:
    service = _minimal_event_service()
    body = {
        "status": "scheduled",
        "partner_organization_ids": [str(uuid4())],
    }
    with pytest.raises(ValidationError) as exc:
        parse_update_instance_payload(body, service)
    assert exc.value.field == "event_ticket_tiers"
