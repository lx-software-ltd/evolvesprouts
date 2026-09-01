"""Render customer invoice email bodies (MIME path with PDF attachment)."""

from __future__ import annotations

import html
from datetime import date
from decimal import Decimal
from typing import Any

from app.services.customer_invoice_pdf import format_money
from app.templates.booking_confirmation_content import (
    FAQ_LINK_LABEL,
    QUESTIONS_LINE_HTML_MIDDLE,
    QUESTIONS_LINE_HTML_PREFIX,
    QUESTIONS_LINE_HTML_SUFFIX,
    QUESTIONS_LINE_PLAIN,
    SIGN_OFF_PLAIN,
    WHATSAPP_LINK_LABEL,
)
from app.templates.invoice_email_content import (
    ATTACHMENT_NOTE,
    CLOSING_NOTE,
    GREETING_FALLBACK_NAME,
    HEADER_TITLE,
    LEAD_PLAIN_TEMPLATE,
    PAID_NOTE,
    SUBJECT_PREFIX,
    SUBJECT_SUFFIX,
    TABLE_LABELS,
    ZERO_TOTAL_NOTE,
    format_invoice_email_date,
    normalize_invoice_email_locale,
)
from app.templates.ses.email_shell import wrap_transactional_html

_CTA_LINK = "color:#C84A16;font-weight:600;"
_BORDER = "border-bottom:1px solid #eeeeee;"


def _display_name(bill_to_name: str, loc: str) -> str:
    trimmed = bill_to_name.strip()
    if trimmed:
        return trimmed
    return GREETING_FALLBACK_NAME[loc]


def _greeting_html(name: str, loc: str) -> str:
    esc = html.escape(name) if name else ""
    if loc == "en":
        return f'<p style="margin:0 0 12px;">Hi {esc},</p>'
    if esc:
        return f'<p style="margin:0 0 12px;">您好 {esc}，</p>'
    return '<p style="margin:0 0 12px;">您好，</p>'


def _greeting_plain(name: str, loc: str) -> str:
    if loc == "en":
        return f"Hi {name},\n\n"
    if name:
        return f"您好 {name}，\n\n"
    return "您好，\n\n"


def _html_row(*, label: str, value_html: str, bordered: bool) -> str:
    border = _BORDER if bordered else ""
    return (
        f'<tr><td style="padding:8px 0;{border}"><strong>'
        f"{html.escape(label)}</strong></td>"
        f'<td style="padding:8px 0;{border}text-align:right;">{value_html}</td></tr>'
    )


def _questions_html(loc: str, *, whatsapp_url: str, faq_url: str) -> str:
    if not faq_url.strip() and not whatsapp_url.strip():
        return ""
    esc_wa = html.escape(whatsapp_url.strip(), quote=True)
    esc_faq = html.escape(faq_url.strip(), quote=True)
    return (
        f'<p style="margin:0;">{QUESTIONS_LINE_HTML_PREFIX[loc]}'
        f'<a href="{esc_wa}" style="{_CTA_LINK}">{WHATSAPP_LINK_LABEL[loc]}</a>'
        f"{QUESTIONS_LINE_HTML_MIDDLE[loc]}"
        f'<a href="{esc_faq}" style="{_CTA_LINK}">{FAQ_LINK_LABEL[loc]}</a>'
        f"{QUESTIONS_LINE_HTML_SUFFIX[loc]}</p>"
    )


def _questions_plain(loc: str, *, whatsapp_url: str, faq_url: str) -> str:
    if not faq_url.strip() and not whatsapp_url.strip():
        return ""
    return QUESTIONS_LINE_PLAIN[loc].format(
        whatsapp_url=whatsapp_url.strip(),
        faq_url=faq_url.strip(),
    )


def _lead_html(*, loc: str, invoice_number: str) -> str:
    esc_num = html.escape(invoice_number)
    if loc == "en":
        return (
            '<p style="margin:0 0 16px;">Thank you. Please find invoice '
            f"<strong>{esc_num}</strong> attached as a PDF.</p>"
        )
    if loc == "zh-CN":
        return (
            '<p style="margin:0 0 16px;">感谢您。发票 '
            f"<strong>{esc_num}</strong> 的 PDF 已附上。</p>"
        )
    return (
        '<p style="margin:0 0 16px;">感謝您。發票 '
        f"<strong>{esc_num}</strong> 的 PDF 已附上。</p>"
    )


