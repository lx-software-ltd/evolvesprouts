"""Derive instance status from enrollment capacity vs max_capacity."""

from __future__ import annotations

from typing import Any

from app.db.models import ServiceInstance
from app.db.models.enums import InstanceStatus
from app.db.repositories import ServiceInstanceRepository


def bulk_reconcile_instance_capacity_status(
    session: Any, instances: list[ServiceInstance]
) -> None:
    """Set status FULL when an open capped instance has no seats; reopen FULL to OPEN.

    Only considers instances with ``max_capacity`` set. Only transitions between
    ``open`` and ``full``. A ``scheduled`` instance stays scheduled when it fills,
    so holding an event does not put it on sale. Other statuses are unchanged.
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
        if used >= cap:
            if instance.status == InstanceStatus.OPEN:
                instance.status = InstanceStatus.FULL
                changed = True
        elif instance.status == InstanceStatus.FULL:
            instance.status = InstanceStatus.OPEN
            changed = True
    if changed:
        session.flush()
