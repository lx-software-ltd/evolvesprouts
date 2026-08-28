"""Repository for Messenger and Instagram conversations and messages."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db.models.enums import MetaChannel
from app.db.models.meta import MetaConversation, MetaMessage
from app.db.repositories.base import BaseRepository


def _escape_like_pattern(pattern: str) -> str:
    """Escape LIKE wildcards so user input is matched literally."""
    return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class MetaRepository(BaseRepository[MetaConversation]):
    """Data access for webhook-captured Messenger and Instagram threads."""

    def __init__(self, session: Session):
        super().__init__(session, MetaConversation)

    def get_conversation_by_platform_user(
        self,
        *,
        channel: MetaChannel,
        platform_user_id: str,
    ) -> MetaConversation | None:
        """Fetch a conversation by channel and Page-scoped user id."""
        statement = select(MetaConversation).where(
            MetaConversation.channel == channel,
            MetaConversation.platform_user_id == platform_user_id,
        )
        return self._session.execute(statement).scalar_one_or_none()

    def get_conversation_by_id(self, conversation_id: UUID) -> MetaConversation | None:
        """Fetch a conversation by primary key with contact loaded."""
        statement = (
            select(MetaConversation)
            .where(MetaConversation.id == conversation_id)
            .options(selectinload(MetaConversation.contact))
        )
        return self._session.execute(statement).scalar_one_or_none()

    def find_message_by_platform_message_id(
        self, platform_message_id: str
    ) -> MetaMessage | None:
        """Fetch a stored message by Meta message id (webhook dedup)."""
        statement = select(MetaMessage).where(
            MetaMessage.platform_message_id == platform_message_id
        )
        return self._session.execute(statement).scalar_one_or_none()

    def list_conversations(
        self,
        *,
        limit: int,
        cursor_last_message_at: datetime | None = None,
        cursor_id: UUID | None = None,
        search: str | None = None,
        channel: MetaChannel | None = None,
        search_platform_user_id: bool = True,
    ) -> list[MetaConversation]:
        """List conversations, most recent activity first."""
        statement = select(MetaConversation).options(
            selectinload(MetaConversation.contact)
        )
        if channel is not None:
            statement = statement.where(MetaConversation.channel == channel)
        statement = self._apply_search(
            statement, search, search_platform_user_id=search_platform_user_id
        )
        if cursor_last_message_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    MetaConversation.last_message_at < cursor_last_message_at,
                    (MetaConversation.last_message_at == cursor_last_message_at)
                    & (MetaConversation.id < cursor_id),
                )
            )
        statement = statement.order_by(
            MetaConversation.last_message_at.desc().nulls_last(),
            MetaConversation.id.desc(),
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    def count_conversations(
        self,
        *,
        search: str | None = None,
        channel: MetaChannel | None = None,
        search_platform_user_id: bool = True,
    ) -> int:
        """Count conversations matching the optional filters."""
        statement = select(func.count(MetaConversation.id))
        if channel is not None:
            statement = statement.where(MetaConversation.channel == channel)
        statement = self._apply_search(
            statement, search, search_platform_user_id=search_platform_user_id
        )
        return int(self._session.execute(statement).scalar_one())

    def list_messages(
        self,
        *,
        conversation_id: UUID,
        limit: int,
        before_sent_at: datetime | None = None,
        before_id: UUID | None = None,
    ) -> list[MetaMessage]:
        """List messages for a conversation, newest first."""
        statement = select(MetaMessage).where(
            MetaMessage.conversation_id == conversation_id
        )
        if before_sent_at is not None and before_id is not None:
            statement = statement.where(
                or_(
                    MetaMessage.sent_at < before_sent_at,
                    (MetaMessage.sent_at == before_sent_at)
                    & (MetaMessage.id < before_id),
                )
            )
        statement = statement.order_by(
            MetaMessage.sent_at.desc(),
            MetaMessage.id.desc(),
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    @staticmethod
    def _apply_search(
        statement: Any,
        search: str | None,
        *,
        search_platform_user_id: bool = True,
    ) -> Any:
        if not search:
            return statement
        pattern = f"%{_escape_like_pattern(search.strip())}%"
        clauses = [MetaConversation.profile_name.ilike(pattern, escape="\\")]
        if search_platform_user_id:
            clauses.append(
                MetaConversation.platform_user_id.ilike(pattern, escape="\\")
            )
        return statement.where(or_(*clauses))
