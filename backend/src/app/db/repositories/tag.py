"""Repository for the CRM tag catalog and cross-entity tag usage counts."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select, union_all
from sqlalchemy.orm import Session

from app.db.models import (
    AssetTag,
    ContactTag,
    FamilyTag,
    OrganizationTag,
    ServiceInstanceTag,
    ServiceTag,
    Tag,
)
from app.db.repositories.base import BaseRepository

_TAG_LINK_TABLES = (
    ContactTag,
    FamilyTag,
    OrganizationTag,
    AssetTag,
    ServiceTag,
    ServiceInstanceTag,
)


class TagRepository(BaseRepository[Tag]):
    """Data access for ``tags`` rows and their link tables."""

    def __init__(self, session: Session):
        super().__init__(session, Tag)

    def list_catalog(
        self, *, include_archived: bool = False, archived_only: bool = False
    ) -> list[Tag]:
        """Tags ordered case-insensitively by name; active only unless asked otherwise."""
        statement = select(Tag).order_by(func.lower(Tag.name))
        if archived_only:
            statement = statement.where(Tag.archived_at.is_not(None))
        elif not include_archived:
            statement = statement.where(Tag.archived_at.is_(None))
        return list(self._session.execute(statement).scalars().all())

    def list_active(self) -> list[Tag]:
        """Active tags for picker controls."""
        return self.list_catalog()

    def usage_counts_by_tag_id(self, tag_ids: list[UUID]) -> dict[UUID, int]:
        """Total link rows per tag across every taggable entity in one query."""
        if not tag_ids:
            return {}
        # Use mapped ``__table__`` columns so static type checkers accept ``tag_id``
        # (ORM ``.tag_id`` attributes are not always inferred on declarative classes).
        per_table = [
            select(link.__table__.c.tag_id, func.count().label("cnt"))
            .where(link.__table__.c.tag_id.in_(tag_ids))
            .group_by(link.__table__.c.tag_id)
            for link in _TAG_LINK_TABLES
        ]
        combined = union_all(*per_table).subquery()
        statement = select(combined.c.tag_id, func.sum(combined.c.cnt)).group_by(
            combined.c.tag_id
        )
        rows = self._session.execute(statement).all()
        return {row[0]: int(row[1] or 0) for row in rows}

    def usage_count(self, tag_id: UUID) -> int:
        """Total link rows for one tag."""
        return self.usage_counts_by_tag_id([tag_id]).get(tag_id, 0)
