"""Repository for CRM sales leads."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.db.models.contact import Contact
from app.db.models.enums import ContactSource, FunnelStage, LeadEventType, LeadType
from app.db.models.sales_lead import SalesLead, SalesLeadEvent
from app.db.repositories.base import BaseRepository

FilterCondition = ColumnElement[bool]


def _escape_like_pattern(pattern: str) -> str:
    """Escape LIKE pattern special characters."""
    return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class SalesLeadRepository(BaseRepository[SalesLead]):
    """Repository for sales lead and lead-event operations."""

    def __init__(self, session: Session):
        super().__init__(session, SalesLead)

    def find_by_contact_and_asset(
        self,
        contact_id: UUID,
        lead_type: LeadType,
        asset_id: UUID,
    ) -> SalesLead | None:
        """Return an existing lead for idempotent media processing."""
        statement = select(SalesLead).where(
            and_(
                SalesLead.contact_id == contact_id,
                SalesLead.lead_type == lead_type,
                SalesLead.asset_id == asset_id,
            )
        )
        return self._session.execute(statement).scalar_one_or_none()

    def find_open_by_contact(self, contact_id: UUID) -> SalesLead | None:
        """Return the most recent open-funnel lead for a contact, if any."""
        statement = (
            select(SalesLead)
            .where(
                SalesLead.contact_id == contact_id,
                SalesLead.funnel_stage.in_(
                    (
                        FunnelStage.NEW,
                        FunnelStage.CONTACTED,
                        FunnelStage.ENGAGED,
                        FunnelStage.QUALIFIED,
                        FunnelStage.UNQUALIFIED,
                    )
                ),
            )
            .order_by(SalesLead.created_at.desc())
            .limit(1)
        )
        return self._session.execute(statement).scalar_one_or_none()

    def create_with_event(
        self,
        lead: SalesLead,
        event_type: LeadEventType,
        metadata: dict[str, object] | None = None,
        *,
        from_stage: FunnelStage | None = None,
        to_stage: FunnelStage | None = None,
        created_by: str | None = None,
    ) -> SalesLead:
        """Create lead and initial lead event in one transaction scope."""
        self._session.add(lead)
        self._session.flush()
        self._session.refresh(lead)

        self.add_event(
            lead_id=lead.id,
            event_type=event_type,
            metadata=metadata,
            from_stage=from_stage,
            to_stage=to_stage or lead.funnel_stage,
            created_by=created_by,
        )
        return lead

    def add_event(
        self,
        *,
        lead_id: UUID,
        event_type: LeadEventType,
        metadata: dict[str, object] | None = None,
        from_stage: FunnelStage | None = None,
        to_stage: FunnelStage | None = None,
        created_by: str | None = None,
    ) -> SalesLeadEvent:
        """Create and persist a new lead lifecycle event."""
        lead_event = SalesLeadEvent(
            lead_id=lead_id,
            event_type=event_type,
            from_stage=from_stage,
            to_stage=to_stage,
            metadata_json=metadata,
            created_by=created_by,
        )
        self._session.add(lead_event)
        self._session.flush()
        self._session.refresh(lead_event)
        return lead_event

    def get_by_id_with_details(self, lead_id: UUID) -> SalesLead | None:
        """Return a lead with contact, tags, events, and notes loaded."""
        statement = (
            select(SalesLead)
            .where(SalesLead.id == lead_id)
            .options(
                joinedload(SalesLead.contact).joinedload(Contact.tags),
                selectinload(SalesLead.events),
                selectinload(SalesLead.notes),
            )
        )
        return self._session.execute(statement).unique().scalar_one_or_none()

    def list_leads(
        self,
        *,
        limit: int,
        stage: Sequence[FunnelStage] | None = None,
        source: Sequence[ContactSource] | None = None,
        lead_type: Sequence[LeadType] | None = None,
        assigned_to: str | None = None,
        unassigned: bool = False,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        search: str | None = None,
        sort: str = "created_at",
        sort_dir: str = "desc",
        cursor_created_at: datetime | None = None,
        cursor_id: UUID | None = None,
    ) -> list[SalesLead]:
        """List leads with filtering, sorting, and stable cursor pagination."""
        conditions, requires_contact_join = self._build_filter_conditions(
            stage=stage,
            source=source,
            lead_type=lead_type,
            assigned_to=assigned_to,
            unassigned=unassigned,
            date_from=date_from,
            date_to=date_to,
            search=search,
        )

        last_activity_subquery = (
            select(
                SalesLeadEvent.lead_id.label("lead_id"),
                func.max(SalesLeadEvent.created_at).label("last_activity_at"),
            )
            .group_by(SalesLeadEvent.lead_id)
            .subquery()
        )
        stage_entered_at_subquery = (
            select(func.max(SalesLeadEvent.created_at))
            .where(
                and_(
                    SalesLeadEvent.lead_id == SalesLead.id,
                    SalesLeadEvent.event_type == LeadEventType.STAGE_CHANGED,
                    SalesLeadEvent.to_stage == SalesLead.funnel_stage,
                )
            )
            .correlate(SalesLead)
            .scalar_subquery()
        )
        computed_days_in_stage = func.floor(
            func.extract(
                "epoch",
                func.now()
                - func.coalesce(stage_entered_at_subquery, SalesLead.created_at),  # type: ignore[operator]
            )
            / 86400.0
        )
        statement = select(
            SalesLead,
            func.coalesce(
                last_activity_subquery.c.last_activity_at,
                SalesLead.updated_at,
                SalesLead.created_at,
            ).label("computed_last_activity_at"),
            computed_days_in_stage.label("computed_days_in_stage"),
        ).join(
            last_activity_subquery,
            SalesLead.id == last_activity_subquery.c.lead_id,
            isouter=True,
        )
        if requires_contact_join:
            statement = statement.join(
                Contact,
                SalesLead.contact_id == Contact.id,
                isouter=True,
            )
        statement = statement.options(
            joinedload(SalesLead.contact).joinedload(Contact.tags),
        )
        if conditions:
            statement = statement.where(*conditions)

        sort_column = self._resolve_sort_column(sort=sort)
        is_desc = sort_dir.lower() != "asc"

        if (
            cursor_created_at is not None
            and cursor_id is not None
            and sort == "created_at"
        ):
            if is_desc:
                statement = statement.where(
                    or_(
                        SalesLead.created_at < cursor_created_at,
                        and_(
                            SalesLead.created_at == cursor_created_at,
                            SalesLead.id < cursor_id,
                        ),
                    )
                )
            else:
                statement = statement.where(
                    or_(
                        SalesLead.created_at > cursor_created_at,
                        and_(
                            SalesLead.created_at == cursor_created_at,
                            SalesLead.id > cursor_id,
                        ),
                    )
                )

        secondary_id_order = SalesLead.id.desc() if is_desc else SalesLead.id.asc()
        primary_order = sort_column.desc() if is_desc else sort_column.asc()
        statement = statement.order_by(primary_order, secondary_id_order).limit(limit)
        rows = self._session.execute(statement).unique().all()
        leads: list[SalesLead] = []
        for lead, last_activity_at, days_in_stage in rows:
            setattr(lead, "_computed_last_activity_at", last_activity_at)
            setattr(lead, "_computed_days_in_stage", int(days_in_stage or 0))
            leads.append(lead)
        return leads

    def count_leads(
        self,
        *,
        stage: Sequence[FunnelStage] | None = None,
        source: Sequence[ContactSource] | None = None,
        lead_type: Sequence[LeadType] | None = None,
        assigned_to: str | None = None,
        unassigned: bool = False,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        search: str | None = None,
    ) -> int:
        """Return lead count for the same filter set used in list endpoints."""
        conditions, requires_contact_join = self._build_filter_conditions(
            stage=stage,
            source=source,
            lead_type=lead_type,
            assigned_to=assigned_to,
            unassigned=unassigned,
            date_from=date_from,
            date_to=date_to,
            search=search,
        )
        statement = select(func.count(SalesLead.id))
        if requires_contact_join:
            statement = statement.select_from(SalesLead).join(
                Contact,
                SalesLead.contact_id == Contact.id,
                isouter=True,
            )
        if conditions:
            statement = statement.where(*conditions)
        count = self._session.execute(statement).scalar_one_or_none()
        return int(count or 0)

    def get_analytics(
        self,
        *,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
    ) -> dict[str, object]:
        """Return aggregate sales lead analytics for dashboard widgets."""
        conditions: list[FilterCondition] = []
        if date_from is not None:
            conditions.append(SalesLead.created_at >= date_from)
        if date_to is not None:
            conditions.append(SalesLead.created_at <= date_to)
        scoped_lead_ids_subquery = select(SalesLead.id).where(*conditions).subquery()

        stage_counts_raw = self._session.execute(
            select(SalesLead.funnel_stage, func.count(SalesLead.id))
            .where(*conditions)
            .group_by(SalesLead.funnel_stage)
        ).all()
        stage_counts = {
            FunnelStage.NEW.value: 0,
            FunnelStage.CONTACTED.value: 0,
            FunnelStage.ENGAGED.value: 0,
            FunnelStage.QUALIFIED.value: 0,
            FunnelStage.UNQUALIFIED.value: 0,
            FunnelStage.CONVERTED.value: 0,
            FunnelStage.LOST.value: 0,
        }
        for stage, count in stage_counts_raw:
            stage_counts[stage.value] = int(count)

        total = sum(stage_counts.values())
        denominator = max(total - stage_counts[FunnelStage.LOST.value], 1)
        conversion_rate = stage_counts[FunnelStage.CONVERTED.value] / denominator

        avg_days_to_convert_result = self._session.execute(
            select(
                func.avg(
                    func.extract(
                        "epoch",
                        SalesLead.converted_at - SalesLead.created_at,  # type: ignore[operator]
                    )
                )
            )
            .where(*conditions)
            .where(SalesLead.converted_at.is_not(None))
        ).scalar_one_or_none()
        avg_days_to_convert = (
            float(avg_days_to_convert_result) / 86400.0
            if avg_days_to_convert_result is not None
            else None
        )

        source_counts_raw = self._session.execute(
            select(Contact.source, func.count(SalesLead.id))
            .select_from(SalesLead)
            .join(Contact, SalesLead.contact_id == Contact.id, isouter=True)
            .where(*conditions)
            .group_by(Contact.source)
        ).all()
        source_breakdown = {
            source.value if source is not None else "unknown": int(count)
            for source, count in source_counts_raw
        }

        week_bucket = func.date_trunc("week", SalesLead.created_at).label("week_bucket")
        leads_over_time_grouped = (
            select(
                week_bucket,
                func.count(SalesLead.id).label("lead_count"),
            )
            .where(*conditions)
            .group_by(week_bucket)
            .subquery()
        )
        leads_over_time_raw = self._session.execute(
            select(
                func.to_char(leads_over_time_grouped.c.week_bucket, "IYYY-IW"),
                leads_over_time_grouped.c.lead_count,
            ).order_by(leads_over_time_grouped.c.week_bucket.asc())
        ).all()
        leads_over_time = [
            {"period": period, "count": int(count)}
            for period, count in leads_over_time_raw
        ]

        assignee_stats_raw = self._session.execute(
            select(
                SalesLead.assigned_to,
                func.count(SalesLead.id),
                func.sum(
                    case(
                        (SalesLead.funnel_stage == FunnelStage.CONVERTED, 1),
                        else_=0,
                    )
                ),
            )
            .where(*conditions)
            .group_by(SalesLead.assigned_to)
        ).all()
        assignee_stats: list[dict[str, object]] = []
        for assigned_to, assigned_total, converted_total in assignee_stats_raw:
            total_int = int(assigned_total or 0)
            converted_int = int(converted_total or 0)
            assignee_stats.append(
                {
                    "assigned_to": assigned_to,
                    "total": total_int,
                    "converted": converted_int,
                    "conversion_rate": (converted_int / total_int)
                    if total_int
                    else 0.0,
                }
            )

        reached_stage_counts_raw = self._session.execute(
            select(
                SalesLeadEvent.to_stage,
                func.count(func.distinct(SalesLeadEvent.lead_id)),
            )
            .where(
                SalesLeadEvent.event_type.in_(
                    [LeadEventType.CREATED, LeadEventType.STAGE_CHANGED]
                ),
                SalesLeadEvent.to_stage.is_not(None),
                SalesLeadEvent.lead_id.in_(select(scoped_lead_ids_subquery.c.id)),
            )
            .group_by(SalesLeadEvent.to_stage)
        ).all()
        reached_stage_counts: dict[str, int] = {}
        for to_stage, reached_count in reached_stage_counts_raw:
            if to_stage is None:
                continue
            reached_stage_counts[to_stage.value] = int(reached_count or 0)

        new_reached = reached_stage_counts.get(FunnelStage.NEW.value, 0)
        contacted_reached = reached_stage_counts.get(FunnelStage.CONTACTED.value, 0)
        engaged_reached = reached_stage_counts.get(FunnelStage.ENGAGED.value, 0)
        qualified_reached = reached_stage_counts.get(FunnelStage.QUALIFIED.value, 0)
        converted_reached = reached_stage_counts.get(FunnelStage.CONVERTED.value, 0)
        stage_conversion_rates = {
            "new_to_contacted": (contacted_reached / new_reached)
            if new_reached
            else 0.0,
            "contacted_to_engaged": (
                engaged_reached / contacted_reached if contacted_reached else 0.0
            ),
            "engaged_to_qualified": (
                qualified_reached / engaged_reached if engaged_reached else 0.0
            ),
            "qualified_to_converted": (
                converted_reached / qualified_reached if qualified_reached else 0.0
            ),
        }

        lead_stage_timeline_subquery = (
            select(
                SalesLeadEvent.lead_id.label("lead_id"),
                SalesLeadEvent.created_at.label("created_at"),
                SalesLeadEvent.from_stage.label("from_stage"),
                func.lag(SalesLeadEvent.created_at)
                .over(
                    partition_by=SalesLeadEvent.lead_id,
                    order_by=SalesLeadEvent.created_at,
                )
                .label("previous_created_at"),
            )
            .where(
                SalesLeadEvent.event_type.in_(
                    [LeadEventType.CREATED, LeadEventType.STAGE_CHANGED]
                ),
                SalesLeadEvent.lead_id.in_(select(scoped_lead_ids_subquery.c.id)),
            )
            .subquery()
        )
        avg_days_in_stage_raw = self._session.execute(
            select(
                lead_stage_timeline_subquery.c.from_stage,
                (
                    func.avg(
                        func.extract(
                            "epoch",
                            lead_stage_timeline_subquery.c.created_at
                            - lead_stage_timeline_subquery.c.previous_created_at,  # type: ignore[operator]
                        )
                    )
                    / 86400.0
                ).label("avg_days"),
            )
            .where(
                lead_stage_timeline_subquery.c.from_stage.is_not(None),
                lead_stage_timeline_subquery.c.previous_created_at.is_not(None),
            )
            .group_by(lead_stage_timeline_subquery.c.from_stage)
        ).all()
        avg_days_in_stage: dict[str, float] = {}
        for from_stage, avg_days in avg_days_in_stage_raw:
            if from_stage is None or avg_days is None:
                continue
            avg_days_in_stage[from_stage.value] = float(avg_days)

        return {
            "funnel": stage_counts,
            "conversion_rate": conversion_rate,
            "avg_days_to_convert": avg_days_to_convert,
            "source_breakdown": source_breakdown,
            "stage_conversion_rates": stage_conversion_rates,
            "avg_days_in_stage": avg_days_in_stage,
            "leads_over_time": leads_over_time,
            "assignee_stats": assignee_stats,
        }

    def _resolve_sort_column(self, *, sort: str):
        if sort == "updated_at":
            return SalesLead.updated_at
        if sort == "funnel_stage":
            return SalesLead.funnel_stage
        if sort == "contact_name":
            return func.coalesce(Contact.first_name, "")
        return SalesLead.created_at

    def _build_filter_conditions(
        self,
        *,
        stage: Sequence[FunnelStage] | None = None,
        source: Sequence[ContactSource] | None = None,
        lead_type: Sequence[LeadType] | None = None,
        assigned_to: str | None = None,
        unassigned: bool = False,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        search: str | None = None,
    ) -> tuple[list[FilterCondition], bool]:
        conditions: list[FilterCondition] = []
        requires_contact_join = False

        if stage:
            conditions.append(SalesLead.funnel_stage.in_(list(stage)))
        if lead_type:
            conditions.append(SalesLead.lead_type.in_(list(lead_type)))
        if assigned_to:
            conditions.append(SalesLead.assigned_to == assigned_to)
        if unassigned:
            conditions.append(SalesLead.assigned_to.is_(None))
        if date_from is not None:
            conditions.append(SalesLead.created_at >= date_from)
        if date_to is not None:
            conditions.append(SalesLead.created_at <= date_to)
        if source:
            requires_contact_join = True
            conditions.append(Contact.source.in_(list(source)))
        if search:
            escaped = _escape_like_pattern(search.strip())
            pattern = f"%{escaped}%"
            requires_contact_join = True
            conditions.append(
                or_(
                    Contact.first_name.ilike(pattern, escape="\\"),
                    Contact.last_name.ilike(pattern, escape="\\"),
                    Contact.email.ilike(pattern, escape="\\"),
                )
            )

        return conditions, requires_contact_join

    @staticmethod
    def normalize_datetime(value: datetime) -> datetime:
        """Normalize datetimes to timezone-aware UTC values."""
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
