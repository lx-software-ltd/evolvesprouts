"""Keep customer-invoice assets tagged, restricted, and linked."""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import (
    Asset,
    AssetTag,
    AssetType,
    AssetVisibility,
    CustomerInvoice,
    Tag,
)
from app.db.repositories.asset import AssetRepository

# System tag applied to assets linked from customer_invoices (unique name).
CUSTOMER_INVOICE_TAG_NAME = "customer_invoice"

_INVOICE_ASSET_ACTOR = "system"
_MAX_TITLE_LENGTH = 255
_MAX_FILE_NAME_LENGTH = 255
_TITLE_SEP = " — "


def customer_invoice_asset_title(invoice: CustomerInvoice) -> str:
    """Build a searchable asset title from invoice number and bill-to name."""
    number = (invoice.invoice_number or "").strip() or "Invoice"
    client = (invoice.bill_to_display_name or "").strip()
    title = f"{number}{_TITLE_SEP}{client}" if client else number
    return title[:_MAX_TITLE_LENGTH]


def customer_invoice_asset_file_name(invoice: CustomerInvoice) -> str:
    """Build a PDF file name from the invoice number."""
    number = (invoice.invoice_number or "").strip() or "invoice"
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in number)
    safe = safe.strip("-_") or "invoice"
    return f"{safe}.pdf"[:_MAX_FILE_NAME_LENGTH]


def customer_invoice_tag_id(session: Session) -> UUID | None:
    """Resolve the customer_invoice tag id, if present."""
    stmt = select(Tag.id).where(
        func.lower(Tag.name) == CUSTOMER_INVOICE_TAG_NAME.lower()
    )
    return session.execute(stmt).scalar_one_or_none()


def ensure_customer_invoice_tag_id(session: Session) -> UUID:
    """Return the customer_invoice tag id, creating the reserved tag when missing."""
    existing = customer_invoice_tag_id(session)
    if existing is not None:
        return existing
    tag = Tag(name=CUSTOMER_INVOICE_TAG_NAME, created_by=_INVOICE_ASSET_ACTOR)
    session.add(tag)
    session.flush()
    return tag.id


def _link_customer_invoice_tag(session: Session, asset_id: UUID) -> None:
    tag_id = ensure_customer_invoice_tag_id(session)
    session.execute(
        pg_insert(AssetTag)
        .values(asset_id=asset_id, tag_id=tag_id)
        .on_conflict_do_nothing()
    )


def ensure_customer_invoice_asset(
    session: Session, invoice: CustomerInvoice
) -> Asset | None:
    """Create or update the restricted asset that surfaces an issued invoice PDF."""
    s3_key = (invoice.issued_pdf_s3_key or "").strip()
    if not s3_key:
        return None

    repository = AssetRepository(session)
    title = customer_invoice_asset_title(invoice)
    file_name = customer_invoice_asset_file_name(invoice)

    asset: Asset | None = None
    if invoice.asset_id is not None:
        asset = repository.get_by_id(invoice.asset_id)

    if asset is None:
        asset = repository.find_by_s3_key(s3_key)

    if asset is None:
        asset_id = uuid4()
        asset = repository.create_asset(
            asset_id=asset_id,
            title=title,
            description="Customer invoice",
            asset_type=AssetType.DOCUMENT,
            s3_key=s3_key,
            file_name=file_name,
            resource_key=None,
            content_type="application/pdf",
            content_language=None,
            visibility=AssetVisibility.RESTRICTED,
            created_by=_INVOICE_ASSET_ACTOR,
        )
    else:
        repository.update_asset(
            asset,
            title=title,
            file_name=file_name,
            content_type="application/pdf",
            visibility=AssetVisibility.RESTRICTED,
            s3_key=s3_key,
        )

    invoice.asset_id = asset.id
    _link_customer_invoice_tag(session, asset.id)
    session.flush()
    return asset
