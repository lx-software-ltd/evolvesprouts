"""Shared copy for customer invoice email (SES catalog + MIME send path)."""

from __future__ import annotations

from datetime import date
from typing import Final

INVOICE_EMAIL_LOCALES: Final[tuple[str, ...]] = ("en", "zh-CN", "zh-HK")
DEFAULT_INVOICE_EMAIL_LOCALE: Final[str] = "en"

SUBJECT_PREFIX: dict[str, str] = {
    "en": "Invoice ",
    "zh-CN": "发票 ",
    "zh-HK": "發票 ",
}
SUBJECT_SUFFIX: Final[str] = " — Evolve Sprouts"

HEADER_TITLE: dict[str, str] = {
    "en": "YOUR INVOICE IS READY!",
    "zh-CN": "您的发票已就绪",
    "zh-HK": "您的發票已就緒",
}

GREETING_FALLBACK_NAME: dict[str, str] = {
    "en": "there",
    "zh-CN": "",
    "zh-HK": "",
}

LEAD_HTML: dict[str, str] = {
    "en": (
        '<p style="margin:0 0 16px;">Thank you. Please find invoice '
        "<strong>{{invoice_number}}</strong> attached as a PDF.</p>"
    ),
    "zh-CN": (
        '<p style="margin:0 0 16px;">感谢您。发票 '
        "<strong>{{invoice_number}}</strong> 的 PDF 已附上。</p>"
    ),
    "zh-HK": (
        '<p style="margin:0 0 16px;">感謝您。發票 '
        "<strong>{{invoice_number}}</strong> 的 PDF 已附上。</p>"
    ),
}

LEAD_PLAIN_TEMPLATE: dict[str, str] = {
    "en": "Thank you. Please find invoice {invoice_number} attached as a PDF.",
    "zh-CN": "感谢您。发票 {invoice_number} 的 PDF 已附上。",
    "zh-HK": "感謝您。發票 {invoice_number} 的 PDF 已附上。",
}

TABLE_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "number": "Invoice number",
        "invoice_date": "Invoice date",
        "due_date": "Due date",
        "total": "Total",
        "balance_due": "Balance due",
    },
    "zh-CN": {
        "number": "发票编号",
        "invoice_date": "发票日期",
        "due_date": "到期日",
        "total": "总额",
        "balance_due": "应付余额",
    },
    "zh-HK": {
        "number": "發票編號",
        "invoice_date": "發票日期",
        "due_date": "到期日",
        "total": "總額",
        "balance_due": "應付餘額",
    },
}

ATTACHMENT_NOTE: dict[str, str] = {
    "en": "A PDF of this invoice is attached.",
    "zh-CN": "本邮件已附上发票 PDF。",
    "zh-HK": "本郵件已附上發票 PDF。",
}

ZERO_TOTAL_NOTE: dict[str, str] = {
    "en": "Nothing to pay, thank you!",
    "zh-CN": "无需付款，谢谢！",
    "zh-HK": "無需付款，謝謝！",
}

PAID_NOTE: dict[str, str] = {
    "en": "This invoice is marked as paid.",
    "zh-CN": "此发票已标记为已付款。",
    "zh-HK": "此發票已標記為已付款。",
}

CLOSING_NOTE: dict[str, str] = {
    "en": (
        "If you have already paid, you can ignore this note. "
        "Otherwise, payment details are on the attached invoice."
    ),
    "zh-CN": "若您已付款，可忽略此说明。付款方式见所附发票。",
    "zh-HK": "若您已付款，可忽略此說明。付款方式見所附發票。",
}

_MONTH_NAMES_EN: Final[tuple[str, ...]] = (
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def normalize_invoice_email_locale(locale: str | None) -> str:
    raw = (locale or "").strip()
    if raw in INVOICE_EMAIL_LOCALES:
        return raw
    return DEFAULT_INVOICE_EMAIL_LOCALE


def format_invoice_email_date(*, value: date | None, locale: str) -> str:
    """Locale-aware display date for invoice/due dates (calendar date, no time)."""
    if value is None:
        return ""
    loc = normalize_invoice_email_locale(locale)
    if loc == "en":
        return f"{value.day} {_MONTH_NAMES_EN[value.month]} {value.year}"
    return f"{value.year}年{value.month}月{value.day}日"