def render_invoice_email(
    *,
    locale: str,
    bill_to_name: str,
    invoice_number: str,
    invoice_date: date | None,
    due_date: date | None,
    total: Decimal,
    balance_due: Decimal,
    currency: str,
    is_paid: bool,
    whatsapp_url: str,
    faq_url: str,
) -> tuple[str, str, str]:
    """Return (subject, full_html with shell placeholders, plain_text)."""
    loc = normalize_invoice_email_locale(locale)
    labels = TABLE_LABELS[loc]
    name = _display_name(bill_to_name, loc)
    number = invoice_number.strip()
    total_display = format_money(total, currency)
    balance_display = format_money(balance_due, currency)
    invoice_date_display = format_invoice_email_date(value=invoice_date, locale=loc)
    due_date_display = format_invoice_email_date(value=due_date, locale=loc)
    is_zero_total = total <= Decimal("0")
    show_balance_due = balance_due > Decimal("0")

    rows: list[str] = [
        _html_row(
            label=labels["number"],
            value_html=html.escape(number),
            bordered=True,
        )
    ]
    if invoice_date_display:
        rows.append(
            _html_row(
                label=labels["invoice_date"],
                value_html=html.escape(invoice_date_display),
                bordered=True,
            )
        )
    if due_date_display:
        rows.append(
            _html_row(
                label=labels["due_date"],
                value_html=html.escape(due_date_display),
                bordered=True,
            )
        )
    if show_balance_due:
        rows.append(
            _html_row(
                label=labels["total"],
                value_html=html.escape(total_display),
                bordered=True,
            )
        )
        rows.append(
            _html_row(
                label=labels["balance_due"],
                value_html=html.escape(balance_display),
                bordered=False,
            )
        )
    else:
        rows.append(
            _html_row(
                label=labels["total"],
                value_html=html.escape(total_display),
                bordered=False,
            )
        )

    extra_notes = ""
    if is_zero_total:
        extra_notes += (
            '<p style="margin:0 0 16px;padding:12px;background:#f3f8f2;'
            'border-radius:8px;color:#2C6C25;font-weight:600;">'
            f"{html.escape(ZERO_TOTAL_NOTE[loc])}</p>"
        )
    if is_paid:
        extra_notes += f'<p style="margin:0 0 16px;">{html.escape(PAID_NOTE[loc])}</p>'

    inner_html = (
        _greeting_html(name, loc)
        + _lead_html(loc=loc, invoice_number=number)
        + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="border-collapse:collapse;margin:0 0 16px;">'
        + "".join(rows)
        + "</table>"
        + extra_notes
        + f'<p style="margin:0 0 16px;">{html.escape(ATTACHMENT_NOTE[loc])}</p>'
        + '<hr style="border:0;border-top:1px solid #eeeeee;margin:0 0 16px;"/>'
        + f'<p style="margin:0 0 16px;">{html.escape(CLOSING_NOTE[loc])}</p>'
        + _questions_html(loc, whatsapp_url=whatsapp_url, faq_url=faq_url)
    )
    full_html = wrap_transactional_html(
        header_title=HEADER_TITLE[loc],
        inner_html=inner_html,
    )
    subject = f"{SUBJECT_PREFIX[loc]}{number}{SUBJECT_SUFFIX}"

    label_sep = ": " if loc == "en" else "："
    text_lines = [
        _greeting_plain(name, loc).rstrip("\n"),
        "",
        LEAD_PLAIN_TEMPLATE[loc].format(invoice_number=number),
        "",
        f"{labels['number']}{label_sep}{number}",
    ]
    if invoice_date_display:
        text_lines.append(f"{labels['invoice_date']}{label_sep}{invoice_date_display}")
    if due_date_display:
        text_lines.append(f"{labels['due_date']}{label_sep}{due_date_display}")
    text_lines.append(f"{labels['total']}{label_sep}{total_display}")
    if show_balance_due:
        text_lines.append(f"{labels['balance_due']}{label_sep}{balance_display}")
    text_lines.append("")
    if is_zero_total:
        text_lines.extend([ZERO_TOTAL_NOTE[loc], ""])
    if is_paid:
        text_lines.extend([PAID_NOTE[loc], ""])
    text_lines.extend(
        [
            ATTACHMENT_NOTE[loc],
            "",
            CLOSING_NOTE[loc],
            "",
        ]
    )
    questions = _questions_plain(loc, whatsapp_url=whatsapp_url, faq_url=faq_url)
    if questions:
        text_lines.extend([questions, ""])
    text_lines.append(SIGN_OFF_PLAIN[loc])
    return subject, full_html, "\n".join(text_lines)


def invoice_email_template_merge_data(
    *,
    locale: str,
    bill_to_name: str,
    invoice_number: str,
    invoice_date: date | None,
    due_date: date | None,
    total: Decimal,
    balance_due: Decimal,
    currency: str,
    is_paid: bool,
    whatsapp_url: str,
) -> dict[str, Any]:
    """Handlebars merge fields for the stored SES invoice templates."""
    loc = normalize_invoice_email_locale(locale)
    name = _display_name(bill_to_name, loc)
    number = invoice_number.strip()
    due_display = format_invoice_email_date(value=due_date, locale=loc)
    return {
        "bill_to_name": name,
        "invoice_number": number,
        "invoice_date_display": format_invoice_email_date(
            value=invoice_date, locale=loc
        ),
        "due_date_display": due_display,
        "total_display": format_money(total, currency),
        "balance_due_display": format_money(balance_due, currency),
        "show_balance_due": balance_due > Decimal("0"),
        "is_zero_total": total <= Decimal("0"),
        "is_paid": is_paid,
        "whatsapp_url": whatsapp_url.strip(),
    }
