"""Customer AR invoice PDF rendering (ReportLab platypus).

Invoice snapshot dates (``invoice_date``, ``due_date`` on ``CustomerInvoice``)
take precedence; previews compute dates when those columns are unset.

Environment:
- ``INVOICE_DISPLAY_TIMEZONE``: required for issued renders (non-preview); IANA id.
  Previews use UTC only (see ``render_invoice_pdf(..., preview=True)``).
- ``INVOICE_PAYMENT_TERMS_DAYS``: unset/empty defaults to 7; invalid values raise
  ``ValueError``.
- ``PUBLIC_WWW_BUSINESS_NAME``: trading name (From block).
- ``PUBLIC_WWW_BUSINESS_LEGAL_NAME``: optional legal entity name for footer.
- ``PUBLIC_WWW_BUSINESS_REGISTRATION``: BR / registration number for footer.
- ``PUBLIC_WWW_FPS_MERCHANT_NAME`` / ``PUBLIC_WWW_FPS_MOBILE_NUMBER``: optional FPS QR on
  invoices when ``total > 0`` and currency is HKD (same EMVCo payload as the public booking
  flow). Bank transfer lines and the FPS QR render on a dedicated **Payment Options** page
  after the main invoice page.
- When ``total == 0``, a centred **Nothing to pay, thank you!** line appears after the totals
  block (same cue band spacing as the refer-to-next-page line on payable invoices), with no
  second page.
- ``PUBLIC_WWW_BILLING_EMAIL``: optional billing email for payment confirmations (align GitHub
  ``NEXT_PUBLIC_BILLING_EMAIL`` with CDK ``PublicWwwBillingEmail``); used on the Payment Options page.

When ``CustomerInvoice.bill_to_location_text`` is set (CRM snapshot), the Bill To block
includes those lines after the display name. The email line is omitted when a location
snapshot is present so postal-style blocks stay uncluttered.

The Evolve Sprouts wordmark is embedded from ``app/assets/invoice/evolvesprouts-invoice-logo.png``
(raster export of the public-site SVG) so Lambda bundles match brand artwork without SVG
dependencies at runtime.

HKD amounts render with the ``HK$`` symbol (see architecture docs).

Footer jurisdiction copy ("Proudly registered in Hong Kong") is intentional product
copy for client invoices; exception documented in repository ``.cursorrules``.
"""

from __future__ import annotations

import html
import io
import os
import re
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from functools import partial
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config.public_www import get_public_www

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    Flowable,
    Image,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.enums import BillingBillToKind, BillingInvoiceStatus
from app.services.fps_qr_payload import build_fps_payload_detailed
from app.services.fps_qr_pdf_image import render_fps_qr_png
from app.utils.logging import get_logger

_SAMPLE_STYLES = getSampleStyleSheet()
logger = get_logger(__name__)


def _esc(text: str) -> str:
    """Escape for ReportLab Paragraph (HTML-like); avoids stdlib ``xml`` (Semgrep / XXE)."""
    return html.escape(text, quote=True)


_INVOICE_JURISDICTION_LINE = "Proudly registered in Hong Kong"

_INV_TEXT = colors.HexColor("#1c3542")
_INV_MUTED = colors.HexColor("#5a6b73")
_INV_GRID = colors.HexColor("#d4dce0")
_INV_TITLE = colors.HexColor("#2c3e50")
_INV_HEADER_FILL = colors.HexColor("#33495d")
_INV_HEADER_TEXT = colors.white
_INV_BODY_TEXT = colors.HexColor("#333333")
_INV_LABEL_TEXT = colors.HexColor("#555555")
_INV_PANEL_FILL = colors.HexColor("#f7f9fa")
_INV_RULE = colors.HexColor("#cfd6da")
_INV_DIVIDER = colors.HexColor("#1c2a36")
_INV_TOTAL_RULE = colors.HexColor("#33495d")
_INV_FOOTER_TEXT = colors.HexColor("#7f8c8d")
_INV_PAID_WATERMARK = colors.HexColor(
    "#c0392b"
)  # muted red, AA against white at large sizes
_INV_LOGO_PATH = (
    Path(__file__).resolve().parent.parent
    / "assets"
    / "invoice"
    / "evolvesprouts-invoice-logo.png"
)
_INV_FPS_LOGO_PATH = (
    Path(__file__).resolve().parent.parent / "assets" / "invoice" / "fps-logo.png"
)

# Source PNG has ~16.3% transparent padding on each side; render the box at
# 52mm so the visible content lands at ~35mm to match the reference template.
_INV_LOGO_BOX_MM = 52


