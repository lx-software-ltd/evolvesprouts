"""CRM contact model."""

from __future__ import annotations

from datetime import date
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from collections.abc import Iterable

from sqlalchemy import Date, Enum, ForeignKey, Index, String, Text, null, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base
from app.utils.phone import format_phone_e164
from app.db.models.enums import (
    ContactSource,
    ContactType,
    MailchimpSyncStatus,
    RelationshipType,
)

if TYPE_CHECKING:
    from app.db.models.note import Note
    from app.db.models.family import Family, FamilyMember
    from app.db.models.location import Location
    from app.db.models.organization import Organization, OrganizationMember
    from app.db.models.sales_lead import SalesLead
    from app.db.models.tag import ContactTag, Tag


def _enum_values(
    enum_cls: Iterable[
        ContactType | RelationshipType | ContactSource | MailchimpSyncStatus
    ],
) -> list[str]:
    """Return enum labels stored in PostgreSQL."""
    return [member.value for member in enum_cls]


class Contact(Base):
    """CRM contact record."""

    __tablename__ = "contacts"
    __table_args__ = (
        Index(
            "contacts_email_unique_idx",
            text("lower(email)"),
            unique=True,
            postgresql_where=text("email IS NOT NULL"),
        ),
        Index(
            "contacts_instagram_unique_idx",
            text("lower(instagram_handle)"),
            unique=True,
            postgresql_where=text("instagram_handle IS NOT NULL"),
        ),
        Index("contacts_contact_type_idx", "contact_type"),
        Index("contacts_relationship_type_idx", "relationship_type"),
        Index("contacts_source_idx", "source"),
        Index(
            "contacts_archived_at_idx",
            "archived_at",
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    instagram_handle: Mapped[str | None] = mapped_column(String(30), nullable=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone_region: Mapped[str | None] = mapped_column(String(2), nullable=True)
    phone_national_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contact_type: Mapped[ContactType] = mapped_column(
        Enum(
            ContactType,
            name="contact_type",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
    )
    relationship_type: Mapped[RelationshipType] = mapped_column(
        Enum(
            RelationshipType,
            name="relationship_type",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
        server_default=text("'prospect'"),
    )
    date_of_birth: Mapped[date | None] = mapped_column(Date(), nullable=True)
    location_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("locations.id", ondelete="SET NULL"),
        nullable=True,
    )
    source: Mapped[ContactSource] = mapped_column(
        Enum(
            ContactSource,
            name="contact_source",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
    )
    source_detail: Mapped[str | None] = mapped_column(Text(), nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_metadata: Mapped[dict[str, object] | None] = mapped_column(
        JSONB(),
        nullable=True,
    )
    mailchimp_subscriber_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    mailchimp_status: Mapped[MailchimpSyncStatus] = mapped_column(
        Enum(
            MailchimpSyncStatus,
            name="mailchimp_sync_status",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
        server_default=text("'pending'"),
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
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

    family_members: Mapped[list[FamilyMember]] = relationship(
        "FamilyMember",
        back_populates="contact",
        cascade="all, delete-orphan",
    )
    organization_members: Mapped[list[OrganizationMember]] = relationship(
        "OrganizationMember",
        back_populates="contact",
        cascade="all, delete-orphan",
    )
    contact_tags: Mapped[list[ContactTag]] = relationship(
        "ContactTag",
        back_populates="contact",
        cascade="all, delete-orphan",
    )
    sales_leads: Mapped[list[SalesLead]] = relationship(
        "SalesLead",
        back_populates="contact",
    )
    notes: Mapped[list[Note]] = relationship(
        "Note",
        back_populates="contact",
    )

    families: Mapped[list[Family]] = relationship(
        "Family",
        secondary="family_members",
        viewonly=True,
    )
    organizations: Mapped[list[Organization]] = relationship(
        "Organization",
        secondary="organization_members",
        viewonly=True,
    )
    location: Mapped[Location | None] = relationship(
        "Location",
        back_populates="contacts",
    )
    tags: Mapped[list[Tag]] = relationship(
        "Tag",
        secondary="contact_tags",
        viewonly=True,
    )

    @hybrid_property
    def phone_e164(self) -> str | None:
        """E.164 derived at read time (not stored)."""
        return format_phone_e164(self.phone_region, self.phone_national_number)

    @phone_e164.expression  # type: ignore[no-redef]
    def phone_e164(cls) -> object:  # noqa: N805
        """Always NULL in SQL — do not use in SELECT; use Python ``phone_e164`` or serializers."""
        return null().label("phone_e164")


def contact_full_name(contact: Contact | None) -> str | None:
    """``first_name last_name`` for display, or ``None`` when both are blank.

    Accepts any object exposing ``first_name`` / ``last_name`` so serializers can
    share one implementation for ORM rows and lightweight test doubles.
    """
    if contact is None:
        return None
    parts = [contact.first_name, contact.last_name]
    return " ".join(p for p in parts if p).strip() or None
