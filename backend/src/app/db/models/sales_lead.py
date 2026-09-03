"""CRM sales lead and lead event models."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from collections.abc import Iterable

from sqlalchemy import Boolean, CheckConstraint, Enum, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base
from app.db.models.enums import FunnelStage, LeadEventType, LeadLostReason, LeadType

if TYPE_CHECKING:
    from app.db.models.contact import Contact
    from app.db.models.note import Note
    from app.db.models.family import Family
    from app.db.models.organization import Organization


def _enum_values(
    enum_cls: Iterable[LeadType | FunnelStage | LeadEventType | LeadLostReason],
) -> list[str]:
    """Return enum labels stored in PostgreSQL."""
    return [member.value for member in enum_cls]


class SalesLead(Base):
    """Sales lead record."""

    __tablename__ = "sales_leads"
    __table_args__ = (
        CheckConstraint(
            "contact_id IS NOT NULL OR family_id IS NOT NULL OR organization_id IS NOT NULL",
            name="sales_leads_has_parent",
        ),
        Index("sales_leads_contact_idx", "contact_id"),
        Index("sales_leads_family_idx", "family_id"),
        Index("sales_leads_org_idx", "organization_id"),
        Index("sales_leads_funnel_stage_idx", "funnel_stage"),
        Index(
            "sales_leads_guide_dedup_idx",
            "contact_id",
            "lead_type",
            "asset_id",
            unique=True,
            postgresql_where=text("asset_id IS NOT NULL"),
        ),
        Index(
            "sales_leads_one_open_contact_idx",
            "contact_id",
            unique=True,
            postgresql_where=text(
                "contact_id IS NOT NULL AND is_manual IS NOT TRUE "
                "AND funnel_stage IN "
                "('new', 'contacted', 'engaged', 'qualified', 'unqualified')"
            ),
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    contact_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    family_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("families.id", ondelete="SET NULL"),
        nullable=True,
    )
    organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )
    lead_type: Mapped[LeadType] = mapped_column(
        Enum(
            LeadType,
            name="lead_type",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
    )
    funnel_stage: Mapped[FunnelStage] = mapped_column(
        Enum(
            FunnelStage,
            name="funnel_stage",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
        server_default=text("'new'"),
    )
    asset_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="SET NULL"),
        nullable=True,
    )
    assigned_to: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_manual: Mapped[bool] = mapped_column(
        Boolean(),
        nullable=False,
        server_default=text("false"),
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    converted_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    lost_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    lost_reason: Mapped[LeadLostReason | None] = mapped_column(
        Enum(
            LeadLostReason,
            name="lead_lost_reason",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=True,
    )

    contact: Mapped[Contact | None] = relationship(
        "Contact",
        back_populates="sales_leads",
    )
    family: Mapped[Family | None] = relationship(
        "Family",
        back_populates="sales_leads",
    )
    organization: Mapped[Organization | None] = relationship(
        "Organization",
        back_populates="sales_leads",
    )
    events: Mapped[list[SalesLeadEvent]] = relationship(
        "SalesLeadEvent",
        back_populates="lead",
        cascade="all, delete-orphan",
    )
    notes: Mapped[list[Note]] = relationship(
        "Note",
        back_populates="lead",
    )


class SalesLeadEvent(Base):
    """Event record for lead lifecycle transitions and actions."""

    __tablename__ = "sales_lead_events"
    __table_args__ = (Index("sales_lead_events_lead_idx", "lead_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    lead_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sales_leads.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type: Mapped[LeadEventType] = mapped_column(
        Enum(
            LeadEventType,
            name="lead_event_type",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
    )
    from_stage: Mapped[FunnelStage | None] = mapped_column(
        Enum(
            FunnelStage,
            name="funnel_stage",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=True,
    )
    to_stage: Mapped[FunnelStage | None] = mapped_column(
        Enum(
            FunnelStage,
            name="funnel_stage",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=True,
    )
    metadata_json: Mapped[dict[str, object] | None] = mapped_column(
        "metadata",
        JSONB(),
        nullable=True,
    )
    created_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    lead: Mapped[SalesLead] = relationship(
        "SalesLead",
        back_populates="events",
    )
