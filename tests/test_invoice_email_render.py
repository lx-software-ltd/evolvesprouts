from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.templates.booking_confirmation_render import substitute_shell_placeholders
from app.templates.invoice_email_content import format_invoice_email_date
from app.templates.invoice_email_render import (
    invoice_email_template_merge_data,
    render_invoice_email,
)


def _render(**overrides: object) -> tuple[str, str, str]:
    kwargs: dict[str, object] = {
        "locale": "en",
        "bill_to_name": "Ada Lovelace",
        "invoice_number": "INV-2026-0001",
        "invoice_date": date(2026, 9, 1),
        "due_date": date(2026, 9, 8),
        "total": Decimal("1500.00"),
        "balance_due": Decimal("400.00"),
        "currency": "HKD",
        "is_paid": False,
        "whatsapp_url": "https://wa.me/85212345678",
        "faq_url": "https://example.com/en/contact-us#contact-us-faq",
    }
    kwargs.update(overrides)
    return render_invoice_email(**kwargs)  # type: ignore[arg-type]


def test_format_invoice_email_date_en_and_zh() -> None:
    value = date(2026, 9, 1)
    assert format_invoice_email_date(value=value, locale="en") == "1 September 2026"
    assert format_invoice_email_date(value=value, locale="zh-HK") == "2026年9月1日"
    assert format_invoice_email_date(value=None, locale="en") == ""


def test_render_invoice_email_en_includes_branded_shell_and_summary() -> None:
    subject, html_doc, plain = _render()
    assert subject == "Invoice INV-2026-0001 — Evolve Sprouts"
    assert "YOUR INVOICE IS READY!" in html_doc
    assert "Hi Ada Lovelace," in html_doc
    assert "HK$1,500.00" in html_doc
    assert "Balance due" in html_doc
    assert "HK$400.00" in html_doc
    assert "8 September 2026" in html_doc
    assert "A PDF of this invoice is attached." in html_doc
    assert "{{logo_url}}" in html_doc
    assert "{{{footer_block_html}}}" in html_doc
    assert "Please find invoice INV-2026-0001 attached as a PDF." in plain
    assert "Balance due: HK$400.00" in plain
    assert "https://wa.me/85212345678" in plain


def test_render_invoice_email_falls_back_when_name_missing() -> None:
    subject, html_doc, plain = _render(bill_to_name="  ")
    assert "Hi there," in html_doc
    assert "Hi there," in plain
    assert subject.startswith("Invoice ")


def test_render_invoice_email_zero_total_note() -> None:
    _subject, html_doc, plain = _render(
        total=Decimal("0"),
        balance_due=Decimal("0"),
    )
    assert "Nothing to pay, thank you!" in html_doc
    assert "Nothing to pay, thank you!" in plain
    assert "Balance due" not in html_doc


def test_render_invoice_email_paid_note() -> None:
    _subject, html_doc, plain = _render(is_paid=True, balance_due=Decimal("0"))
    assert "This invoice is marked as paid." in html_doc
    assert "This invoice is marked as paid." in plain


def test_render_invoice_email_zh_cn_greeting() -> None:
    subject, html_doc, plain = _render(locale="zh-CN")
    assert subject.startswith("发票 INV-2026-0001")
    assert "您好 Ada Lovelace，" in html_doc
    assert "发票编号" in html_doc
    assert "您好 Ada Lovelace，" in plain


def test_substitute_shell_placeholders_fills_invoice_shell() -> None:
    _subject, html_doc, _plain = _render()
    out = substitute_shell_placeholders(
        html_doc,
        {
            "logo_url": "https://example.com/logo.png",
            "site_home_url": "https://example.com",
            "faq_url": "https://example.com/faq",
            "footer_block_html": "<p>Thank you</p>",
        },
    )
    assert "https://example.com/logo.png" in out
    assert "<p>Thank you</p>" in out
    assert "{{logo_url}}" not in out


def test_invoice_email_template_merge_data_flags() -> None:
    data = invoice_email_template_merge_data(
        locale="en",
        bill_to_name="",
        invoice_number="INV-1",
        invoice_date=date(2026, 1, 2),
        due_date=None,
        total=Decimal("0"),
        balance_due=Decimal("0"),
        currency="HKD",
        is_paid=True,
        whatsapp_url="https://wa.me/1",
    )
    assert data["bill_to_name"] == "there"
    assert data["is_zero_total"] is True
    assert data["show_balance_due"] is False
    assert data["is_paid"] is True
    assert data["due_date_display"] == ""
    assert data["invoice_date_display"] == "2 January 2026"
