"""WhatsApp conversation and message models (webhook-captured)."""

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
from app.db.models.enums import WhatsAppMessageDirection

if TYPE_CHECKING:
    from app.db.models.contact import Contact
    from app.db.models.sales_lead import SalesLead


def _enum_values(enum_cls: Iterable[WhatsAppMessageDirection]) -> list[str]:
    """Return enum labels stored in PostgreSQL."""
    return [member.value for member in enum_cls]


class WhatsAppConversation(Base):
    """One WhatsApp thread per counterparty phone number (``wa_id``)."""

    __tablename__ = "whatsapp_conversations"
    __table_args__ = (
        Index("whatsapp_conversations_wa_id_idx", "wa_id", unique=True),
        Index("whatsapp_conversations_contact_idx", "contact_id"),
        Index("whatsapp_conversations_last_message_idx", "last_message_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    wa_id: Mapped[str] = mapped_column(String(32), nullable=False)
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
    messages: Mapped[list[WhatsAppMessage]] = relationship(
        "WhatsAppMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
    )


class WhatsAppMessage(Base):
    """Single WhatsApp message captured from webhook delivery."""

    __tablename__ = "whatsapp_messages"
    __table_args__ = (
        Index("whatsapp_messages_wa_message_id_idx", "wa_message_id", unique=True),
        Index("whatsapp_messages_conversation_idx", "conversation_id", "sent_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("whatsapp_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    wa_message_id: Mapped[str] = mapped_column(String(128), nullable=False)
    direction: Mapped[WhatsAppMessageDirection] = mapped_column(
        Enum(
            WhatsAppMessageDirection,
            name="whatsapp_message_direction",
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

    conversation: Mapped[WhatsAppConversation] = relationship(
        "WhatsAppConversation",
        back_populates="messages",
    )
