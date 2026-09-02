"""Repository for enrollment operations."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.db.models import (
    Enrollment,
    EnrollmentStatus,
    ServiceInstance,
)
from app.db.models.enums import CAPACITY_ENROLLMENT_STATUSES
from app.db.repositories.base import BaseRepository


def billing_party_load_options() -> tuple[Any, ...]:
    """Eager loads needed to label an enrollment's party for billing screens."""
    return (
        joinedload(Enrollment.instance).joinedload(ServiceInstance.service),
        joinedload(Enrollment.contact),
        joinedload(Enrollment.family),
        joinedload(Enrollment.organization),
        joinedload(Enrollment.bill_to_contact),
        joinedload(Enrollment.bill_to_family),
        joinedload(Enrollment.bill_to_organization),
        joinedload(Enrollment.ticket_tier),
    )


class EnrollmentRepository(BaseRepository[Enrollment]):
    """Repository for enrollment CRUD and list methods."""

    def __init__(self, session: Session):
        super().__init__(session, Enrollment)

    def get_many_with_billing_parties(
        self, enrollment_ids: set[UUID]
    ) -> list[Enrollment]:
        """Enrollments by id with every party relation loaded for display labels."""
        if not enrollment_ids:
            return []
        statement = (
            select(Enrollment)
            .where(Enrollment.id.in_(enrollment_ids))
            .options(*billing_party_load_options())
        )
        return list(self._session.execute(statement).unique().scalars().all())

    def list_enrollments(
        self,
        *,
        instance_id: UUID,
        limit: int,
        status: EnrollmentStatus | None = None,
        cursor_created_at: datetime | None = None,
        cursor_id: UUID | None = None,
    ) -> list[Enrollment]:
        """List enrollments by instance with stable cursor pagination."""
        statement = (
            select(Enrollment)
            .where(Enrollment.instance_id == instance_id)
            .options(
                joinedload(Enrollment.contact),
                joinedload(Enrollment.bill_to_contact),
                joinedload(Enrollment.family),
                joinedload(Enrollment.bill_to_family),
                joinedload(Enrollment.organization),
                joinedload(Enrollment.bill_to_organization),
                joinedload(Enrollment.ticket_tier),
                joinedload(Enrollment.discount_code),
            )
        )
        if status is not None:
            statement = statement.where(Enrollment.status == status)
        if cursor_created_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    Enrollment.created_at < cursor_created_at,
                    and_(
                        Enrollment.created_at == cursor_created_at,
                        Enrollment.id < cursor_id,
                    ),
                )
            )
        statement = statement.order_by(
            Enrollment.created_at.desc(), Enrollment.id.desc()
        ).limit(limit)
        return list(self._session.execute(statement).unique().scalars().all())

    def count_enrollments(
        self,
        *,
        instance_id: UUID,
        status: EnrollmentStatus | None = None,
    ) -> int:
        """Count enrollments by instance and optional status."""
        statement = select(func.count(Enrollment.id)).where(
            Enrollment.instance_id == instance_id
        )
        if status is not None:
            statement = statement.where(Enrollment.status == status)
        count = self._session.execute(statement).scalar_one_or_none()
        return int(count or 0)

    def contact_has_enrollment_for_instance(
        self, *, instance_id: UUID, contact_id: UUID
    ) -> bool:
        """True if any enrollment row exists for this contact on this instance."""
        statement = (
            select(func.count(Enrollment.id))
            .where(Enrollment.instance_id == instance_id)
            .where(Enrollment.contact_id == contact_id)
        )
        n = int(self._session.execute(statement).scalar_one_or_none() or 0)
        return n > 0

    def create_enrollment(self, enrollment: Enrollment) -> Enrollment:
        """Create enrollment with capacity guard where required."""
        # Lock the instance row so capacity checks and inserts are serialized.
        instance_statement = (
            select(ServiceInstance)
            .where(ServiceInstance.id == enrollment.instance_id)
            .with_for_update()
        )
        instance = self._session.execute(instance_statement).scalar_one_or_none()
        if instance is None:
            raise ValueError("Service instance not found")

        if instance.max_capacity is not None:
            active_count_statement = (
                select(func.count(Enrollment.id))
                .where(Enrollment.instance_id == instance.id)
                .where(Enrollment.status.in_(CAPACITY_ENROLLMENT_STATUSES))
            )
            active_count = int(
                self._session.execute(active_count_statement).scalar_one_or_none() or 0
            )
            if active_count >= instance.max_capacity:
                if instance.waitlist_enabled:
                    enrollment.status = EnrollmentStatus.WAITLISTED
                else:
                    raise ValueError("Instance capacity is full")

        self._session.add(enrollment)
        self._session.flush()
        self._session.refresh(enrollment)
        return enrollment

    def try_create_enrollment_with_capacity_guard(
        self, enrollment: Enrollment
    ) -> tuple[Enrollment | None, str | None]:
        """Create enrollment when capacity allows; avoid 500 on full instance.

        Returns ``(enrollment, None)`` on success. Returns ``(None, "capacity_full")`` when
        the instance is at capacity and waitlist is disabled (no row inserted). Returns
        ``(None, "duplicate")`` when a concurrent insert violates the partial unique index
        on ``(instance_id, contact_id)`` (no row inserted).

        Callers that pre-incremented a discount code must decrement on ``capacity_full``
        or ``duplicate``.
        """
        instance_statement = (
            select(ServiceInstance)
            .where(ServiceInstance.id == enrollment.instance_id)
            .with_for_update()
        )
        instance = self._session.execute(instance_statement).scalar_one_or_none()
        if instance is None:
            raise ValueError("Service instance not found")

        if instance.max_capacity is not None:
            active_count_statement = (
                select(func.count(Enrollment.id))
                .where(Enrollment.instance_id == instance.id)
                .where(Enrollment.status.in_(CAPACITY_ENROLLMENT_STATUSES))
            )
            active_count = int(
                self._session.execute(active_count_statement).scalar_one_or_none() or 0
            )
            if active_count >= instance.max_capacity:
                if instance.waitlist_enabled:
                    enrollment.status = EnrollmentStatus.WAITLISTED
                else:
                    return None, "capacity_full"

        try:
            with self._session.begin_nested():
                self._session.add(enrollment)
                self._session.flush()
        except IntegrityError:
            return None, "duplicate"

        self._session.refresh(enrollment)
        return enrollment, None

    def update_status(
        self, enrollment_id: UUID, status: EnrollmentStatus
    ) -> Enrollment | None:
        """Update enrollment status and return the updated row."""
        enrollment = self.get_by_id(enrollment_id)
        if enrollment is None:
            return None
        enrollment.status = status
        self._session.flush()
        self._session.refresh(enrollment)
        return enrollment

    def mark_registered_or_confirmed_enrollments_completed(
        self, instance_id: UUID
    ) -> None:
        """Set registered/confirmed enrollments to completed for a finished instance.

        Cancelled, waitlisted, and already-completed rows are unchanged so capacity
        counts stay aligned with seated bookings.
        """
        stmt = (
            update(Enrollment)
            .where(Enrollment.instance_id == instance_id)
            .where(
                Enrollment.status.in_(
                    (EnrollmentStatus.REGISTERED, EnrollmentStatus.CONFIRMED)
                )
            )
            .values(status=EnrollmentStatus.COMPLETED)
        )
        self._session.execute(stmt)
