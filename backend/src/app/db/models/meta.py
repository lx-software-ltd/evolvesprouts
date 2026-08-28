"""Messenger and Instagram conversation models (webhook-captured)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from collections.abc import Iterable

from sqlalchemy import Enum, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base
from app.db.models.enums import MetaChannel, MetaMessageDirection

if TYPE_CHECKING:
    from app.db.models.contact import Contact
    from app.db.models.sales_lead import SalesLead


def _enum_values(enum_cls: Iterable[MetaChannel | MetaMessageDirection]) -> list[str]:
    """Return enum labels stored in PostgreSQL."""
    return [member.value for member in enum_cls]


class MetaConversation(Base):
    """One Messenger or Instagram thread per Page-scoped user id."""

    __tablename__ = "meta_conversations"
    __table_args__ = (
        Index(
            "meta_conversations_channel_user_idx",
            "channel",
            "platform_user_id",
            unique=True,
        ),
        Index("meta_conversations_contact_idx", "contact_id"),
        Index("meta_conversations_last_message_idx", "last_message_at"),
        Index("meta_conversations_channel_idx", "channel"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    channel: Mapped[MetaChannel] = mapped_column(
        Enum(
            MetaChannel,
            name="meta_channel",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
    )
    platform_user_id: Mapped[str] = mapped_column(String(128), nullable=False)
    page_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    profile_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    contact_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    lead_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sales_leads.id", ondelete="SET NULL"),
        nullable=True,
    )
    first_inbound_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    last_message_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    inbound_count: Mapped[int] = mapped_column(
        Integer(),
        nullable=False,
        server_default=text("0"),
    )
    outbound_count: Mapped[int] = mapped_column(
        Integer(),
        nullable=False,
        server_default=text("0"),
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

    contact: Mapped[Contact | None] = relationship("Contact")
    lead: Mapped[SalesLead | None] = relationship("SalesLead")
    messages: Mapped[list[MetaMessage]] = relationship(
        "MetaMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
    )


class MetaMessage(Base):
    """Single Messenger or Instagram message captured from webhook delivery."""

    __tablename__ = "meta_messages"
    __table_args__ = (
        Index("meta_messages_platform_message_id_idx", "platform_message_id", unique=True),
        Index("meta_messages_conversation_idx", "conversation_id", "sent_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("meta_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    platform_message_id: Mapped[str] = mapped_column(String(256), nullable=False)
    direction: Mapped[MetaMessageDirection] = mapped_column(
        Enum(
            MetaMessageDirection,
            name="meta_message_direction",
            values_callable=_enum_values,
            create_type=False,
        ),
        nullable=False,
    )
    message_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'text'"),
    )
    body: Mapped[str | None] = mapped_column(Text(), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    conversation: Mapped[MetaConversation] = relationship(
        "MetaConversation",
        back_populates="messages",
    )
