"""Repository for organization entities."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Literal
from uuid import UUID

from sqlalchemy import and_, func, literal, or_, select
from sqlalchemy.orm import Session, raiseload, selectinload

from app.db.models import Location, Organization, RelationshipType
from app.db.models.organization import OrganizationMember
from app.db.models.tag import OrganizationTag
from app.db.repositories.base import BaseRepository


def _escape_like_pattern(pattern: str) -> str:
    """Escape LIKE pattern special characters."""
    return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _normalize_vendor_match_name(parsed_vendor_name: str) -> str:
    """Normalize parser output for vendor matching (trim, collapse whitespace)."""
    return re.sub(r"\s+", " ", parsed_vendor_name.strip())


# Substring (ILIKE) auto-link is risky; require a substantial name and reject
# generic-only strings before applying Tier 2 matching.
_MIN_CHARS_FOR_VENDOR_FUZZY_MATCH = 12
_GENERIC_VENDOR_NAME_TOKENS: frozenset[str] = frozenset(
    {
        "and",
        "bv",
        "co",
        "company",
        "corp",
        "corporation",
        "gmbh",
        "group",
        "holding",
        "holdings",
        "inc",
        "incorporated",
        "limited",
        "llc",
        "ltd",
        "nv",
        "plc",
        "pte",
        "sa",
        "services",
        "service",
        "the",
    }
)


def _vendor_token_key(token: str) -> str:
    return token.strip(".,;:\"'()[]").lower()


def _should_skip_vendor_fuzzy_match(normalized: str) -> bool:
    """Block weak parser output from Tier 2 vendor FK linking."""
    if len(normalized) < _MIN_CHARS_FOR_VENDOR_FUZZY_MATCH:
        return True
    tokens = [_vendor_token_key(t) for t in normalized.split() if t.strip()]
    if not tokens:
        return True
    if len(tokens) == 1 and tokens[0] in _GENERIC_VENDOR_NAME_TOKENS:
        return True
    if all(t in _GENERIC_VENDOR_NAME_TOKENS for t in tokens):
        return True
    return False


_CRM_DEFAULT_RELATIONSHIP_TYPES: tuple[RelationshipType, ...] = tuple(
    rt
    for rt in RelationshipType
    if rt not in (RelationshipType.VENDOR, RelationshipType.PARTNER)
)


def _is_substantial_vendor_name_for_reverse_match(normalized_vendor_name: str) -> bool:
    """Whether a vendor list name is specific enough to appear inside parsed text."""
    v = _normalize_vendor_match_name(normalized_vendor_name)
    if len(v) < 3:
        return False
    tokens = [_vendor_token_key(t) for t in v.split() if t.strip()]
    if not tokens:
        return False
    if len(tokens) == 1 and tokens[0] in _GENERIC_VENDOR_NAME_TOKENS:
        return False
    if all(t in _GENERIC_VENDOR_NAME_TOKENS for t in tokens):
        return False
    return True


OrganizationListOrder = Literal["created_desc", "name_asc"]


class OrganizationRepository(BaseRepository[Organization]):
    """Repository helpers for organization records."""

    def __init__(self, session: Session):
        super().__init__(session, Organization)

    def list_organizations(
        self,
        *,
        limit: int,
        cursor: UUID | None = None,
        query: str | None = None,
        active: bool | None = None,
        relationship_types: Sequence[RelationshipType] | None = None,
        include_relationships: bool = True,
        list_order: OrganizationListOrder = "created_desc",
    ) -> list[Organization]:
        """List organizations with optional relationship-type filter.

        When ``relationship_types`` is omitted, vendor and partner rows are excluded
        (Contacts default). Pass ``relationship_types=(RelationshipType.PARTNER,)``
        for Services, ``relationship_types=(RelationshipType.VENDOR,)`` for Finance.
        """
        statement = select(Organization)
        if relationship_types is not None:
            statement = statement.where(
                Organization.relationship_type.in_(tuple(relationship_types))
            )
        else:
            statement = statement.where(
                Organization.relationship_type.in_(_CRM_DEFAULT_RELATIONSHIP_TYPES)
            )
        if include_relationships:
            statement = statement.options(
                selectinload(Organization.organization_tags).selectinload(
                    OrganizationTag.tag
                ),
                selectinload(Organization.organization_members).selectinload(
                    OrganizationMember.contact
                ),
                selectinload(Organization.location).selectinload(Location.area),
            )
        else:
            statement = statement.options(
                raiseload(Organization.organization_tags),
                raiseload(Organization.organization_members),
                raiseload(Organization.location),
            )
        name_sort_key = func.lower(func.trim(Organization.name))
        if cursor is not None:
            if list_order == "name_asc":
                cursor_name_key = (
                    select(name_sort_key)
                    .where(Organization.id == cursor)
                    .scalar_subquery()
                )
                statement = statement.where(
                    or_(
                        name_sort_key > cursor_name_key,
                        and_(
                            name_sort_key == cursor_name_key, Organization.id > cursor
                        ),
                    )
                )
            else:
                cursor_created_at = (
                    select(Organization.created_at)
                    .where(Organization.id == cursor)
                    .scalar_subquery()
                )
                statement = statement.where(
                    or_(
                        Organization.created_at < cursor_created_at,
                        and_(
                            Organization.created_at == cursor_created_at,
                            Organization.id < cursor,
                        ),
                    )
                )
        if query:
            escaped = _escape_like_pattern(query.strip())
            pattern = f"%{escaped}%"
            statement = statement.where(Organization.name.ilike(pattern, escape="\\"))
        if active is True:
            statement = statement.where(Organization.archived_at.is_(None))
        if active is False:
            statement = statement.where(Organization.archived_at.is_not(None))
        if list_order == "name_asc":
            statement = statement.order_by(
                name_sort_key.asc(),
                Organization.id.asc(),
            )
        else:
            statement = statement.order_by(
                Organization.created_at.desc(),
                Organization.id.desc(),
            )
        statement = statement.limit(limit)
        return list(self._session.execute(statement).scalars().unique().all())

    def count_organizations(
        self,
        *,
        query: str | None = None,
        active: bool | None = None,
        relationship_types: Sequence[RelationshipType] | None = None,
    ) -> int:
        statement = select(func.count(Organization.id))
        if relationship_types is not None:
            statement = statement.where(
                Organization.relationship_type.in_(tuple(relationship_types))
            )
        else:
            statement = statement.where(
                Organization.relationship_type.in_(_CRM_DEFAULT_RELATIONSHIP_TYPES)
            )
        if query:
            escaped = _escape_like_pattern(query.strip())
            pattern = f"%{escaped}%"
            statement = statement.where(Organization.name.ilike(pattern, escape="\\"))
        if active is True:
            statement = statement.where(Organization.archived_at.is_(None))
        if active is False:
            statement = statement.where(Organization.archived_at.is_not(None))
        count = self._session.execute(statement).scalar_one_or_none()
        return int(count or 0)

    def get_organization_by_id(self, organization_id: UUID) -> Organization | None:
        statement = (
            select(Organization)
            .where(Organization.id == organization_id)
            .options(
                selectinload(Organization.organization_tags).selectinload(
                    OrganizationTag.tag
                ),
                selectinload(Organization.organization_members).selectinload(
                    OrganizationMember.contact
                ),
                selectinload(Organization.location).selectinload(Location.area),
            )
        )
        return self._session.execute(statement).scalar_one_or_none()

    def get_non_vendor_organization_by_id(
        self, organization_id: UUID
    ) -> Organization | None:
        """Load one organization for Contacts (excludes vendor rows)."""
        statement = (
            select(Organization)
            .where(
                Organization.id == organization_id,
                Organization.relationship_type != RelationshipType.VENDOR,
            )
            .options(
                selectinload(Organization.organization_tags).selectinload(
                    OrganizationTag.tag
                ),
                selectinload(Organization.organization_members).selectinload(
                    OrganizationMember.contact
                ),
                selectinload(Organization.location).selectinload(Location.area),
            )
        )
        return self._session.execute(statement).scalar_one_or_none()

    def get_vendor_by_id(self, vendor_id: UUID) -> Organization | None:
        """Return one organization only when it is a vendor."""
        statement = select(Organization).where(
            Organization.id == vendor_id,
            Organization.relationship_type == RelationshipType.VENDOR,
        )
        return self._session.execute(statement).scalar_one_or_none()

    def try_resolve_active_vendor_by_parsed_name(
        self, parsed_vendor_name: str
    ) -> Organization | None:
        """Match parsed invoice vendor text to at most one active vendor org.

        Tier 1: case-insensitive equality on trimmed names.
        Tier 2: single ILIKE substring match among active vendors only, only when
        the normalized parser string is long enough and not generic-only tokens
        (vendor.name contains the parsed string).
        Tier 3: when Tier 2 finds no hit, match vendors whose list name appears inside
        the parsed string and passes a specificity check; if several qualify, the
        longest name wins only when that length is unique (invoice legal name vs
        shorter list label).
        Returns None when ambiguous or unmatched.
        """
        normalized = _normalize_vendor_match_name(parsed_vendor_name)
        if not normalized:
            return None

        exact_stmt = (
            select(Organization)
            .where(
                Organization.relationship_type == RelationshipType.VENDOR,
                Organization.archived_at.is_(None),
                func.lower(func.trim(Organization.name)) == normalized.lower(),
            )
            .limit(2)
        )
        exact_hits = list(self._session.execute(exact_stmt).scalars().all())
        if len(exact_hits) == 1:
            return exact_hits[0]
        if len(exact_hits) > 1:
            return None

        if _should_skip_vendor_fuzzy_match(normalized):
            return None

        escaped = _escape_like_pattern(normalized)
        pattern = f"%{escaped}%"
        fuzzy_stmt = (
            select(Organization)
            .where(
                Organization.relationship_type == RelationshipType.VENDOR,
                Organization.archived_at.is_(None),
                Organization.name.ilike(pattern, escape="\\"),
            )
            .limit(2)
        )
        fuzzy_hits = list(self._session.execute(fuzzy_stmt).scalars().all())
        if len(fuzzy_hits) == 1:
            return fuzzy_hits[0]
        if len(fuzzy_hits) > 1:
            return None

        return self._try_resolve_vendor_name_contained_in_parsed(normalized=normalized)

    def _try_resolve_vendor_name_contained_in_parsed(
        self, *, normalized: str
    ) -> Organization | None:
        """Tier 3: parsed invoice vendor text contains an active vendor list name."""
        norm_lower = normalized.lower()
        rev_stmt = select(Organization).where(
            Organization.relationship_type == RelationshipType.VENDOR,
            Organization.archived_at.is_(None),
            func.strpos(
                literal(norm_lower),
                func.lower(func.trim(Organization.name)),
            )
            > 0,
        )
        rows = list(self._session.execute(rev_stmt).scalars().all())
        substantial = [
            o for o in rows if _is_substantial_vendor_name_for_reverse_match(o.name)
        ]
        if not substantial:
            return None
        best_len = max(len(_normalize_vendor_match_name(o.name)) for o in substantial)
        best = [
            o
            for o in substantial
            if len(_normalize_vendor_match_name(o.name)) == best_len
        ]
        if len(best) == 1:
            return best[0]
        return None
