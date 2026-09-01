"""Keep expense-linked asset tags in sync with expense_attachments."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import Asset, AssetTag, AssetVisibility, ExpenseAttachment, Tag

# System tag applied to assets referenced by expense_attachments (unique name).
EXPENSE_ATTACHMENT_TAG_NAME = "expense_attachment"

# Admin-assignable tag for client-facing documents (optional on assets).
CLIENT_DOCUMENT_TAG_NAME = "client_document"


def expense_attachment_tag_id(session: Session) -> UUID | None:
    """Resolve the expense_attachment tag id, if present."""
    stmt = select(Tag.id).where(
        func.lower(Tag.name) == EXPENSE_ATTACHMENT_TAG_NAME.lower()
    )
    return session.execute(stmt).scalar_one_or_none()


def sync_expense_attachment_tags_for_assets(
    session: Session, asset_ids: set[UUID]
) -> None:
    """Add or remove the expense_attachment tag to match expense_attachments rows."""
    if not asset_ids:
        return
    tag_id = expense_attachment_tag_id(session)
    if tag_id is None:
        return

    for asset_id in asset_ids:
        count_stmt = (
            select(func.count())
            .select_from(ExpenseAttachment)
            .where(ExpenseAttachment.asset_id == asset_id)
        )
        count_val = session.execute(count_stmt).scalar_one()
        if int(count_val or 0) > 0:
            session.execute(
                pg_insert(AssetTag)
                .values(asset_id=asset_id, tag_id=tag_id)
                .on_conflict_do_nothing()
            )
            session.execute(
                update(Asset)
                .where(Asset.id == asset_id)
                .values(visibility=AssetVisibility.RESTRICTED)
            )
        else:
            session.execute(
                delete(AssetTag).where(
                    AssetTag.asset_id == asset_id,
                    AssetTag.tag_id == tag_id,
                )
            )
