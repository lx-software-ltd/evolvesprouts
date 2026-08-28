"""Repository for hashed API tokens."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models.api_key import ApiKey
from app.db.repositories.base import BaseRepository


class ApiKeyRepository(BaseRepository[ApiKey]):
    """Data access for ``api_keys`` rows."""

    def __init__(self, session: Session):
        super().__init__(session, ApiKey)

    def find_active_by_hash(self, key_hash: str) -> ApiKey | None:
        """Return a non-revoked, non-expired token matching ``key_hash``."""
        now = datetime.now(timezone.utc)
        statement = select(ApiKey).where(
            ApiKey.key_hash == key_hash,
            ApiKey.revoked_at.is_(None),
            or_(ApiKey.expires_at.is_(None), ApiKey.expires_at > now),
        )
        return self._session.execute(statement).scalar_one_or_none()

    def list_newest(
        self,
        *,
        limit: int,
        cursor_created_at: datetime | None = None,
        cursor_id: UUID | None = None,
    ) -> list[ApiKey]:
        """List tokens, newest first."""
        statement = select(ApiKey)
        if cursor_created_at is not None and cursor_id is not None:
            statement = statement.where(
                or_(
                    ApiKey.created_at < cursor_created_at,
                    (ApiKey.created_at == cursor_created_at) & (ApiKey.id < cursor_id),
                )
            )
        statement = statement.order_by(
            ApiKey.created_at.desc(), ApiKey.id.desc()
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    def touch_last_used(self, api_key: ApiKey) -> ApiKey:
        """Refresh ``last_used_at`` to now."""
        api_key.last_used_at = datetime.now(timezone.utc)
        return self.update(api_key)

    def revoke(self, api_key: ApiKey) -> ApiKey:
        """Soft-revoke a token (idempotent)."""
        if api_key.revoked_at is None:
            api_key.revoked_at = datetime.now(timezone.utc)
            return self.update(api_key)
        return api_key
