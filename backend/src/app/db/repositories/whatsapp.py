"""Repository for WhatsApp conversations and messages."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db.models.enums import WhatsAppMessageDirection
from app.db.models.whatsapp import WhatsAppConversation, WhatsAppMessage
from app.db.repositories.base import BaseRepository


def _escape_like_pattern(pattern: str) -> str:
    """Escape LIKE wildcards so user input is matched literally."""
    return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class WhatsAppRepository(BaseRepository[WhatsAppConversation]):
    """Data access for webhook-captured WhatsApp threads."""

    def __init__(self, session: Session):
        super().__init__(session, WhatsAppConversation)

    def get_conversation_by_wa_id(self, wa_id: str) -> WhatsAppConversation | None:
        """Fetch a conversation by counterparty WhatsApp id."""
        statement = select(WhatsAppConversation).where(
            WhatsAppConversation.wa_id == wa_id
        )
        return self._session.execute(statement).scalar_one_or_none()

    def get_conversation_by_id(
        self, conversation_id: UUID
    ) -> WhatsAppConversation | None:
        """Fetch a conversation by primary key with contact loaded."""
        statement = (
            select(WhatsAppConversation)
            .where(WhatsAppConversation.id == conversation_id)
            .options(selectinload(WhatsAppConversation.contact))
        )
        return self._session.execute(statement).scalar_one_or_none()

    def find_message_by_wa_message_id(
        self, wa_message_id: str
    ) -> WhatsAppMessage | None:
        """Fetch a stored message by WhatsApp message id (webhook dedup)."""
        statement = select(WhatsAppMessage).where(
            WhatsAppMessage.wa_message_id == wa_message_id
        )
        return self._session.execute(statement).scalar_one_or_none()

    def find_message_by_content(
        self,
        *,
        conversation_id: UUID,
        sent_at: datetime,
        direction: WhatsAppMessageDirection,
        body: str | None,
    ) -> WhatsAppMessage | None:
        """Fetch a stored message matching conversation, time, direction, and body."""
        statement = (
            select(WhatsAppMessage)
            .where(
                WhatsAppMessage.conversation_id == conversation_id,
                WhatsAppMessage.sent_at == sent_at,
                WhatsAppMessage.direction == direction,
                WhatsAppMessage.body.is_(None)
                if body is None
                else WhatsAppMessage.body == body,
            )
            .limit(1)
        )
        return self._session.execute(statement).scalar_one_or_none()

    def list_conversations(
        self,
        *,
        limit: int,
        cursor_last_message_at: datetime | None = None,
        cursor_id: UUID | None = None,
        search: str | None = None,
        search_wa_id: bool = True,
        contact_id: UUID | None = None,
    ) -> list[WhatsAppConversation]:
        """List conversations, most recent activity first."""
        statement = select(WhatsAppConversation).options(
            selectinload(WhatsAppConversation.contact)
        )
        if contact_id is not None:
            statement = statement.where(WhatsAppConversation.contact_id == contact_id)
        statement = self._apply_search(statement, search, search_wa_id=search_wa_id)
        if cursor_last_message_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    WhatsAppConversation.last_message_at < cursor_last_message_at,
                    (WhatsAppConversation.last_message_at == cursor_last_message_at)
                    & (WhatsAppConversation.id < cursor_id),
                )
            )
        statement = statement.order_by(
            WhatsAppConversation.last_message_at.desc().nulls_last(),
            WhatsAppConversation.id.desc(),
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    def count_conversations(
        self,
        *,
        search: str | None = None,
        search_wa_id: bool = True,
        contact_id: UUID | None = None,
    ) -> int:
        """Count conversations matching the optional search filter."""
        statement = select(func.count(WhatsAppConversation.id))
        if contact_id is not None:
            statement = statement.where(WhatsAppConversation.contact_id == contact_id)
        statement = self._apply_search(statement, search, search_wa_id=search_wa_id)
        return int(self._session.execute(statement).scalar_one())

    def list_messages(
        self,
        *,
        conversation_id: UUID,
        limit: int,
        before_sent_at: datetime | None = None,
        before_id: UUID | None = None,
    ) -> list[WhatsAppMessage]:
        """List messages for a conversation, newest first."""
        statement = select(WhatsAppMessage).where(
            WhatsAppMessage.conversation_id == conversation_id
        )
        if before_sent_at is not None and before_id is not None:
            statement = statement.where(
                or_(
                    WhatsAppMessage.sent_at < before_sent_at,
                    (WhatsAppMessage.sent_at == before_sent_at)
                    & (WhatsAppMessage.id < before_id),
                )
            )
        statement = statement.order_by(
            WhatsAppMessage.sent_at.desc(),
            WhatsAppMessage.id.desc(),
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    @staticmethod
    def _apply_search(
        statement: Any, search: str | None, *, search_wa_id: bool = True
    ) -> Any:
        if not search:
            return statement
        pattern = f"%{_escape_like_pattern(search.strip())}%"
        clauses = [WhatsAppConversation.profile_name.ilike(pattern, escape="\\")]
        if search_wa_id:
            clauses.append(WhatsAppConversation.wa_id.ilike(pattern, escape="\\"))
        return statement.where(or_(*clauses))
