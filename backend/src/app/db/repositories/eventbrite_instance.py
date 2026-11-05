"""Load one event instance with the relations Eventbrite sync reads."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db.models import (
    GeographicArea,
    InstanceSessionSlot,
    Location,
    ServiceInstance,
)


def _area_chain() -> Any:
    return (
        joinedload(Location.area)
        .joinedload(GeographicArea.parent)
        .joinedload(GeographicArea.parent)
        .joinedload(GeographicArea.parent)
    )


def load_instance_for_eventbrite_sync(
    session: Session,
    instance_id: UUID,
) -> ServiceInstance | None:
    """Return an instance with service, tickets, slots, and venue areas."""
    statement = (
        select(ServiceInstance)
        .where(ServiceInstance.id == instance_id)
        .options(
            joinedload(ServiceInstance.service),
            joinedload(ServiceInstance.location).options(_area_chain()),
            selectinload(ServiceInstance.session_slots)
            .joinedload(InstanceSessionSlot.location)
            .options(_area_chain()),
            selectinload(ServiceInstance.ticket_tiers),
        )
    )
    return session.execute(statement).scalar_one_or_none()
