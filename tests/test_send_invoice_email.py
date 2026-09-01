from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services import customer_billing


def _invoice(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = {
        "id": uuid4(),
        "invoice_number": "INV-2026-0001",
        "issued_pdf_s3_key": "billing/invoices/inv.pdf",
        "bill_to_display_name": "Ada Lovelace",
        "invoice_date": date(2026, 9, 1),
        "due_date": date(2026, 9, 8),
        "total": Decimal("1500.00"),
        "balance_due": Decimal("1500.00"),
        "currency": "HKD",
        "paid_at": None,
        "email_sent_at": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_send_invoice_email_skips_when_invoice_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = MagicMock()
    session.get.return_value = None
    sent: list[object] = []
    monkeypatch.setattr(
        customer_billing, "send_mime_email_with_optional_attachments", sent.append
    )
    customer_billing.send_invoice_email(
        session, invoice_id=uuid4(), to_addresses=["a@example.com"]
    )
    assert sent == []


def test_send_invoice_email_skips_when_issued_pdf_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = MagicMock()
    session.get.return_value = _invoice(issued_pdf_s3_key="")
    sent: list[object] = []
    monkeypatch.setattr(
        customer_billing, "send_mime_email_with_optional_attachments", sent.append
    )
    customer_billing.send_invoice_email(
        session, invoice_id=uuid4(), to_addresses=["a@example.com"]
    )
    assert sent == []


def test_send_invoice_email_sends_branded_mime_with_pdf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inv = _invoice()
    session = MagicMock()
    session.get.return_value = inv
    captured: dict[str, object] = {}

    class _Body:
        def read(self) -> bytes:
            return b"%PDF-1.4 invoice"

    s3 = MagicMock()
    s3.get_object.return_value = {"Body": _Body()}
    monkeypatch.setattr(customer_billing, "get_s3_client", lambda: s3)
    monkeypatch.setenv("ASSETS_BUCKET_NAME", "assets-bucket")
    monkeypatch.setenv("CONFIRMATION_EMAIL_FROM_ADDRESS", "hello@example.com")
    monkeypatch.setenv("PUBLIC_WWW_BASE_URL", "https://example.com")
    monkeypatch.setenv("PUBLIC_WWW_BUSINESS_PHONE_NUMBER", "85212345678")

    def _fake_send(**kwargs: object) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(
        customer_billing, "send_mime_email_with_optional_attachments", _fake_send
    )

    customer_billing.send_invoice_email(
        session, invoice_id=inv.id, to_addresses=["billing@example.com"]
    )

    assert captured["source"] == "hello@example.com"
    assert captured["to_addresses"] == ["billing@example.com"]
    assert captured["subject"] == "Invoice INV-2026-0001 — Evolve Sprouts"
    body_html = str(captured["body_html"])
    body_text = str(captured["body_text"])
    assert "YOUR INVOICE IS READY!" in body_html
    assert "Hi Ada Lovelace," in body_html
    assert "HK$1,500.00" in body_html
    assert "Please find invoice INV-2026-0001 attached as a PDF." in body_text
    attachments = captured["attachments"]
    assert attachments == [
        ("invoice-INV-2026-0001.pdf", "application/pdf", b"%PDF-1.4 invoice")
    ]
    assert isinstance(inv.email_sent_at, datetime)
    assert inv.email_sent_at.tzinfo == UTC
    session.flush.assert_called_once()
    s3.get_object.assert_called_once_with(
        Bucket="assets-bucket", Key="billing/invoices/inv.pdf"
    )
