"""Repository for service instances and schedules."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.sql import ColumnElement

from app.db.models import (
    Enrollment,
    EnrollmentStatus,
    EventbriteSyncStatus,
    EventTicketTier,
    InstanceSessionSlot,
    InstanceStatus,
    Service,
    ServiceInstancePartnerOrganization,
    ServiceInstanceTag,
    ServiceStatus,
    ServiceInstance,
    ServiceType,
    TrainingInstanceDetails,
)
from app.db.models.enums import CAPACITY_ENROLLMENT_STATUSES
from app.db.repositories.base import BaseRepository

InstanceDetails = TrainingInstanceDetails | list[EventTicketTier] | None

# ~3 calendar months: finished event instances remain visible on the public calendar feed.
PUBLIC_CALENDAR_FINISHED_EVENT_LOOKBACK = timedelta(days=90)

_PUBLIC_CALENDAR_BLOCKER_DEFAULT_TYPES: tuple[ServiceType, ...] = (
    ServiceType.EVENT,
    ServiceType.TRAINING_COURSE,
)


def public_calendar_blocker_instance_predicates(
    *,
    service_types: tuple[ServiceType, ...] | None = None,
) -> tuple[ColumnElement[bool], ...]:
    """Shared filters for published event/training instances (public calendar + blockers).

    Pass ``service_types`` to mirror :meth:`ServiceInstanceRepository.list_public_offerings`
    (when ``None``, defaults to event + training_course). Excludes list limit, slug,
    service_key filters, earliest-slot ordering, and the public calendar feed-only
    visibility rules (active session cutoff and finished-event lookback).
    """
    types_tuple = (
        _PUBLIC_CALENDAR_BLOCKER_DEFAULT_TYPES if not service_types else service_types
    )
    return (
        Service.service_type.in_(types_tuple),
        Service.status == ServiceStatus.PUBLISHED,
        ServiceInstance.status != InstanceStatus.CANCELLED,
        ServiceInstance.status.in_(
            [
                InstanceStatus.SCHEDULED,
                InstanceStatus.OPEN,
                InstanceStatus.FULL,
                InstanceStatus.IN_PROGRESS,
                InstanceStatus.COMPLETED,
            ]
        ),
        ServiceInstance.slug != "",
    )


def select_public_calendar_blocker_session_slots(
    *,
    range_start_utc: datetime,
    range_end_utc: datetime,
):
    """Session slot rows for public calendar blocker merge (published event/training).

    Uses :func:`public_calendar_blocker_instance_predicates` — same eligibility as
    :meth:`ServiceInstanceRepository.list_public_offerings` (see that docstring).
    """
    return (
        select(InstanceSessionSlot.starts_at, InstanceSessionSlot.ends_at)
        .join(ServiceInstance, InstanceSessionSlot.instance_id == ServiceInstance.id)
        .join(Service, ServiceInstance.service_id == Service.id)
        .where(and_(*public_calendar_blocker_instance_predicates()))
        .where(InstanceSessionSlot.starts_at < range_end_utc)
        .where(InstanceSessionSlot.ends_at > range_start_utc)
    )


class ServiceInstanceRepository(BaseRepository[ServiceInstance]):
    """Repository for service-instance operations."""

    def __init__(self, session: Session):
        super().__init__(session, ServiceInstance)

    def count_for_service_id(self, service_id: UUID) -> int:
        """Return how many instances exist for the given service template."""
        statement = select(func.count(ServiceInstance.id)).where(
            ServiceInstance.service_id == service_id
        )
        count = self._session.execute(statement).scalar_one_or_none()
        return int(count or 0)

    def list_instances(
        self,
        *,
        service_id: UUID,
        limit: int,
        status: InstanceStatus | None = None,
        cursor_created_at: datetime | None = None,
        cursor_id: UUID | None = None,
    ) -> list[ServiceInstance]:
        """List instances for a service with stable cursor pagination."""
        statement = (
            select(ServiceInstance)
            .where(ServiceInstance.service_id == service_id)
            .options(
                selectinload(ServiceInstance.session_slots),
                joinedload(ServiceInstance.training_details),
                selectinload(ServiceInstance.ticket_tiers),
                selectinload(ServiceInstance.partner_organization_links).joinedload(
                    ServiceInstancePartnerOrganization.organization
                ),
                selectinload(ServiceInstance.instance_tags).selectinload(
                    ServiceInstanceTag.tag
                ),
            )
        )
        if status is not None:
            statement = statement.where(ServiceInstance.status == status)
        if cursor_created_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    ServiceInstance.created_at < cursor_created_at,
                    and_(
                        ServiceInstance.created_at == cursor_created_at,
                        ServiceInstance.id < cursor_id,
                    ),
                )
            )
        statement = statement.order_by(
            ServiceInstance.created_at.desc(), ServiceInstance.id.desc()
        ).limit(limit)
        return list(self._session.execute(statement).unique().scalars().all())

    def count_instances(
        self,
        *,
        service_id: UUID,
        status: InstanceStatus | None = None,
    ) -> int:
        """Count instances by service and optional status."""
        statement = select(func.count(ServiceInstance.id)).where(
            ServiceInstance.service_id == service_id
        )
        if status is not None:
            statement = statement.where(ServiceInstance.status == status)
        count = self._session.execute(statement).scalar_one_or_none()
        return int(count or 0)

    def list_instances_global(
        self,
        *,
        limit: int,
        status: InstanceStatus | None = None,
        service_id: UUID | None = None,
        service_type: ServiceType | None = None,
        cursor_created_at: datetime | None = None,
        cursor_id: UUID | None = None,
        instance_ids: set[UUID] | None = None,
    ) -> list[ServiceInstance]:
        """List instances across services with optional filters and cursor pagination."""
        statement = select(ServiceInstance).options(
            selectinload(ServiceInstance.session_slots),
            joinedload(ServiceInstance.training_details),
            selectinload(ServiceInstance.ticket_tiers),
            selectinload(ServiceInstance.partner_organization_links).joinedload(
                ServiceInstancePartnerOrganization.organization
            ),
            selectinload(ServiceInstance.instance_tags).selectinload(
                ServiceInstanceTag.tag
            ),
            joinedload(ServiceInstance.service),
        )
        if service_type is not None:
            statement = statement.join(
                Service, ServiceInstance.service_id == Service.id
            ).where(Service.service_type == service_type)
            if service_id is not None:
                statement = statement.where(ServiceInstance.service_id == service_id)
        elif service_id is not None:
            statement = statement.where(ServiceInstance.service_id == service_id)
        if status is not None:
            statement = statement.where(ServiceInstance.status == status)
        if instance_ids is not None:
            if not instance_ids:
                return []
            statement = statement.where(ServiceInstance.id.in_(instance_ids))
        if cursor_created_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    ServiceInstance.created_at < cursor_created_at,
                    and_(
                        ServiceInstance.created_at == cursor_created_at,
                        ServiceInstance.id < cursor_id,
                    ),
                )
            )
        statement = statement.order_by(
            ServiceInstance.created_at.desc(), ServiceInstance.id.desc()
        ).limit(limit)
        return list(self._session.execute(statement).unique().scalars().all())

    def count_instances_global(
        self,
        *,
        status: InstanceStatus | None = None,
        service_id: UUID | None = None,
        service_type: ServiceType | None = None,
        instance_ids: set[UUID] | None = None,
    ) -> int:
        """Count instances matching optional filters."""
        if instance_ids is not None and not instance_ids:
            return 0
        statement = select(func.count(ServiceInstance.id))
        if service_type is not None:
            statement = statement.join(
                Service, ServiceInstance.service_id == Service.id
            ).where(Service.service_type == service_type)
            if service_id is not None:
                statement = statement.where(ServiceInstance.service_id == service_id)
        elif service_id is not None:
            statement = statement.where(ServiceInstance.service_id == service_id)
        if status is not None:
            statement = statement.where(ServiceInstance.status == status)
        if instance_ids is not None:
            statement = statement.where(ServiceInstance.id.in_(instance_ids))
        count = self._session.execute(statement).scalar_one_or_none()
        return int(count or 0)

    def get_by_id_with_details(self, instance_id: UUID) -> ServiceInstance | None:
        """Return one instance with related details and enrollments."""
        statement = (
            select(ServiceInstance)
            .where(ServiceInstance.id == instance_id)
            .options(
                selectinload(ServiceInstance.session_slots),
                joinedload(ServiceInstance.training_details),
                selectinload(ServiceInstance.ticket_tiers),
                selectinload(ServiceInstance.partner_organization_links).joinedload(
                    ServiceInstancePartnerOrganization.organization
                ),
                selectinload(ServiceInstance.instance_tags).selectinload(
                    ServiceInstanceTag.tag
                ),
                selectinload(ServiceInstance.enrollments),
            )
        )
        return self._session.execute(statement).scalar_one_or_none()

    def list_public_offerings(
        self,
        *,
        limit: int,
        now: datetime,
        service_types: set[ServiceType] | None = None,
        slug: str | None = None,
        service_key: str | None = None,
    ) -> list[ServiceInstance]:
        """List public calendar rows for published event and training services.

        Rows include instances with any session not yet ended (``ends_at >= now``),
        plus **event**-type instances whose last session ended within
        :data:`PUBLIC_CALENDAR_FINISHED_EVENT_LOOKBACK` (training courses never
        match this historical branch).

        When ``slug`` is set, it is compared to ``lower(service_instances.slug)``;
        the public handler passes a pre-normalized lowercase slug, and callers
        that pass mixed case are still matched defensively via ``lower()`` on the
        value.

        When ``service_key`` is set, it is compared to ``lower(services.service_key)``; the
        public handler passes a pre-normalized lowercase slug, and callers that
        pass mixed case are still matched defensively via ``lower()`` on the value.
        """
        types_tuple: tuple[ServiceType, ...] = (
            (ServiceType.EVENT, ServiceType.TRAINING_COURSE)
            if not service_types
            else tuple(sorted(service_types, key=lambda t: t.value))
        )
        earliest_upcoming_slot = (
            select(func.min(InstanceSessionSlot.starts_at))
            .where(InstanceSessionSlot.instance_id == ServiceInstance.id)
            .where(InstanceSessionSlot.ends_at >= now - datetime.resolution)
            .correlate(ServiceInstance)
            .scalar_subquery()
        )
        statement = (
            select(ServiceInstance)
            .join(Service, ServiceInstance.service_id == Service.id)
            .where(
                and_(
                    *public_calendar_blocker_instance_predicates(
                        service_types=types_tuple
                    )
                )
            )
        )
        has_active_or_upcoming_slot = ServiceInstance.session_slots.any(
            InstanceSessionSlot.ends_at >= now - datetime.resolution
        )
        latest_session_end = (
            select(func.max(InstanceSessionSlot.ends_at))
            .where(InstanceSessionSlot.instance_id == ServiceInstance.id)
            .correlate(ServiceInstance)
            .scalar_subquery()
        )
        lookback_start = now - PUBLIC_CALENDAR_FINISHED_EVENT_LOOKBACK
        finished_recent_event = and_(
            Service.service_type == ServiceType.EVENT,
            latest_session_end.isnot(None),
            latest_session_end < now,
            latest_session_end >= lookback_start,
        )
        feed_scope = (
            or_(has_active_or_upcoming_slot, finished_recent_event)
            if ServiceType.EVENT in types_tuple
            else has_active_or_upcoming_slot
        )
        statement = (
            statement.where(feed_scope)
            .options(
                selectinload(ServiceInstance.session_slots).joinedload(
                    InstanceSessionSlot.location
                ),
                joinedload(ServiceInstance.location),
                selectinload(ServiceInstance.ticket_tiers),
                joinedload(ServiceInstance.training_details),
                joinedload(ServiceInstance.service).options(
                    joinedload(Service.event_details),
                    selectinload(Service.location),
                ),
                selectinload(ServiceInstance.instance_tags).joinedload(
                    ServiceInstanceTag.tag
                ),
                selectinload(ServiceInstance.partner_organization_links).joinedload(
                    ServiceInstancePartnerOrganization.organization
                ),
            )
            .order_by(earliest_upcoming_slot.asc(), ServiceInstance.id.asc())
            .limit(limit)
        )
        if slug:
            statement = statement.where(
                func.lower(ServiceInstance.slug) == slug.lower()
            )
        if service_key:
            statement = statement.where(
                func.lower(Service.service_key) == service_key.lower()
            )
        return list(self._session.execute(statement).unique().scalars().all())

    def get_with_service_by_slug(self, slug: str) -> ServiceInstance | None:
        """Load instance and parent service by public instance slug (case-insensitive)."""
        normalized = slug.strip()
        if not normalized:
            return None
        statement = (
            select(ServiceInstance)
            .join(Service, ServiceInstance.service_id == Service.id)
            .where(func.lower(ServiceInstance.slug) == normalized.lower())
            .options(joinedload(ServiceInstance.service))
        )
        return self._session.execute(statement).unique().scalar_one_or_none()

    def get_id_by_slug(self, slug: str) -> UUID | None:
        """Resolve ``service_instances.id`` from public slug (case-insensitive)."""
        normalized = slug.strip()
        if not normalized:
            return None
        statement = select(ServiceInstance.id).where(
            func.lower(ServiceInstance.slug) == normalized.lower()
        )
        return self._session.execute(statement).scalars().one_or_none()

    def list_event_instances_for_public_feed(
        self,
        *,
        limit: int,
        now: datetime,
    ) -> list[ServiceInstance]:
        """List upcoming/past public event instances for calendar feed.

        .. deprecated::
            Use :meth:`list_public_offerings` with ``service_types={ServiceType.EVENT}``.
        """
        return self.list_public_offerings(
            limit=limit,
            now=now,
            service_types={ServiceType.EVENT},
        )

    def list_instances_pending_eventbrite_sync(
        self, *, limit: int
    ) -> list[ServiceInstance]:
        """List Event-type instances that require Eventbrite sync work."""
        statement = (
            select(ServiceInstance)
            .join(Service, ServiceInstance.service_id == Service.id)
            .where(Service.service_type == ServiceType.EVENT)
            .where(
                ServiceInstance.eventbrite_sync_status.in_(
                    [EventbriteSyncStatus.PENDING, EventbriteSyncStatus.FAILED]
                )
            )
            .options(
                joinedload(ServiceInstance.service),
                selectinload(ServiceInstance.session_slots),
                selectinload(ServiceInstance.ticket_tiers),
            )
            .order_by(ServiceInstance.updated_at.asc(), ServiceInstance.id.asc())
            .limit(limit)
        )
        return list(self._session.execute(statement).unique().scalars().all())

    def create_instance(
        self,
        instance: ServiceInstance,
        type_details: InstanceDetails,
        session_slots: list[InstanceSessionSlot] | None = None,
    ) -> ServiceInstance:
        """Create an instance and optional nested detail rows."""
        self._session.add(instance)
        self._session.flush()

        for slot in session_slots or []:
            slot.instance_id = instance.id
            self._session.add(slot)

        if type_details is not None:
            if isinstance(type_details, TrainingInstanceDetails):
                instance.training_details = type_details
                type_details.instance_id = instance.id
                self._session.add(type_details)
            else:
                for tier in type_details:
                    tier.instance_id = instance.id
                    self._session.add(tier)

        self._session.flush()
        self._session.refresh(instance)
        return instance

    def get_enrollment_count(self, instance_id: UUID) -> int:
        """Return enrollment count for capacity (same statuses as EnrollmentRepository)."""
        statement = (
            select(func.count(Enrollment.id))
            .where(Enrollment.instance_id == instance_id)
            .where(Enrollment.status.in_(CAPACITY_ENROLLMENT_STATUSES))
        )
        count = self._session.execute(statement).scalar_one_or_none()
        return int(count or 0)

    def get_enrollment_counts_for_instances(
        self, instance_ids: list[UUID]
    ) -> dict[UUID, int]:
        """Return capacity enrollment counts keyed by instance (one query)."""
        if not instance_ids:
            return {}
        statement = (
            select(Enrollment.instance_id, func.count(Enrollment.id))
            .where(Enrollment.instance_id.in_(instance_ids))
            .where(Enrollment.status.in_(CAPACITY_ENROLLMENT_STATUSES))
            .group_by(Enrollment.instance_id)
        )
        rows = self._session.execute(statement).all()
        return {row[0]: int(row[1]) for row in rows}

    def get_waitlist_count(self, instance_id: UUID) -> int:
        """Return waitlist count for an instance."""
        statement = (
            select(func.count(Enrollment.id))
            .where(Enrollment.instance_id == instance_id)
            .where(Enrollment.status == EnrollmentStatus.WAITLISTED)
        )
        count = self._session.execute(statement).scalar_one_or_none()
        return int(count or 0)

    def list_event_instances_for_sync_reconciliation(
        self,
        *,
        limit: int,
    ) -> list[ServiceInstance]:
        """Return Event instances ordered for periodic sync reconciliation."""
        statement = (
            select(ServiceInstance)
            .join(Service, ServiceInstance.service_id == Service.id)
            .where(Service.service_type == ServiceType.EVENT)
            .where(ServiceInstance.status != InstanceStatus.CANCELLED)
            .options(
                joinedload(ServiceInstance.service),
                joinedload(ServiceInstance.location),
                selectinload(ServiceInstance.session_slots),
                selectinload(ServiceInstance.ticket_tiers),
            )
            .order_by(ServiceInstance.updated_at.desc(), ServiceInstance.id.desc())
            .limit(limit)
        )
        return list(self._session.execute(statement).unique().scalars().all())
