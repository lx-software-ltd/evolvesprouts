from __future__ import annotations

from app.templates.ses.invoice_email import get_ses_template_definitions


def test_invoice_ses_templates_preserve_handlebars_placeholders() -> None:
    definitions = get_ses_template_definitions()
    assert len(definitions) == 3
    names = {t["TemplateName"] for t in definitions}
    assert names == {
        "evolvesprouts-invoice-en",
        "evolvesprouts-invoice-zh-CN",
        "evolvesprouts-invoice-zh-HK",
    }
    en = next(t for t in definitions if t["TemplateName"].endswith("-en"))
    assert "{{invoice_number}}" in en["SubjectPart"]
    assert "YOUR INVOICE IS READY!" in en["HtmlPart"]
    assert "{{bill_to_name}}" in en["HtmlPart"]
    assert "{{invoice_number}}" in en["HtmlPart"]
    assert "{{invoice_date_display}}" in en["HtmlPart"]
    assert "{{due_date_display}}" in en["HtmlPart"]
    assert "{{total_display}}" in en["HtmlPart"]
    assert "{{#if show_balance_due}}" in en["HtmlPart"]
    assert "{{#if is_zero_total}}" in en["HtmlPart"]
    assert "{{#if is_paid}}" in en["HtmlPart"]
    assert "{{whatsapp_url}}" in en["HtmlPart"]
    assert "{{faq_url}}" in en["HtmlPart"]
    assert "{{{{" not in en["HtmlPart"]
    assert "{{invoice_number}}" in en["TextPart"]
    assert "{{whatsapp_url}}" in en["TextPart"]
    assert "A PDF of this invoice is attached." in en["HtmlPart"]
    assert "A PDF of this invoice is attached." in en["TextPart"]
