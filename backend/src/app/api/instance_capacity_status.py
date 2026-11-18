"""Derive instance status from enrollment capacity vs max_capacity."""

from __future__ import annotations

from typing import Any

from app.db.models import ServiceInstance
from app.db.models.enums import InstanceStatus, ServiceType
from app.db.repositories import ServiceInstanceRepository


def bulk_reconcile_instance_capacity_status(
    session: Any, instances: list[ServiceInstance]
) -> None:
    """Set status FULL when a capped instance has no seats; reopen FULL to OPEN.

    Only considers instances with ``max_capacity`` set. An ``open`` instance
    becomes ``full``, and a ``full`` instance returns to ``open`` when a seat
    frees. A ``scheduled`` event stays ``scheduled``. A ``scheduled`` training
    course still becomes ``full``. Other statuses are unchanged.
    Persists with ``session.flush()`` when any row changes (caller may ``commit()``).
    """
    if not instances:
        return
    if not any(getattr(row, "max_capacity", None) is not None for row in instances):
        return
    if not hasattr(session, "execute"):
        return
    repository = ServiceInstanceRepository(session)
    ids = [row.id for row in instances]
    counts = repository.get_enrollment_counts_for_instances(ids)
    changed = False
    for instance in instances:
        cap = instance.max_capacity
        if cap is None:
            continue
        used = counts.get(instance.id, 0)
        if used >= cap and _becomes_full_when_capped(instance):
            instance.status = InstanceStatus.FULL
            changed = True
        elif instance.status == InstanceStatus.FULL:
            instance.status = InstanceStatus.OPEN
            changed = True
    if changed:
        session.flush()


def _becomes_full_when_capped(instance: ServiceInstance) -> bool:
    if instance.status == InstanceStatus.OPEN:
        return True
    if instance.status != InstanceStatus.SCHEDULED:
        return False
    service = getattr(instance, "service", None)
    return getattr(service, "service_type", None) != ServiceType.EVENT
