"""SES templates: issued invoice email (per locale)."""

from __future__ import annotations

from typing import Any

from app.templates.booking_confirmation_content import (
    FAQ_LINK_LABEL,
    QUESTIONS_LINE_HTML_MIDDLE,
    QUESTIONS_LINE_HTML_PREFIX,
    QUESTIONS_LINE_HTML_SUFFIX,
    QUESTIONS_LINE_TEXT_SES,
    SIGN_OFF_PLAIN,
    WHATSAPP_LINK_LABEL,
)
from app.templates.invoice_email_content import (
    ATTACHMENT_NOTE,
    CLOSING_NOTE,
    HEADER_TITLE,
    INVOICE_EMAIL_LOCALES,
    LEAD_HTML,
    LEAD_PLAIN_TEMPLATE,
    PAID_NOTE,
    SUBJECT_PREFIX,
    SUBJECT_SUFFIX,
    TABLE_LABELS,
    ZERO_TOTAL_NOTE,
)
from app.templates.ses.email_shell import wrap_transactional_html

_CTA_LINK = "color:#C84A16;font-weight:600;"
_BORDER = "border-bottom:1px solid #eeeeee;"


def _greeting_html(loc: str) -> str:
    if loc == "en":
        return '<p style="margin:0 0 12px;">Hi {{bill_to_name}},</p>'
    return '<p style="margin:0 0 12px;">您好 {{bill_to_name}}，</p>'


def _greeting_plain(loc: str) -> str:
    if loc == "en":
        return "Hi {{bill_to_name}},\n\n"
    return "您好 {{bill_to_name}}，\n\n"


def _row(label: str, value_handlebars: str, *, bordered: bool) -> str:
    border = _BORDER if bordered else ""
    return (
        f'<tr><td style="padding:8px 0;{border}"><strong>{label}</strong></td>'
        f'<td style="padding:8px 0;{border}text-align:right;">'
        f"{value_handlebars}</td></tr>"
    )


def _inner_html_and_text_for_locale(loc: str) -> tuple[str, str]:
    labels = TABLE_LABELS[loc]
    questions_html = (
        f'<p style="margin:0;">{QUESTIONS_LINE_HTML_PREFIX[loc]}'
        f'<a href="{{{{whatsapp_url}}}}" style="{_CTA_LINK}">'
        f"{WHATSAPP_LINK_LABEL[loc]}</a>"
        f"{QUESTIONS_LINE_HTML_MIDDLE[loc]}"
        f'<a href="{{{{faq_url}}}}" style="{_CTA_LINK}">'
        f"{FAQ_LINK_LABEL[loc]}</a>"
        f"{QUESTIONS_LINE_HTML_SUFFIX[loc]}</p>"
    )
    row_number = _row(labels["number"], "{{invoice_number}}", bordered=True)
    row_invoice_date = (
        "{{#if invoice_date_display}}"
        + _row(labels["invoice_date"], "{{invoice_date_display}}", bordered=True)
        + "{{/if}}"
    )
    row_due_date = (
        "{{#if due_date_display}}"
        + _row(labels["due_date"], "{{due_date_display}}", bordered=True)
        + "{{/if}}"
    )
    row_total_mid = _row(labels["total"], "{{total_display}}", bordered=True)
    row_total_final = _row(labels["total"], "{{total_display}}", bordered=False)
    row_balance = _row(labels["balance_due"], "{{balance_due_display}}", bordered=False)
    zero_note = (
        "{{#if is_zero_total}}"
        '<p style="margin:0 0 16px;padding:12px;background:#f3f8f2;'
        'border-radius:8px;color:#2C6C25;font-weight:600;">'
        f"{ZERO_TOTAL_NOTE[loc]}</p>"
        "{{/if}}"
    )
    paid_note = (
        "{{#if is_paid}}" f'<p style="margin:0 0 16px;">{PAID_NOTE[loc]}</p>' "{{/if}}"
    )
    inner_html = (
        _greeting_html(loc)
        + LEAD_HTML[loc]
        + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="border-collapse:collapse;margin:0 0 16px;">'
        + row_number
        + row_invoice_date
        + row_due_date
        + "{{#if show_balance_due}}"
        + row_total_mid
        + row_balance
        + "{{else}}"
        + row_total_final
        + "{{/if}}"
        + "</table>"
        + zero_note
        + paid_note
        + f'<p style="margin:0 0 16px;">{ATTACHMENT_NOTE[loc]}</p>'
        + '<hr style="border:0;border-top:1px solid #eeeeee;margin:0 0 16px;"/>'
        + f'<p style="margin:0 0 16px;">{CLOSING_NOTE[loc]}</p>'
        + questions_html
    )

    label_sep = ": " if loc == "en" else "："
    text_part = (
        _greeting_plain(loc)
        + LEAD_PLAIN_TEMPLATE[loc].replace("{invoice_number}", "{{invoice_number}}")
        + "\n\n"
        + f"{labels['number']}{label_sep}{{{{invoice_number}}}}\n"
        + "{{#if invoice_date_display}}"
        + f"{labels['invoice_date']}{label_sep}{{{{invoice_date_display}}}}\n"
        + "{{/if}}"
        + "{{#if due_date_display}}"
        + f"{labels['due_date']}{label_sep}{{{{due_date_display}}}}\n"
        + "{{/if}}"
        + f"{labels['total']}{label_sep}{{{{total_display}}}}\n"
        + "{{#if show_balance_due}}"
        + f"{labels['balance_due']}{label_sep}{{{{balance_due_display}}}}\n"
        + "{{/if}}"
        + "\n"
        + "{{#if is_zero_total}}"
        + f"{ZERO_TOTAL_NOTE[loc]}\n\n"
        + "{{/if}}"
        + "{{#if is_paid}}"
        + f"{PAID_NOTE[loc]}\n\n"
        + "{{/if}}"
        + f"{ATTACHMENT_NOTE[loc]}\n\n"
        + f"{CLOSING_NOTE[loc]}\n\n"
        + QUESTIONS_LINE_TEXT_SES[loc]
        + "\n\n"
        + SIGN_OFF_PLAIN[loc]
    )
    return inner_html, text_part


def get_ses_template_definitions() -> list[dict[str, Any]]:
    """Return SES CreateTemplate payloads (Template key for boto3)."""
    definitions: list[dict[str, Any]] = []
    for loc in INVOICE_EMAIL_LOCALES:
        inner_html, text_part = _inner_html_and_text_for_locale(loc)
        definitions.append(
            {
                "TemplateName": f"evolvesprouts-invoice-{loc}",
                "SubjectPart": SUBJECT_PREFIX[loc]
                + "{{invoice_number}}"
                + SUBJECT_SUFFIX,
                "HtmlPart": wrap_transactional_html(
                    header_title=HEADER_TITLE[loc],
                    inner_html=inner_html,
                ),
                "TextPart": text_part,
            }
        )
    return definitions
