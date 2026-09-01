"""Repository for asset and access grant entities."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from uuid import UUID

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.db.models import (
    AccessGrantType,
    Asset,
    AssetAccessGrant,
    AssetShareLink,
    AssetTag,
    AssetType,
    AssetVisibility,
    CustomerInvoice,
    Tag,
)
from app.db.repositories.base import BaseRepository
from app.exceptions import ValidationError
from app.services.asset_expense_tagging import CLIENT_DOCUMENT_TAG_NAME


def _escape_like_pattern(pattern: str) -> str:
    """Escape LIKE pattern special characters."""
    return pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class AssetRepository(BaseRepository[Asset]):
    """Repository for Asset CRUD and access grant operations."""

    def __init__(self, session: Session):
        super().__init__(session, Asset)

    def resolve_asset_tag_filter_name(
        self,
        raw_tag_name: str,
        *,
        asset_type: AssetType | None,
    ) -> str:
        """Return canonical Tag.name for admin list filter, or raise ValidationError."""
        needle = raw_tag_name.strip().lower()
        stmt = (
            select(Tag.name)
            .join(AssetTag, AssetTag.tag_id == Tag.id)
            .join(Asset, Asset.id == AssetTag.asset_id)
            .where(func.lower(Tag.name) == needle)
        )
        if asset_type is not None:
            stmt = stmt.where(Asset.asset_type == asset_type)
        stmt = stmt.distinct().limit(1)
        found = self._session.execute(stmt).scalar_one_or_none()
        if found is None:
            raise ValidationError(
                "tag_name does not match a tag linked to an asset",
                field="tag_name",
            )
        return found

    def list_distinct_linked_asset_tag_names(
        self,
        *,
        asset_type: AssetType | None = None,
    ) -> list[str]:
        """Distinct tag names that appear on at least one asset (optional type filter)."""
        stmt = (
            select(Tag.name)
            .join(AssetTag, AssetTag.tag_id == Tag.id)
            .join(Asset, Asset.id == AssetTag.asset_id)
            .distinct()
            .order_by(Tag.name)
        )
        if asset_type is not None:
            stmt = stmt.where(Asset.asset_type == asset_type)
        return list(self._session.scalars(stmt).all())

    def list_assets(
        self,
        *,
        limit: int = 50,
        cursor: UUID | None = None,
        query: str | None = None,
        visibility: AssetVisibility | None = None,
        asset_type: AssetType | None = None,
        tag_name: str | None = None,
        load_tags: bool = False,
    ) -> Sequence[Asset]:
        """List assets with optional filtering and cursor pagination."""
        statement = select(Asset)
        if cursor is not None:
            statement = statement.where(Asset.id > cursor)
        if visibility is not None:
            statement = statement.where(Asset.visibility == visibility)
        if asset_type is not None:
            statement = statement.where(Asset.asset_type == asset_type)
        if tag_name is not None:
            tag_subq = (
                select(Tag.id)
                .where(func.lower(Tag.name) == tag_name.lower())
                .limit(1)
                .scalar_subquery()
            )
            statement = statement.join(
                AssetTag,
                AssetTag.asset_id == Asset.id,
            ).where(AssetTag.tag_id == tag_subq)
        if query:
            escaped = _escape_like_pattern(query.strip())
            pattern = f"%{escaped}%"
            statement = statement.outerjoin(
                CustomerInvoice,
                CustomerInvoice.asset_id == Asset.id,
            )
            statement = statement.where(
                or_(
                    Asset.title.ilike(pattern, escape="\\"),
                    Asset.file_name.ilike(pattern, escape="\\"),
                    Asset.resource_key.ilike(pattern, escape="\\"),
                    CustomerInvoice.bill_to_display_name.ilike(pattern, escape="\\"),
                    CustomerInvoice.invoice_number.ilike(pattern, escape="\\"),
                )
            )
        if load_tags:
            statement = statement.options(
                selectinload(Asset.asset_tags).selectinload(AssetTag.tag),
            )
        statement = statement.order_by(Asset.id).limit(limit)
        if query:
            statement = statement.distinct()
        return self._session.execute(statement).scalars().all()

    def get_with_asset_tags(self, asset_id: UUID) -> Asset | None:
        """Load one asset with tag associations for admin responses."""
        stmt = (
            select(Asset)
            .options(selectinload(Asset.asset_tags).selectinload(AssetTag.tag))
            .where(Asset.id == asset_id)
        )
        return self._session.execute(stmt).scalar_one_or_none()

    def list_public_assets(
        self,
        *,
        limit: int = 50,
        cursor: UUID | None = None,
    ) -> Sequence[Asset]:
        """List public assets only."""
        statement = select(Asset).where(Asset.visibility == AssetVisibility.PUBLIC)
        if cursor is not None:
            statement = statement.where(Asset.id > cursor)
        statement = statement.order_by(Asset.id).limit(limit)
        return self._session.execute(statement).scalars().all()

    def list_client_public_resources(
        self,
        *,
        limit: int = 50,
        cursor: UUID | None = None,
        language: str | None = None,
    ) -> Sequence[Asset]:
        """List public assets tagged client_document for the public website."""
        client_tag_ids = select(Tag.id).where(
            func.lower(Tag.name) == CLIENT_DOCUMENT_TAG_NAME.lower()
        )
        tagged_asset_ids = select(AssetTag.asset_id).where(
            AssetTag.tag_id.in_(client_tag_ids)
        )
        statement = select(Asset).where(
            Asset.visibility == AssetVisibility.PUBLIC,
            Asset.id.in_(tagged_asset_ids),
        )
        if language is not None:
            statement = statement.where(Asset.content_language == language)
        if cursor is not None:
            statement = statement.where(Asset.id > cursor)
        statement = statement.order_by(Asset.id).limit(limit)
        return self._session.execute(statement).scalars().all()

    def list_accessible_assets(
        self,
        *,
        user_sub: str,
        organization_ids: set[str],
        is_admin_or_manager: bool,
        limit: int = 50,
        cursor: UUID | None = None,
    ) -> Sequence[Asset]:
        """List assets visible to a specific authenticated user."""
        if is_admin_or_manager:
            return self.list_assets(limit=limit, cursor=cursor)

        grant_filter = _build_grant_filter(
            user_sub=user_sub, organization_ids=organization_ids
        )
        grant_exists = (
            select(AssetAccessGrant.id)
            .where(and_(AssetAccessGrant.asset_id == Asset.id, grant_filter))
            .exists()
        )
        statement = select(Asset).where(
            or_(
                Asset.visibility == AssetVisibility.PUBLIC,
                and_(Asset.visibility == AssetVisibility.RESTRICTED, grant_exists),
            )
        )
        if cursor is not None:
            statement = statement.where(Asset.id > cursor)
        statement = statement.order_by(Asset.id).limit(limit)
        return self._session.execute(statement).scalars().all()

    def can_access_asset(
        self,
        *,
        asset: Asset,
        user_sub: str | None,
        organization_ids: set[str],
        is_admin_or_manager: bool,
        is_authenticated: bool,
    ) -> bool:
        """Return whether a principal can access the given asset."""
        if asset.visibility == AssetVisibility.PUBLIC:
            return True
        if not is_authenticated:
            return False
        if is_admin_or_manager:
            return True
        if not user_sub:
            return False

        grant_filter = _build_grant_filter(
            user_sub=user_sub, organization_ids=organization_ids
        )
        statement = (
            select(func.count())
            .select_from(AssetAccessGrant)
            .where(and_(AssetAccessGrant.asset_id == asset.id, grant_filter))
        )
        count = self._session.execute(statement).scalar_one()
        return count > 0

    def create_asset(
        self,
        *,
        asset_id: UUID,
        title: str,
        description: str | None,
        asset_type: AssetType,
        s3_key: str,
        file_name: str,
        resource_key: str | None,
        content_type: str | None,
        content_language: str | None,
        visibility: AssetVisibility,
        created_by: str,
    ) -> Asset:
        """Create and persist an asset."""
        entity = Asset(
            id=asset_id,
            title=title,
            description=description,
            asset_type=asset_type,
            s3_key=s3_key,
            file_name=file_name,
            resource_key=resource_key,
            content_type=content_type,
            content_language=content_language,
            visibility=visibility,
            created_by=created_by,
        )
        return self.create(entity)

    def set_client_document_tag_link(self, asset_id: UUID, *, link: bool) -> None:
        """Add or remove only the client_document tag; does not touch other tags."""
        stmt = select(Tag.id).where(
            func.lower(Tag.name) == CLIENT_DOCUMENT_TAG_NAME.lower()
        )
        tag_id = self._session.execute(stmt).scalar_one_or_none()
        if tag_id is None:
            raise ValidationError(
                "client_document tag is not configured",
                field="client_tag",
            )
        if link:
            insert_stmt = pg_insert(AssetTag).values(asset_id=asset_id, tag_id=tag_id)
            self._session.execute(
                insert_stmt.on_conflict_do_nothing(constraint="asset_tags_pkey")
            )
        else:
            self._session.execute(
                delete(AssetTag).where(
                    and_(
                        AssetTag.asset_id == asset_id,
                        AssetTag.tag_id == tag_id,
                    )
                )
            )
        self._session.flush()

    def update_asset(
        self,
        asset: Asset,
        *,
        title: str | None = None,
        description: str | None = None,
        asset_type: AssetType | None = None,
        file_name: str | None = None,
        resource_key: str | None = None,
        update_resource_key: bool = False,
        content_type: str | None = None,
        content_language: str | None = None,
        update_content_language: bool = False,
        visibility: AssetVisibility | None = None,
        s3_key: str | None = None,
    ) -> Asset:
        """Update mutable asset fields."""
        if title is not None:
            asset.title = title
        if description is not None:
            asset.description = description
        if asset_type is not None:
            asset.asset_type = asset_type
        if file_name is not None:
            asset.file_name = file_name
        if update_resource_key:
            asset.resource_key = resource_key
        if content_type is not None:
            asset.content_type = content_type
        if update_content_language:
            asset.content_language = content_language
        if visibility is not None:
            asset.visibility = visibility
        if s3_key is not None:
            asset.s3_key = s3_key
        return self.update(asset)

    def find_by_s3_key(self, s3_key: str) -> Asset | None:
        """Return an asset that already uses this object key, if any."""
        normalized = s3_key.strip()
        if not normalized:
            return None
        stmt = select(Asset).where(Asset.s3_key == normalized)
        return self._session.execute(stmt).scalar_one_or_none()

    def find_by_resource_key(self, resource_key: str) -> Asset | None:
        """Return an asset by normalized media resource key."""
        normalized_key = resource_key.strip().lower()
        if not normalized_key:
            return None

        statement = select(Asset).where(
            func.lower(Asset.resource_key) == normalized_key
        )
        return self._session.execute(statement).scalar_one_or_none()

    def list_grants(self, *, asset_id: UUID) -> Sequence[AssetAccessGrant]:
        """List all grants for an asset."""
        statement = (
            select(AssetAccessGrant)
            .where(AssetAccessGrant.asset_id == asset_id)
            .order_by(AssetAccessGrant.created_at.desc(), AssetAccessGrant.id.desc())
        )
        return self._session.execute(statement).scalars().all()

    def list_by_ids(self, asset_ids: Sequence[UUID]) -> Sequence[Asset]:
        """Return assets for the provided IDs."""
        if not asset_ids:
            return []
        statement = select(Asset).where(Asset.id.in_(asset_ids))
        return self._session.execute(statement).scalars().all()

    def get_grant(
        self,
        *,
        asset_id: UUID,
        grant_id: UUID,
    ) -> AssetAccessGrant | None:
        """Get a grant by ID scoped to an asset."""
        statement = select(AssetAccessGrant).where(
            and_(AssetAccessGrant.asset_id == asset_id, AssetAccessGrant.id == grant_id)
        )
        return self._session.execute(statement).scalar_one_or_none()

    def create_grant(
        self,
        *,
        asset_id: UUID,
        grant_type: AccessGrantType,
        grantee_id: str | None,
        granted_by: str,
    ) -> AssetAccessGrant:
        """Create and persist an access grant."""
        entity = AssetAccessGrant(
            asset_id=asset_id,
            grant_type=grant_type,
            grantee_id=grantee_id,
            granted_by=granted_by,
        )
        self._session.add(entity)
        self._session.flush()
        self._session.refresh(entity)
        return entity

    def delete_grant(self, grant: AssetAccessGrant) -> None:
        """Delete an existing access grant."""
        self._session.delete(grant)
        self._session.flush()

    def find_matching_grant(
        self,
        *,
        asset_id: UUID,
        grant_type: AccessGrantType,
        grantee_id: str | None,
    ) -> AssetAccessGrant | None:
        """Find an existing grant by unique key."""
        normalized_grantee = grantee_id or ""
        statement = select(AssetAccessGrant).where(
            and_(
                AssetAccessGrant.asset_id == asset_id,
                AssetAccessGrant.grant_type == grant_type,
                func.coalesce(AssetAccessGrant.grantee_id, "") == normalized_grantee,
            )
        )
        return self._session.execute(statement).scalar_one_or_none()

    def get_share_link(self, *, asset_id: UUID) -> AssetShareLink | None:
        """Return the share link for a specific asset, if present."""
        statement = select(AssetShareLink).where(AssetShareLink.asset_id == asset_id)
        return self._session.execute(statement).scalar_one_or_none()

    def get_share_link_by_token(self, *, token: str) -> AssetShareLink | None:
        """Return a share link by bearer token."""
        statement = select(AssetShareLink).where(AssetShareLink.share_token == token)
        return self._session.execute(statement).scalar_one_or_none()

    def create_share_link(
        self,
        *,
        asset_id: UUID,
        share_token: str,
        allowed_domains: Sequence[str],
        created_by: str,
    ) -> AssetShareLink:
        """Create and persist a share link for an asset."""
        entity = AssetShareLink(
            asset_id=asset_id,
            share_token=share_token,
            allowed_domains=list(allowed_domains),
            created_by=created_by,
        )
        self._session.add(entity)
        self._session.flush()
        self._session.refresh(entity)
        return entity

    def rotate_share_link(
        self,
        share_link: AssetShareLink,
        *,
        share_token: str,
        allowed_domains: Sequence[str] | None = None,
    ) -> AssetShareLink:
        """Rotate an existing share-link token."""
        share_link.share_token = share_token
        if allowed_domains is not None:
            share_link.allowed_domains = list(allowed_domains)
        share_link.updated_at = datetime.now(UTC)
        self._session.flush()
        self._session.refresh(share_link)
        return share_link

    def update_share_link_allowed_domains(
        self,
        share_link: AssetShareLink,
        *,
        allowed_domains: Sequence[str],
    ) -> AssetShareLink:
        """Update allowed source domains for an existing share link."""
        share_link.allowed_domains = list(allowed_domains)
        share_link.updated_at = datetime.now(UTC)
        self._session.flush()
        self._session.refresh(share_link)
        return share_link

    def revoke_share_link(self, share_link: AssetShareLink) -> None:
        """Delete a share link."""
        self._session.delete(share_link)
        self._session.flush()


def _build_grant_filter(
    *,
    user_sub: str,
    organization_ids: set[str],
) -> ColumnElement[bool]:
    """Build SQL filter for grants matching the principal."""
    grant_clauses: list[ColumnElement[bool]] = [
        AssetAccessGrant.grant_type == AccessGrantType.ALL_AUTHENTICATED,
        and_(
            AssetAccessGrant.grant_type == AccessGrantType.USER,
            AssetAccessGrant.grantee_id == user_sub,
        ),
    ]
    if organization_ids:
        grant_clauses.append(
            and_(
                AssetAccessGrant.grant_type == AccessGrantType.ORGANIZATION,
                AssetAccessGrant.grantee_id.in_(sorted(organization_ids)),
            )
        )
    return or_(*grant_clauses)
