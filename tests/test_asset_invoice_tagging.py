from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

from app.db.models import AssetType, AssetVisibility
from app.services.asset_invoice_tagging import (
    CUSTOMER_INVOICE_TAG_NAME,
    customer_invoice_asset_file_name,
    customer_invoice_asset_title,
    ensure_customer_invoice_asset,
)


def test_customer_invoice_tag_name_constant() -> None:
    assert CUSTOMER_INVOICE_TAG_NAME == "customer_invoice"


def test_invoice_asset_title_includes_client() -> None:
    invoice = SimpleNamespace(
        invoice_number="INV-2026-000001",
        bill_to_display_name="  Acme Family  ",
    )
    assert customer_invoice_asset_title(invoice) == "INV-2026-000001 — Acme Family"


def test_invoice_asset_title_falls_back_without_client() -> None:
    invoice = SimpleNamespace(invoice_number="INV-1", bill_to_display_name=None)
    assert customer_invoice_asset_title(invoice) == "INV-1"


def test_invoice_asset_file_name_sanitizes_number() -> None:
    invoice = SimpleNamespace(invoice_number="INV 2026/000001")
    assert customer_invoice_asset_file_name(invoice) == "INV-2026-000001.pdf"


def test_ensure_customer_invoice_asset_skips_without_pdf() -> None:
    session = MagicMock()
    invoice = SimpleNamespace(issued_pdf_s3_key="  ", asset_id=None)
    assert ensure_customer_invoice_asset(session, invoice) is None


def test_ensure_customer_invoice_asset_creates_restricted_row(
    monkeypatch: object,
) -> None:
    from app.services import asset_invoice_tagging as tagging

    session = MagicMock()
    created_asset = SimpleNamespace(id=uuid4())
    repo = MagicMock()
    repo.get_by_id.return_value = None
    repo.find_by_s3_key.return_value = None
    repo.create_asset.return_value = created_asset
    monkeypatch.setattr(tagging, "AssetRepository", lambda _session: repo)
    monkeypatch.setattr(tagging, "ensure_customer_invoice_tag_id", lambda _s: uuid4())

    invoice_id = uuid4()
    invoice = SimpleNamespace(
        id=invoice_id,
        invoice_number="INV-2026-000002",
        bill_to_display_name="Jordan Client",
        issued_pdf_s3_key=f"billing/invoices/{invoice_id}.pdf",
        asset_id=None,
    )

    result = ensure_customer_invoice_asset(session, invoice)

    assert result is created_asset
    assert invoice.asset_id == created_asset.id
    repo.create_asset.assert_called_once()
    kwargs = repo.create_asset.call_args.kwargs
    assert kwargs["title"] == "INV-2026-000002 — Jordan Client"
    assert kwargs["file_name"] == "INV-2026-000002.pdf"
    assert kwargs["s3_key"] == f"billing/invoices/{invoice_id}.pdf"
    assert kwargs["visibility"] == AssetVisibility.RESTRICTED
    assert kwargs["asset_type"] == AssetType.DOCUMENT
    assert kwargs["content_type"] == "application/pdf"


def test_ensure_customer_invoice_asset_updates_existing(
    monkeypatch: object,
) -> None:
    from app.services import asset_invoice_tagging as tagging

    session = MagicMock()
    asset_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    existing = SimpleNamespace(id=asset_id)
    repo = MagicMock()
    repo.get_by_id.return_value = existing
    repo.update_asset.return_value = existing
    monkeypatch.setattr(tagging, "AssetRepository", lambda _session: repo)
    monkeypatch.setattr(tagging, "ensure_customer_invoice_tag_id", lambda _s: uuid4())

    invoice = SimpleNamespace(
        id=uuid4(),
        invoice_number="INV-2026-000003",
        bill_to_display_name="Pat Lee",
        issued_pdf_s3_key="billing/invoices/existing.pdf",
        asset_id=asset_id,
    )

    result = ensure_customer_invoice_asset(session, invoice)

    assert result is existing
    repo.update_asset.assert_called_once()
    kwargs = repo.update_asset.call_args.kwargs
    assert kwargs["title"] == "INV-2026-000003 — Pat Lee"
    assert kwargs["visibility"] == AssetVisibility.RESTRICTED
    assert kwargs["s3_key"] == "billing/invoices/existing.pdf"
    repo.create_asset.assert_not_called()