class RoundedPanel(Flowable):
    """Fixed-size flowable that paints a rounded-corner background and renders an inner table on top."""

    def __init__(
        self,
        inner: Flowable,
        width: float,
        height: float,
        fill: colors.Color,
        radius: float = 4.0,
        valign: str = "middle",
        inset_top: float = 0.0,
    ) -> None:
        super().__init__()
        self._inner = inner
        self.width = width
        self.height = height
        self._fill = fill
        self._radius = radius
        self._valign = valign
        self._inset_top = inset_top

    def wrap(self, _aw: float, _ah: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        c = self.canv
        c.saveState()
        c.setFillColor(self._fill)
        c.setStrokeColor(self._fill)
        c.roundRect(
            0,
            0,
            self.width,
            self.height,
            self._radius,
            stroke=0,
            fill=1,
        )
        c.restoreState()
        _, inner_h = self._inner.wrap(self.width, self.height)
        if self._valign == "top":
            y_offset = max(0.0, self.height - inner_h - self._inset_top)
        else:
            y_offset = max(0.0, (self.height - inner_h) / 2.0)
        self._inner.drawOn(c, 0, y_offset)


class InvoicePdfCanvas(canvas.Canvas):
    """Defer ``showPage`` so each page can be finished with footer + ``current/total``."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._invoice_footer_text = str(kwargs.pop("footer_text", "") or "")
        self._invoice_paid_watermark = bool(kwargs.pop("paid_watermark", False))
        self._saved_page_states: list[dict[str, Any]] = []
        super().__init__(*args, **kwargs)

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        num_pages = len(self._saved_page_states)
        for idx, state in enumerate(self._saved_page_states, start=1):
            self.__dict__.update(state)
            self._draw_paid_watermark()
            self._draw_invoice_page_footer(idx, num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def _draw_paid_watermark(self) -> None:
        if not self._invoice_paid_watermark:
            return
        w, h = self._pagesize
        self.saveState()
        self.translate(w / 2.0, h / 2.0)
        self.rotate(30)
        self.setFillColor(_INV_PAID_WATERMARK)
        try:
            self.setFillAlpha(0.18)
        except AttributeError:
            pass
        self.setFont("Helvetica-Bold", 140)
        self.drawCentredString(0, -50, "PAID")
        self.restoreState()

    def _draw_invoice_page_footer(self, page_num: int, page_count: int) -> None:
        self.saveState()
        self.setFont("Helvetica", 7)
        self.setFillColor(_INV_FOOTER_TEXT)
        w, _h = self._pagesize
        margin_x = 10 * mm
        y_footer = 14 * mm
        ft = self._invoice_footer_text
        if ft:
            self.drawCentredString(w / 2.0, y_footer, ft)
        self.drawRightString(w - margin_x, y_footer, f"{page_num}/{page_count}")
        self.restoreState()


def _payment_confirmation_line_html(billing_email: str) -> str:
    """Single line of payment-confirmation copy (no leading space; use after ``<br/>``)."""
    e = (billing_email or "").strip()
    if e:
        return "Please send the payment confirmation to us by email at " + _esc(e) + "."
    return "Please send the payment confirmation to us by email."


def _invoice_logo_flowable() -> Image | Paragraph:
    if not _INV_LOGO_PATH.is_file():
        return Paragraph("", _SAMPLE_STYLES["Normal"])
    img = Image(
        str(_INV_LOGO_PATH),
        width=_INV_LOGO_BOX_MM * mm,
        height=_INV_LOGO_BOX_MM * mm,
        kind="proportional",
    )
    img.hAlign = "LEFT"
    return img


def _fps_logo_image(*, width_mm: float = 25, height_mm: float = 12) -> Image | None:
    """FPS brand mark to the left of the FPS QR in the payment section."""
    if not _INV_FPS_LOGO_PATH.is_file():
        return None
    img = Image(
        str(_INV_FPS_LOGO_PATH),
        width=width_mm * mm,
        height=height_mm * mm,
        kind="proportional",
    )
    img.hAlign = "LEFT"
    return img


def invoice_pdf_footer_text() -> str:
    """Footer from legal/trading name + registration (Option B includes HK jurisdiction when both)."""
    legal = (
        get_public_www("BUSINESS_LEGAL_NAME").strip()
        or get_public_www("BUSINESS_NAME").strip()
    )
    reg = get_public_www("BUSINESS_REGISTRATION").strip()
    if not legal and not reg:
        return ""
    if legal and not reg:
        return legal
    if reg and not legal:
        return f"BR: {reg}"
    return f"{legal} | {_INVOICE_JURISDICTION_LINE} | BR: {reg}"


def payment_terms_days_or_raise() -> int:
    raw = os.getenv("INVOICE_PAYMENT_TERMS_DAYS", "").strip()
    if raw == "":
        return 7
    if not raw.isdigit():
        raise ValueError("INVOICE_PAYMENT_TERMS_DAYS must be a non-negative integer")
    val = int(raw)
    if val > 999:
        raise ValueError("INVOICE_PAYMENT_TERMS_DAYS must be at most 999")
    return val


def add_payment_terms(inv_date: date) -> date:
    """Return ``inv_date + INVOICE_PAYMENT_TERMS_DAYS`` using the same env helper."""
    return inv_date + timedelta(days=payment_terms_days_or_raise())


def invoice_display_timezone_or_raise() -> ZoneInfo:
    """Timezone for issued invoice date math; required for issuance (non-preview)."""
    tz_name = os.getenv("INVOICE_DISPLAY_TIMEZONE", "").strip()
    if not tz_name:
        raise ValueError("INVOICE_DISPLAY_TIMEZONE is required for invoice issuance")
    try:
        return ZoneInfo(tz_name)
    except Exception as exc:
        raise ValueError(
            "INVOICE_DISPLAY_TIMEZONE is not a valid IANA timezone"
        ) from exc


def invoice_display_timezone_preview() -> ZoneInfo:
    """Previews use UTC when snapshot dates are computed on the fly."""
    return ZoneInfo("UTC")


def compute_invoice_snapshot_dates(issued_at: datetime) -> tuple[date, date]:
    """Compute persisted invoice_date and due_date at issue time from ``issued_at``."""
    tz = invoice_display_timezone_or_raise()
    inv_date = calendar_date_in_tz(issued_at, tz)
    due_date = add_payment_terms(inv_date)
    return inv_date, due_date


def today_in_invoice_display_tz_or_utc() -> date:
    """Calendar-today in INVOICE_DISPLAY_TIMEZONE; fall back to UTC if env var unset/invalid."""
    tz_name = os.getenv("INVOICE_DISPLAY_TIMEZONE", "").strip()
    if not tz_name:
        return datetime.now(UTC).date()
    try:
        return datetime.now(UTC).astimezone(ZoneInfo(tz_name)).date()
    except (ZoneInfoNotFoundError, OSError, ValueError, TypeError):
        return datetime.now(UTC).date()


def calendar_date_in_tz(dt: datetime | None, tz: ZoneInfo) -> date:
    if dt is None:
        return datetime.now(UTC).astimezone(tz).date()
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC).astimezone(tz).date()
    return dt.astimezone(tz).date()


def split_address_lines(raw: str) -> list[str]:
    text = (raw or "").strip()
    if not text:
        return []
    normalized = text.replace("\\n", "\n")
    parts = re.split(r"[\n\r]+", normalized)
    return [p.strip() for p in parts if p.strip()]


# Same spacing as ``family_or_organization_bill_to_display_label`` (entity · primary).
_FAMILY_BILL_TO_ENTITY_SEP = " \u00b7 "


def _family_bill_to_display_name_for_pdf(raw: str | None) -> str | None:
    """Family bill-to: prefer the primary-contact segment, not the family entity name."""
    text = (raw or "").strip()
    if not text:
        return None
    if _FAMILY_BILL_TO_ENTITY_SEP in text:
        parts = [p.strip() for p in text.split(_FAMILY_BILL_TO_ENTITY_SEP) if p.strip()]
        if len(parts) >= 2:
            tail = parts[-1].strip()
            return tail or None
    return text


def _log_fps_qr_skipped(
    *,
    invoice: CustomerInvoice,
    preview: bool,
    inv_currency: str,
    is_non_positive_total: bool,
    fps_merchant: str,
    fps_mobile: str,
    attempted_fps_build: bool,
    fps_payload: str | None,
    fps_rejection_code: str | None = None,
) -> None:
    """Emit a single structured warning when an FPS QR would not appear but ops might expect it."""
    if fps_payload is not None:
        return
    if is_non_positive_total:
        return
    extra: dict[str, object] = {
        "event": "fps_qr_skipped",
        "preview": preview,
        "currency": inv_currency,
        "total": str(invoice.total),
    }
    inv_id = getattr(invoice, "id", None)
    if inv_id is not None:
        extra["invoice_id"] = str(inv_id)
    inv_num = (invoice.invoice_number or "").strip()
    if inv_num:
        extra["invoice_number"] = inv_num

    if attempted_fps_build:
        extra["reason"] = "fps_payload_build_failed"
        extra["has_fps_merchant"] = True
        extra["has_fps_mobile"] = True
        if fps_rejection_code:
            extra["fps_rejection_code"] = fps_rejection_code
        logger.warning("FPS QR skipped", extra=extra)
        return

    if inv_currency != "HKD":
        if fps_merchant and fps_mobile:
            extra["reason"] = "non_hkd_currency"
            extra["has_fps_merchant"] = True
            extra["has_fps_mobile"] = True
            logger.warning("FPS QR skipped", extra=extra)
        return

    if not fps_merchant and not fps_mobile:
        extra["reason"] = "missing_fps_env"
        extra["detail"] = "missing_merchant_and_mobile"
    elif not fps_merchant:
        extra["reason"] = "missing_fps_env"
        extra["detail"] = "missing_merchant"
    else:
        extra["reason"] = "missing_fps_env"
        extra["detail"] = "missing_mobile"
    extra["has_fps_merchant"] = bool(fps_merchant)
    extra["has_fps_mobile"] = bool(fps_mobile)
    logger.warning("FPS QR skipped", extra=extra)


def format_money(amount: Decimal, currency: str) -> str:
    code = currency.upper()[:3]
    q = amount.quantize(Decimal("0.01"))
    symbol = {
        "USD": "$",
        "HKD": "HK$",
        "GBP": "£",
        "EUR": "€",
        "CNY": "¥",
    }.get(code)
    if symbol:
        return f"{symbol}{q:,.2f}"
    return f"{q:,.2f} {code}"


# Word-wrap at word boundaries into chunks of at most _MAX_DESC_CHUNK_CHARS;
# batched LongTable slices (SPAN for qty/unit/total) so page breaks can occur
# without repeating numbers on continuation rows.
_MAX_DESC_CHUNK_CHARS = 100
# Max body description rows per LongTable (plus optional header). Keep low so
# a slice still fits a partial page after header/footer/wrapped totals above.
_LINE_TABLE_BODY_ROWS_MAX = 8


def _description_row_strings(text: str) -> list[str]:
    """Split description into up-to-100-char chunks at word boundaries (no mid-word hard split)."""
    raw = text or ""
    if not raw.strip():
        return [raw]
    words: list[str] = []
    for token in raw.split():
        while len(token) > _MAX_DESC_CHUNK_CHARS:
            words.append(token[:_MAX_DESC_CHUNK_CHARS])
            token = token[_MAX_DESC_CHUNK_CHARS:]
        words.append(token)
    word_chunks: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for w in words:
        add_len = len(w) + (1 if cur else 0)
        if cur_len + add_len > _MAX_DESC_CHUNK_CHARS and cur:
            word_chunks.append(" ".join(cur))
            cur = [w]
            cur_len = len(w)
        else:
            cur.append(w)
            cur_len += add_len
    if cur:
        word_chunks.append(" ".join(cur))
    return word_chunks


def render_invoice_pdf(
    *,
    invoice: CustomerInvoice,
    lines: list[CustomerInvoiceLine],
    preview: bool = False,
) -> bytes:
    """Render AR invoice PDF. Use ``preview=True`` for draft/void preview uploads."""
    inv_currency = invoice.currency.strip().upper()
    if len(inv_currency) != 3:
        raise ValueError("invoice.currency must be a 3-letter ISO code")

    ordered = sorted(lines, key=lambda x: x.line_order)
    for line in ordered:
        lc = line.currency.strip().upper()
        if lc != inv_currency:
            raise ValueError("Invoice line currency must match invoice currency")

    terms_days = payment_terms_days_or_raise()

    if invoice.invoice_date is not None:
        inv_date = invoice.invoice_date
    else:
        if preview:
            tz = invoice_display_timezone_preview()
        else:
            tz = invoice_display_timezone_or_raise()
        ref_dt = invoice.issued_at
        if ref_dt is None and invoice.status == BillingInvoiceStatus.DRAFT:
            ref_dt = datetime.now(UTC)
        inv_date = calendar_date_in_tz(ref_dt, tz)

    if invoice.due_date is not None:
        due_date = invoice.due_date
    else:
        due_date = inv_date + timedelta(days=terms_days)

    buf = io.BytesIO()
    margin_x = 10 * mm
    margin_top = 10 * mm
    margin_bottom = 18 * mm
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=margin_x,
        rightMargin=margin_x,
        topMargin=margin_top,
        bottomMargin=margin_bottom,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "InvTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=20,
        textColor=_INV_TITLE,
        alignment=TA_RIGHT,
        spaceAfter=0,
    )
    label_heading_style = ParagraphStyle(
        "InvLabelHeading",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=16,
        textColor=_INV_LABEL_TEXT,
    )
    body_text_style = ParagraphStyle(
        "InvBodyText",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=16,
        textColor=_INV_BODY_TEXT,
    )
    header_label_style = ParagraphStyle(
        "InvHeaderLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=12,
        textColor=_INV_HEADER_TEXT,
    )
    totals_label_style = ParagraphStyle(
        "InvTotalsLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=12,
        textColor=_INV_LABEL_TEXT,
        alignment=TA_RIGHT,
    )
    totals_value_style = ParagraphStyle(
        "InvTotalsValue",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=12,
        textColor=_INV_BODY_TEXT,
        alignment=TA_RIGHT,
    )
    totals_total_style = ParagraphStyle(
        "InvTotalsTotal",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11.5,
        leading=14,
        textColor=_INV_BODY_TEXT,
        alignment=TA_RIGHT,
    )
    date_label_style = ParagraphStyle(
        "InvDateLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=16,
        textColor=_INV_LABEL_TEXT,
        alignment=TA_LEFT,
    )
    date_value_style = ParagraphStyle(
        "InvDateValue",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=16,
        textColor=_INV_BODY_TEXT,
        alignment=TA_RIGHT,
    )

    business_name = _esc(get_public_www("BUSINESS_NAME").strip())
    address_lines = [
        _esc(p) for p in split_address_lines(get_public_www("BUSINESS_ADDRESS"))
    ]
    bank_name = get_public_www("BANK_NAME").strip()
    bank_holder = get_public_www("BANK_ACCOUNT_HOLDER").strip()
    bank_number = get_public_www("BANK_ACCOUNT_NUMBER").strip()
    has_bank_block = bool(bank_name or bank_holder or bank_number)

    is_non_positive_total = invoice.total <= Decimal("0")
    is_zero_total = invoice.total == Decimal("0")
    show_due_date = not is_non_positive_total

    fps_merchant = get_public_www("FPS_MERCHANT_NAME").strip()
    fps_mobile = get_public_www("FPS_MOBILE_NUMBER").strip()
    fps_payload: str | None = None
    attempted_fps_build = (
        not is_non_positive_total
        and inv_currency == "HKD"
        and bool(fps_merchant)
        and bool(fps_mobile)
    )
    fps_rejection_code: str | None = None
    if attempted_fps_build:
        fps_payload, fps_rejection_code = build_fps_payload_detailed(
            fps_merchant,
            fps_mobile,
            invoice.total,
            currency=inv_currency,
        )
    _log_fps_qr_skipped(
        invoice=invoice,
        preview=preview,
        inv_currency=inv_currency,
        is_non_positive_total=is_non_positive_total,
        fps_merchant=fps_merchant,
        fps_mobile=fps_mobile,
        attempted_fps_build=attempted_fps_build,
        fps_payload=fps_payload,
        fps_rejection_code=fps_rejection_code,
    )

    inv_label = (invoice.invoice_number or "").strip()
    title_line = f"INVOICE {inv_label}" if inv_label else "INVOICE"

    # Hero row: logo box (52mm rendered → ~35mm visible after PNG transparent
    # padding) on the left, INVOICE title vertically centred on the right.
    hero_table = Table(
        [
            [
                _invoice_logo_flowable(),
                Paragraph(_esc(title_line), title_style),
            ]
        ],
        colWidths=[60 * mm, 130 * mm],
    )
    hero_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story: list = [hero_table]

    story.append(Spacer(1, 14))

    divider_table = Table(
        [[Paragraph(" ", body_text_style)]],
        colWidths=[190 * mm],
        rowHeights=[1],
    )
    divider_table.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, -1), 1.2, _INV_DIVIDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(divider_table)
    story.append(Spacer(1, 22))

    from_body_parts: list[str] = []
    if business_name:
        from_body_parts.append(business_name)
    from_body_parts.extend(address_lines)
    from_body_html = "<br/>".join(from_body_parts) if from_body_parts else ""

    body_lines_count = (1 if business_name else 0) + len(address_lines)
    from_lines = min(6, max(2, body_lines_count))
    header_row_pt = max(150, 22 + (from_lines * 16) + 22)
    if not show_due_date:
        header_row_pt = max(132, header_row_pt - 16)

    from_cell = Table(
        [
            [Paragraph("From:", label_heading_style)],
            [Paragraph(from_body_html, body_text_style)],
        ],
        colWidths=[70 * mm],
    )
    from_cell.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 4),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 0),
            ]
        )
    )

    bill_body_parts: list[str] = []
    display_name_raw = invoice.bill_to_display_name
    if display_name_raw:
        name_text = display_name_raw
        if getattr(invoice, "bill_to_kind", None) == BillingBillToKind.FAMILY:
            adjusted = _family_bill_to_display_name_for_pdf(display_name_raw)
            if adjusted is not None:
                name_text = adjusted
        name_lines = [ln.strip() for ln in name_text.split("\n") if ln.strip()]
        if name_lines:
            bill_body_parts.append("<br/>".join(_esc(ln) for ln in name_lines))
    loc_raw = (getattr(invoice, "bill_to_location_text", None) or "").strip()
    has_bill_to_address = bool(loc_raw)
    if invoice.bill_to_email and not has_bill_to_address:
        bill_body_parts.append(_esc(invoice.bill_to_email))
    if loc_raw:
        loc_lines = [ln.strip() for ln in loc_raw.splitlines() if ln.strip()]
        if loc_lines:
            bill_body_parts.append("<br/>".join(_esc(ln) for ln in loc_lines))
    bill_body_html = "<br/>".join(bill_body_parts) if bill_body_parts else ""

    bill_cell = Table(
        [
            [Paragraph("Bill To:", label_heading_style)],
            [Paragraph(bill_body_html, body_text_style)],
        ],
        colWidths=[60 * mm],
    )
    bill_cell.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 4),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 0),
            ]
        )
    )

    inv_date_s = _esc(inv_date.isoformat())
    due_date_s = _esc(due_date.isoformat())
    date_rows: list[list] = [
        [
            Paragraph("<b>Invoice Date:</b>", date_label_style),
            Paragraph(inv_date_s, date_value_style),
        ],
    ]
    if show_due_date:
        date_rows.append(
            [
                Paragraph("<b>Due Date:</b>", date_label_style),
                Paragraph(due_date_s, date_value_style),
            ],
        )
    dates_inner = Table(date_rows, colWidths=[28 * mm, 30 * mm])
    dates_style_cmds: list[tuple] = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, -1), 10),
        ("RIGHTPADDING", (0, 0), (0, -1), 4),
        ("LEFTPADDING", (1, 0), (1, -1), 4),
        ("RIGHTPADDING", (1, 0), (1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]
    if len(date_rows) == 1:
        dates_style_cmds.append(("BOTTOMPADDING", (0, 0), (-1, 0), 14))
    else:
        dates_style_cmds.extend(
            [
                ("BOTTOMPADDING", (0, 0), (-1, 0), 14),
                ("TOPPADDING", (0, 1), (-1, 1), 0),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 0),
            ]
        )
    dates_inner.setStyle(TableStyle(dates_style_cmds))

    dates_panel = RoundedPanel(
        dates_inner,
        width=58 * mm,
        height=header_row_pt,
        fill=_INV_PANEL_FILL,
        radius=4.0,
        valign="top",
        inset_top=20.0,
    )

    header_band = Table(
        [[from_cell, bill_cell, dates_panel]],
        colWidths=[70 * mm, 62 * mm, 58 * mm],
        rowHeights=[header_row_pt],
    )
    header_band.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(header_band)
    story.append(Spacer(1, 16))

    header_row = [
        Paragraph("<b>Description</b>", header_label_style),
        Paragraph("<b>Quantity</b>", header_label_style),
        Paragraph("<b>Unit Price</b>", header_label_style),
        Paragraph("<b>Total</b>", header_label_style),
    ]

    first_line_item = True
    for line_idx, line in enumerate(ordered):
        desc = line.description or ""
        qty = line.quantity.quantize(Decimal("0.0001")).normalize()
        unit = format_money(line.unit_amount, inv_currency)
        ltot = format_money(line.line_total, inv_currency)
        qty_para = Paragraph(_esc(str(qty)), body_text_style)
        unit_para = Paragraph(_esc(unit), body_text_style)
        ltot_para = Paragraph(_esc(ltot), body_text_style)
        chunks = _description_row_strings(desc)

        seg_start = 0
        while seg_start < len(chunks):
            batch = chunks[seg_start : seg_start + _LINE_TABLE_BODY_ROWS_MAX]
            seg_end = seg_start + len(batch)

            table_rows: list[list] = []
            has_header = bool(first_line_item and seg_start == 0)
            if has_header:
                table_rows.append(header_row)

            for i, chunk in enumerate(batch):
                global_idx = seg_start + i
                desc_para = Paragraph(_esc(chunk), body_text_style)
                if global_idx == 0:
                    table_rows.append([desc_para, qty_para, unit_para, ltot_para])
                else:
                    empty = Paragraph("", body_text_style)
                    table_rows.append([desc_para, empty, empty, empty])

            n_rows = len(table_rows)
            n_batch = len(batch)
            row_body_start = 1 if has_header else 0
            style_cmds: list[tuple] = [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
            if has_header:
                hdr = 0
                style_cmds.extend(
                    [
                        ("BACKGROUND", (0, hdr), (-1, hdr), _INV_HEADER_FILL),
                        ("TEXTCOLOR", (0, hdr), (-1, hdr), _INV_HEADER_TEXT),
                        ("ALIGN", (0, hdr), (-1, hdr), "LEFT"),
                        ("TOPPADDING", (0, hdr), (-1, hdr), 6),
                        ("BOTTOMPADDING", (0, hdr), (-1, hdr), 6),
                        (
                            "LINEBELOW",
                            (0, hdr),
                            (-1, hdr),
                            0,
                            colors.transparent,
                        ),
                    ]
                )
                body_start = 1
            else:
                body_start = 0

            if body_start <= n_rows - 1:
                style_cmds.append(
                    ("ALIGN", (0, body_start), (-1, n_rows - 1), "LEFT"),
                )

            if n_batch > 1:
                last_body_row = row_body_start + n_batch - 1
                for col in (1, 2, 3):
                    style_cmds.append(
                        ("SPAN", (col, row_body_start), (col, last_body_row))
                    )

            is_last_line_last_slice = line_idx == len(ordered) - 1 and seg_end == len(
                chunks
            )
            for r in range(body_start, n_rows):
                if is_last_line_last_slice and r == n_rows - 1:
                    continue
                style_cmds.append(
                    ("LINEBELOW", (0, r), (-1, r), 0.4, _INV_RULE),
                )

            repeat_rows = 1 if has_header else 0
            line_table = LongTable(
                table_rows,
                colWidths=[100 * mm, 22 * mm, 34 * mm, 34 * mm],
                repeatRows=repeat_rows,
            )
            line_table.setStyle(TableStyle(style_cmds))
            story.append(line_table)

            seg_start = seg_end

        first_line_item = False

    sub = format_money(invoice.subtotal, inv_currency)
    tot = format_money(invoice.total, inv_currency)
    show_tax = bool(invoice.tax_total and invoice.tax_total != Decimal("0"))
    inner_totals_rows: list[list] = [
        [
            Paragraph("Subtotal:", totals_label_style),
            Paragraph(sub, totals_value_style),
        ]
    ]
    if show_tax:
        inner_totals_rows.append(
            [
                Paragraph("Tax:", totals_label_style),
                Paragraph(
                    format_money(invoice.tax_total, inv_currency),
                    totals_value_style,
                ),
            ]
        )
    inner_totals_rows.append(
        [
            Paragraph("Total:", totals_total_style),
            Paragraph(tot, totals_total_style),
        ]
    )
    last_row = len(inner_totals_rows) - 1
    totals_card_w = 88 * mm
    totals_card_h = 30 * (last_row + 1) + 20
    inner_totals = Table(
        inner_totals_rows,
        colWidths=[48 * mm, 40 * mm],
    )
    totals_style_cmds: list[tuple] = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (1, last_row), (1, last_row), 0.6, _INV_TOTAL_RULE),
    ]
    inner_totals.setStyle(TableStyle(totals_style_cmds))

    totals_panel = RoundedPanel(
        inner_totals,
        width=totals_card_w,
        height=totals_card_h,
        fill=_INV_PANEL_FILL,
        radius=4.0,
    )

    totals_outer = Table(
        [
            [
                Paragraph("", body_text_style),
                totals_panel,
            ]
        ],
        colWidths=[102 * mm, 88 * mm],
        rowHeights=[totals_card_h],
    )
    totals_outer.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ]
        )
    )
    story.append(Spacer(1, 9))
    story.append(totals_outer)
    story.append(Spacer(1, 36))

    terms_intro = (
        f"Payment is due within {terms_days} days from the issue of the invoice."
    )
    refer_next_page_style = ParagraphStyle(
        "InvReferNextPage",
        parent=body_text_style,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
    )

    if not is_non_positive_total:
        story.append(Paragraph("Terms &amp; Conditions:", label_heading_style))
        story.append(Spacer(1, 4))
        story.append(Paragraph(_esc(terms_intro), body_text_style))

        if has_bank_block or fps_payload is not None:
            # Bullet headings ("By Bank Transfer" / "By FPS scanning...") hang
            # the bullet glyph at column 0 while the heading text sits at the
            # same x as the payment-confirmation copy, mirroring a typical
            # bullet-list look.
            payment_bullet_style = ParagraphStyle(
                "InvPaymentBullet",
                parent=body_text_style,
                leftIndent=12,
                firstLineIndent=-12,
            )
            # Continuation copy under each bullet (the "Please send..." lines)
            # is indented to the heading-text column so it left-aligns with
            # "By Bank Transfer:" / "By FPS scanning..." rather than with the
            # bullet glyph.
            payment_block_continue_style = ParagraphStyle(
                "InvPaymentContinue",
                parent=body_text_style,
                leftIndent=12,
            )
            # Bank details (the Bank/Account Number/Account Name lines) and
            # the FPS logo + QR row are indented one tab-stop further right
            # than the bullet heading so they sit clearly nested under it.
            section_inset = 12 * mm
            bank_detail_style = ParagraphStyle(
                "InvBankDetail",
                parent=body_text_style,
                leftIndent=section_inset,
            )
            fps_logo_qr_gap = 4 * mm
            thank_you_style = ParagraphStyle(
                "InvThankYou",
                parent=body_text_style,
                fontName="Helvetica-Bold",
                fontSize=11,
                leading=16,
                textColor=_INV_BODY_TEXT,
                alignment=TA_CENTER,
            )
            billing_email = get_public_www("BILLING_EMAIL").strip()
            confirm_line_html = _payment_confirmation_line_html(billing_email)

            story.append(Spacer(1, 44))
            story.append(
                Paragraph(
                    _esc(
                        "Please refer to next page for details of different "
                        "payment methods."
                    ),
                    refer_next_page_style,
                )
            )
            story.append(Spacer(1, 16))
            story.append(PageBreak())

            story.append(Paragraph("Payment Options:", label_heading_style))
            story.append(Spacer(1, 4))

            bank_line_htmls: list[str] = []
            if has_bank_block:
                for bl in (
                    f"Bank: {_esc(bank_name)}" if bank_name else "",
                    f"Account Number: {_esc(bank_number)}" if bank_number else "",
                    f"Account Name: {_esc(bank_holder)}" if bank_holder else "",
                ):
                    if bl:
                        bank_line_htmls.append(bl)

            if has_bank_block:
                story.append(
                    Paragraph("&#8226; By <b>Bank Transfer</b>:", payment_bullet_style)
                )
                story.append(Spacer(1, 16))
                story.append(
                    Paragraph("<br/>".join(bank_line_htmls), bank_detail_style)
                )
                story.append(Spacer(1, 16))
                story.append(Paragraph(confirm_line_html, payment_block_continue_style))
                story.append(Spacer(1, 10))

            if fps_payload is not None:
                fps_head_html = "&#8226; By <b>FPS</b> scanning the following QR code:"
                story.append(Paragraph(fps_head_html, payment_bullet_style))
                story.append(Spacer(1, 4))
                # The FPS source PNG has an almost-square aspect ratio
                # (~1.06), so we size the logo bounding box to match: this
                # keeps `kind="proportional"` from leaving a wide gap of empty
                # space inside an oversized column, which would otherwise
                # push the QR towards the page centre.
                fps_logo_width_mm = 30
                fps_logo_height_mm = 28
                fps_qr_size_mm = 35
                logo_flow = _fps_logo_image(
                    width_mm=fps_logo_width_mm, height_mm=fps_logo_height_mm
                )
                qr_png = render_fps_qr_png(fps_payload, size_px=256)
                qr_img = Image(
                    io.BytesIO(qr_png),
                    width=fps_qr_size_mm * mm,
                    height=fps_qr_size_mm * mm,
                    kind="proportional",
                )
                qr_img.hAlign = "LEFT"
                gap_w = fps_logo_qr_gap
                if logo_flow is not None:
                    fps_inner_row: list = [logo_flow, Spacer(gap_w, 1), qr_img]
                    fps_col_widths = [
                        fps_logo_width_mm * mm,
                        gap_w,
                        fps_qr_size_mm * mm,
                    ]
                else:
                    fps_inner_row = [qr_img]
                    fps_col_widths = [fps_qr_size_mm * mm]
                fps_inner = Table(
                    [fps_inner_row], colWidths=fps_col_widths, hAlign="LEFT"
                )
                fps_inner.setStyle(
                    TableStyle(
                        [
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                            ("TOPPADDING", (0, 0), (-1, -1), 0),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                        ]
                    )
                )
                fps_indent = Table(
                    [[Spacer(section_inset, 1), fps_inner]],
                    colWidths=[section_inset, 95 * mm],
                    hAlign="LEFT",
                )
                fps_indent.setStyle(
                    TableStyle(
                        [
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                            ("TOPPADDING", (0, 0), (-1, -1), 0),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                            ("ALIGN", (1, 0), (1, 0), "LEFT"),
                        ]
                    )
                )
                story.append(fps_indent)
                story.append(Spacer(1, 6))
                story.append(Paragraph(confirm_line_html, payment_block_continue_style))

            story.append(Spacer(1, 72))
            story.append(Paragraph("Thank you!", thank_you_style))
    elif is_zero_total:
        story.append(Spacer(1, 44))
        story.append(
            Paragraph(
                _esc("Nothing to pay, thank you!"),
                refer_next_page_style,
            )
        )
    else:
        story.append(Spacer(1, 36))

    footer_text = invoice_pdf_footer_text()
    paid_watermark = (
        invoice.status == BillingInvoiceStatus.ISSUED
        and getattr(invoice, "paid_at", None) is not None
        and invoice.total > Decimal("0")
    )
    doc.build(
        story,
        canvasmaker=partial(
            InvoicePdfCanvas,
            footer_text=footer_text,
            paid_watermark=paid_watermark,
        ),
    )
    return buf.getvalue()
