"""Unit tests for bulk_reconcile_instance_capacity_status."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import UUID, uuid4

from app.api.instance_capacity_status import bulk_reconcile_instance_capacity_status
from app.db.models import ServiceInstance
from app.db.models.enums import (
    InstanceStatus,
    ServiceDeliveryMode,
    ServiceStatus,
    ServiceType,
)


def _minimal_instance(
    *,
    instance_id: UUID,
    max_capacity: int | None,
    status: InstanceStatus,
    capacity_left_override: int | None = None,
    service_type: ServiceType = ServiceType.EVENT,
) -> ServiceInstance:
    sid = uuid4()
    from app.db.models import Service

    service = Service(
        id=sid,
        service_type=service_type,
        title="E",
        service_key="e",
        booking_system=None,
        description=None,
        cover_image_s3_key=None,
        delivery_mode=ServiceDeliveryMode.ONLINE,
        status=ServiceStatus.PUBLISHED,
        created_by="t",
    )
    inst = ServiceInstance(
        id=instance_id,
        service_id=sid,
        title=None,
        slug="event-capacity-1",
        description=None,
        cover_image_s3_key=None,
        status=status,
        delivery_mode=None,
        location_id=None,
        max_capacity=max_capacity,
        capacity_left_override=capacity_left_override,
        waitlist_enabled=False,
        instructor_id=None,
        cohort=None,
        notes=None,
        created_by="t",
        external_url=None,
    )
    inst.service = service
    return inst


def test_reconcile_sets_full_when_open_and_at_capacity(monkeypatch) -> None:
    iid = uuid4()
    instance = _minimal_instance(
        instance_id=iid, max_capacity=2, status=InstanceStatus.OPEN
    )
    session = MagicMock()

    class _Repo:
        def __init__(self, _session) -> None:
            pass

        def get_enrollment_counts_for_instances(self, ids):
            assert ids == [iid]
            return {iid: 2}

    monkeypatch.setattr(
        "app.api.instance_capacity_status.ServiceInstanceRepository", _Repo
    )
    bulk_reconcile_instance_capacity_status(session, [instance])
    assert instance.status == InstanceStatus.FULL
    session.flush.assert_called_once()


def test_reconcile_leaves_scheduled_when_at_capacity(monkeypatch) -> None:
    iid = uuid4()
    instance = _minimal_instance(
        instance_id=iid, max_capacity=1, status=InstanceStatus.SCHEDULED
    )
    session = MagicMock()

    class _Repo:
        def __init__(self, _session) -> None:
            pass

        def get_enrollment_counts_for_instances(self, ids):
            return {iid: 1}

    monkeypatch.setattr(
        "app.api.instance_capacity_status.ServiceInstanceRepository", _Repo
    )
    bulk_reconcile_instance_capacity_status(session, [instance])
    assert instance.status == InstanceStatus.SCHEDULED
    session.flush.assert_not_called()


def test_reconcile_sets_full_from_scheduled_training(monkeypatch) -> None:
    iid = uuid4()
    instance = _minimal_instance(
        instance_id=iid,
        max_capacity=1,
        status=InstanceStatus.SCHEDULED,
        service_type=ServiceType.TRAINING_COURSE,
    )
    session = MagicMock()

    class _Repo:
        def __init__(self, _session) -> None:
            pass

        def get_enrollment_counts_for_instances(self, ids):
            return {iid: 1}

    monkeypatch.setattr(
        "app.api.instance_capacity_status.ServiceInstanceRepository", _Repo
    )
    bulk_reconcile_instance_capacity_status(session, [instance])
    assert instance.status == InstanceStatus.FULL
    session.flush.assert_called_once()


def test_reconcile_opens_full_when_seats_available(monkeypatch) -> None:
    iid = uuid4()
    instance = _minimal_instance(
        instance_id=iid, max_capacity=3, status=InstanceStatus.FULL
    )
    session = MagicMock()

    class _Repo:
        def __init__(self, _session) -> None:
            pass

        def get_enrollment_counts_for_instances(self, ids):
            return {iid: 1}

    monkeypatch.setattr(
        "app.api.instance_capacity_status.ServiceInstanceRepository", _Repo
    )
    bulk_reconcile_instance_capacity_status(session, [instance])
    assert instance.status == InstanceStatus.OPEN
    session.flush.assert_called_once()


def test_reconcile_skips_when_session_has_no_execute(monkeypatch) -> None:
    """Unit tests use minimal fake sessions without SQLAlchemy execute()."""
    iid = uuid4()
    instance = _minimal_instance(
        instance_id=iid, max_capacity=2, status=InstanceStatus.OPEN
    )

    def _boom(_session):
        raise AssertionError("repository should not be used without DB session")

    monkeypatch.setattr(
        "app.api.instance_capacity_status.ServiceInstanceRepository", _boom
    )
    bulk_reconcile_instance_capacity_status(object(), [instance])
    assert instance.status == InstanceStatus.OPEN


def test_reconcile_no_flush_when_nothing_changes(monkeypatch) -> None:
    iid = uuid4()
    instance = _minimal_instance(
        instance_id=iid, max_capacity=None, status=InstanceStatus.OPEN
    )
    session = MagicMock()

    class _Repo:
        def __init__(self, _session) -> None:
            pass

        def get_enrollment_counts_for_instances(self, ids):
            return {iid: 99}

    monkeypatch.setattr(
        "app.api.instance_capacity_status.ServiceInstanceRepository", _Repo
    )
    bulk_reconcile_instance_capacity_status(session, [instance])
    assert instance.status == InstanceStatus.OPEN
    session.flush.assert_not_called()


def test_reconcile_sets_full_only_when_enrollments_reach_max_ignores_override(
    monkeypatch,
) -> None:
    """FULL follows enrollment count vs max_capacity; display override does not apply."""
    iid = uuid4()
    instance = _minimal_instance(
        instance_id=iid,
        max_capacity=10,
        status=InstanceStatus.OPEN,
        capacity_left_override=2,
    )
    session = MagicMock()

    class _RepoNine:
        def __init__(self, _session) -> None:
            pass

        def get_enrollment_counts_for_instances(self, ids):
            assert ids == [iid]
            return {iid: 9}

    monkeypatch.setattr(
        "app.api.instance_capacity_status.ServiceInstanceRepository", _RepoNine
    )
    bulk_reconcile_instance_capacity_status(session, [instance])
    assert instance.status == InstanceStatus.OPEN

    class _RepoTen:
        def __init__(self, _session) -> None:
            pass

        def get_enrollment_counts_for_instances(self, ids):
            return {iid: 10}

    monkeypatch.setattr(
        "app.api.instance_capacity_status.ServiceInstanceRepository", _RepoTen
    )
    bulk_reconcile_instance_capacity_status(session, [instance])
    assert instance.status == InstanceStatus.FULL
