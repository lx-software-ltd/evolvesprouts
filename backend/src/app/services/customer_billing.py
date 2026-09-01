"""Customer billing (AR): PDF generation, S3, receipts, reservation capture."""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.customer_receipt import CustomerReceipt
from app.db.models.enums import (
    BillingInvoiceStatus,
    BillingPaymentDirection,
    BillingPaymentStatus,
)
from app.db.models.payment_allocation import DocumentCounter, PaymentAllocation
from app.services.asset_invoice_tagging import ensure_customer_invoice_asset
from app.services.aws_clients import get_s3_client
from app.services.customer_invoice_pdf import (
    render_invoice_pdf,
)
from app.services.customer_receipt_pdf import render_receipt_pdf
from app.services.email import send_mime_email_with_optional_attachments
from app.templates.booking_confirmation_render import substitute_shell_placeholders
from app.templates.invoice_email_content import DEFAULT_INVOICE_EMAIL_LOCALE
from app.templates.invoice_email_render import render_invoice_email
from app.templates.transactional_shell_data import (
    merge_transactional_shell_template_data,
    resolve_whatsapp_url_for_template,
)
from app.utils.logging import get_logger

logger = get_logger(__name__)

INVOICE_PDF_TEMPLATE_VERSION = "billing-invoice-v21"
RECEIPT_PDF_TEMPLATE_VERSION = "billing-receipt-v1"
_SCOPE_DEFAULT = "default"
_DOC_INVOICE = "invoice"
_DOC_RECEIPT = "receipt"


def _confirmation_from_address() -> str:
    return os.getenv("CONFIRMATION_EMAIL_FROM_ADDRESS", "").strip()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def store_pdf_in_assets_bucket(
    *,
    s3_key: str,
    body: bytes,
    content_type: str,
    require_upload: bool = False,
) -> None:
    bucket = os.getenv("ASSETS_BUCKET_NAME", "").strip()
    if not bucket:
        if require_upload:
            from app.exceptions import AppError

            raise AppError(
                "Assets bucket is not configured",
                status_code=500,
            )
        logger.warning("ASSETS_BUCKET_NAME not set; skipping PDF upload")
        return
    get_s3_client().put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=body,
        ContentType=content_type,
        CacheControl="private, max-age=0, must-revalidate",
    )


def next_invoice_number(session: Session) -> tuple[str, int]:
    """Atomically allocate next invoice number (one counter per calendar year, UTC)."""
    now = datetime.now(UTC)
    year = now.year
    scope_key = _SCOPE_DEFAULT
    session.execute(
        text(
            """
            INSERT INTO document_counters (document_type, scope_key, year, last_number)
            VALUES (:dt, :sk, :yr, 0)
            ON CONFLICT (document_type, scope_key, year) DO NOTHING
            """
        ),
        {"dt": _DOC_INVOICE, "sk": scope_key, "yr": year},
    )
    row = session.execute(
        select(DocumentCounter)
        .where(DocumentCounter.document_type == _DOC_INVOICE)
        .where(DocumentCounter.scope_key == scope_key)
        .where(DocumentCounter.year == year)
        .with_for_update()
    ).scalar_one()
    row.last_number += 1
    seq = row.last_number
    inv_num = f"INV-{year}-{seq:06d}"
    session.flush()
    return inv_num, seq


def next_receipt_number(session: Session, *, currency: str) -> tuple[str, int]:
    now = datetime.now(UTC)
    year = now.year
    scope_key = f"rcp-{currency.upper()}"
    session.execute(
        text(
            """
            INSERT INTO document_counters (document_type, scope_key, year, last_number)
            VALUES (:dt, :sk, :yr, 0)
            ON CONFLICT (document_type, scope_key, year) DO NOTHING
            """
        ),
        {"dt": _DOC_RECEIPT, "sk": scope_key, "yr": year},
    )
    row = session.execute(
        select(DocumentCounter)
        .where(DocumentCounter.document_type == _DOC_RECEIPT)
        .where(DocumentCounter.scope_key == scope_key)
        .where(DocumentCounter.year == year)
        .with_for_update()
    ).scalar_one()
    row.last_number += 1
    seq = row.last_number
    rnum = f"RCP-{year}-{seq:06d}-{currency.upper()}"
    session.flush()
    return rnum, seq


def allocation_invoice_labels_for_payment(
    session: Session, payment_id: UUID
) -> list[tuple[str, Decimal]]:
    rows = session.execute(
        select(CustomerInvoice.invoice_number, PaymentAllocation.allocated_amount)
        .join(
            CustomerInvoice,
            CustomerInvoice.id == PaymentAllocation.invoice_id,
        )
        .where(PaymentAllocation.payment_id == payment_id)
        .where(CustomerInvoice.invoice_number.isnot(None))
    ).all()
    out: list[tuple[str, Decimal]] = []
    for inv_num, amt in rows:
        if inv_num and amt is not None:
            out.append((str(inv_num), Decimal(str(amt))))
    return out


def create_receipt_for_succeeded_inbound_payment(
    session: Session,
    *,
    payment: CustomerPayment,
) -> CustomerReceipt:
    """Create receipt row, PDF bytes, and SHA-256 inside the DB transaction.

    Does **not** upload to S3 (defer to :func:`finalize_receipt_pdf_upload` after
    ``commit``) so S3 failures do not roll back payment confirmation.
    """
    if payment.direction != BillingPaymentDirection.INBOUND:
        raise ValueError("Receipt only for inbound payments")
    if payment.status != BillingPaymentStatus.SUCCEEDED:
        raise ValueError("Receipt requires succeeded payment")
    existing = session.execute(
        select(CustomerReceipt).where(CustomerReceipt.customer_payment_id == payment.id)
    ).scalar_one_or_none()
    if existing:
        return existing

    rnum, seq = next_receipt_number(session, currency=payment.currency)
    labels = allocation_invoice_labels_for_payment(session, payment.id)
    receipt = CustomerReceipt(
        customer_payment_id=payment.id,
        receipt_number=rnum,
        receipt_sequence=seq,
        currency=payment.currency,
        total_amount=payment.amount,
        pdf_template_version=RECEIPT_PDF_TEMPLATE_VERSION,
    )
    session.add(receipt)
    session.flush()

    pdf_bytes = render_receipt_pdf(
        receipt=receipt,
        payment=payment,
        allocation_invoice_numbers=labels,
    )
    digest = _sha256_bytes(pdf_bytes)
    key = f"billing/receipts/{receipt.id}.pdf"
    receipt.issued_pdf_sha256 = digest
    session.flush()
    # Stash for post-commit upload (not a mapped column)
    setattr(receipt, "_pending_receipt_pdf_bytes", pdf_bytes)
    setattr(receipt, "_pending_receipt_s3_key", key)
    return receipt


def finalize_receipt_pdf_upload(session: Session, *, receipt_id: UUID) -> None:
    """Upload receipt PDF to S3 and set ``issued_pdf_s3_key`` (call after main commit)."""
    receipt = session.get(CustomerReceipt, receipt_id)
    if receipt is None or receipt.issued_pdf_s3_key:
        return
    payment = session.get(CustomerPayment, receipt.customer_payment_id)
    if payment is None:
        return
    pdf_bytes = getattr(receipt, "_pending_receipt_pdf_bytes", None)
    key = (
        getattr(receipt, "_pending_receipt_s3_key", None)
        or f"billing/receipts/{receipt.id}.pdf"
    )
    if pdf_bytes is None:
        labels = allocation_invoice_labels_for_payment(session, payment.id)
        pdf_bytes = render_receipt_pdf(
            receipt=receipt,
            payment=payment,
            allocation_invoice_numbers=labels,
        )
    try:
        store_pdf_in_assets_bucket(
            s3_key=key,
            body=pdf_bytes,
            content_type="application/pdf",
        )
    except Exception:
        logger.exception(
            "Receipt S3 upload failed after commit",
            extra={"receipt_id": str(receipt_id), "s3_key": key},
        )
        return
    receipt.issued_pdf_s3_key = key
    session.flush()


def send_receipt_email(session: Session, *, receipt_id: UUID, to_email: str) -> None:
    """Email receipt PDF to customer (best-effort)."""
    receipt = session.get(CustomerReceipt, receipt_id)
    if receipt is None or not receipt.issued_pdf_s3_key:
        return
    payment = session.get(CustomerPayment, receipt.customer_payment_id)
    if payment is None:
        return
    bucket = os.getenv("ASSETS_BUCKET_NAME", "").strip()
    if not bucket:
        logger.warning("ASSETS_BUCKET_NAME missing; cannot attach receipt PDF")
        return
    obj = get_s3_client().get_object(Bucket=bucket, Key=receipt.issued_pdf_s3_key)
    pdf_bytes = obj["Body"].read()
    src = _confirmation_from_address()
    if not src:
        logger.warning("CONFIRMATION_EMAIL_FROM_ADDRESS missing; skip receipt email")
        return
    subject = f"Receipt {receipt.receipt_number}"
    body_text = f"Thank you. Please find your payment receipt {receipt.receipt_number} attached."
    body_html = f"<p>{body_text}</p>"
    send_mime_email_with_optional_attachments(
        source=src,
        to_addresses=[to_email],
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        attachments=[
            (
                f"receipt-{receipt.receipt_number}.pdf",
                "application/pdf",
                pdf_bytes,
            )
        ],
    )
    # SES message id not captured by send_raw_email wrapper; leave ses_message_id null
    receipt.email_sent_at = datetime.now(UTC)
    session.flush()


def _canonical_reservation_payment_method(raw: str) -> str:
    """Map client payment method strings to canonical billing method values."""
    pm = (raw or "").strip().lower()
    if pm in ("free", ""):
        return "free"
    if "apple" in pm and "pay" in pm:
        return "stripe_card"
    if "stripe" in pm or "card" in pm:
        return "stripe_card"
    if pm in ("fps", "fps_qr", "fps-qr"):
        return "fps"
    if "bank" in pm or pm in ("wire", "ach", "transfer"):
        return "bank_transfer"
    if pm == "adjustment":
        return "adjustment"
    return pm.replace(" ", "_")[:64] if pm else "unknown"


def record_reservation_customer_payment(
    session: Session,
    *,
    enrollment_id: UUID,
    contact_id: UUID,
    currency: str,
    total_amount: Decimal,
    payment_method: str,
    stripe_payment_intent_id: str | None,
    stripe_currency: str | None,
) -> tuple[CustomerPayment | None, UUID | None, bool]:
    """Insert customer_payment for a new enrollment.

    Receipts are not created at booking time; staff create them after invoice
    reconciliation via admin confirm or equivalent succeeded paths.

    Returns:
        Tuple of (payment or existing row, receipt_id always None here,
        duplicate_stripe_payment_intent) where the third flag is True when an
        existing row was returned for the same Stripe payment intent id.
    """
    pm_lower = (payment_method or "").strip().lower()
    is_free = pm_lower == "free" or total_amount == Decimal("0")
    expects_stripe = "stripe" in pm_lower or "apple pay" in pm_lower
    canonical_method = _canonical_reservation_payment_method(payment_method)

    pay_currency = (stripe_currency or currency or "HKD").upper()[:3]

    if expects_stripe and stripe_payment_intent_id:
        existing_pi = session.execute(
            select(CustomerPayment).where(
                CustomerPayment.stripe_payment_intent_id == stripe_payment_intent_id
            )
        ).scalar_one_or_none()
        if existing_pi is not None:
            return existing_pi, None, True
        pay = CustomerPayment(
            direction=BillingPaymentDirection.INBOUND,
            status=BillingPaymentStatus.SUCCEEDED,
            method="stripe_card",
            amount=total_amount,
            currency=pay_currency,
            stripe_payment_intent_id=stripe_payment_intent_id,
            succeeded_at=datetime.now(UTC),
            enrollment_id=enrollment_id,
            contact_id=contact_id,
        )
    elif is_free:
        pay = CustomerPayment(
            direction=BillingPaymentDirection.INBOUND,
            status=BillingPaymentStatus.SUCCEEDED,
            method="free",
            amount=Decimal("0"),
            currency=pay_currency,
            succeeded_at=datetime.now(UTC),
            enrollment_id=enrollment_id,
            contact_id=contact_id,
        )
    else:
        pay = CustomerPayment(
            direction=BillingPaymentDirection.INBOUND,
            status=BillingPaymentStatus.PENDING,
            method=canonical_method,
            amount=total_amount,
            currency=pay_currency,
            enrollment_id=enrollment_id,
            contact_id=contact_id,
        )
    try:
        with session.begin_nested():
            session.add(pay)
            session.flush()
    except IntegrityError:
        if expects_stripe and stripe_payment_intent_id:
            dup = session.execute(
                select(CustomerPayment).where(
                    CustomerPayment.stripe_payment_intent_id == stripe_payment_intent_id
                )
            ).scalar_one_or_none()
            if dup is not None:
                return dup, None, True
        raise
    return pay, None, False


def refresh_invoice_pdf(session: Session, invoice: CustomerInvoice) -> None:
    """Generate and store invoice PDF + hash for issued invoice."""
    lines = list(
        session.execute(
            select(CustomerInvoiceLine).where(
                CustomerInvoiceLine.invoice_id == invoice.id
            )
        )
        .scalars()
        .all()
    )
    pdf_bytes = render_invoice_pdf(invoice=invoice, lines=lines, preview=False)
    digest = _sha256_bytes(pdf_bytes)
    key = f"billing/invoices/{invoice.id}.pdf"
    store_pdf_in_assets_bucket(
        s3_key=key, body=pdf_bytes, content_type="application/pdf"
    )
    invoice.issued_pdf_s3_key = key
    invoice.issued_pdf_sha256 = digest
    invoice.pdf_template_version = INVOICE_PDF_TEMPLATE_VERSION
    session.flush()
    ensure_customer_invoice_asset(session, invoice)


def _invoice_preview_s3_key(invoice_id: UUID) -> str:
    return f"billing/invoices/preview/{invoice_id}.pdf"


def upload_invoice_preview_pdf(session: Session, invoice: CustomerInvoice) -> str:
    """Render invoice lines to PDF and store under a non-canonical preview key (no DB mutation)."""
    lines = list(
        session.execute(
            select(CustomerInvoiceLine).where(
                CustomerInvoiceLine.invoice_id == invoice.id
            )
        )
        .scalars()
        .all()
    )
    pdf_bytes = render_invoice_pdf(invoice=invoice, lines=lines, preview=True)
    key = _invoice_preview_s3_key(invoice.id)
    store_pdf_in_assets_bucket(
        s3_key=key, body=pdf_bytes, content_type="application/pdf"
    )
    return key


def ensure_invoice_pdf_storage(session: Session, invoice: CustomerInvoice) -> str:
    """Return S3 object key for opening the invoice PDF (issued artifact or preview upload).

    Issued invoices reuse ``issued_pdf_s3_key`` when set. Draft and void invoices
    upload to ``billing/invoices/preview/{id}.pdf`` so preview does not overwrite
    issued PDF metadata or hashes.
    """
    if (
        invoice.status == BillingInvoiceStatus.ISSUED
        and invoice.issued_pdf_s3_key
        and invoice.issued_pdf_s3_key.strip()
    ):
        return invoice.issued_pdf_s3_key.strip()
    return upload_invoice_preview_pdf(session, invoice)


def send_invoice_email(
    session: Session, *, invoice_id: UUID, to_addresses: list[str]
) -> None:
    inv = session.get(CustomerInvoice, invoice_id)
    if inv is None:
        logger.info(
            "invoice_email_skipped",
            extra={"reason": "invoice_not_found", "invoice_id": str(invoice_id)},
        )
        return
    if not (inv.issued_pdf_s3_key or "").strip():
        logger.info(
            "invoice_email_skipped",
            extra={"reason": "missing_issued_pdf", "invoice_id": str(invoice_id)},
        )
        return
    bucket = os.getenv("ASSETS_BUCKET_NAME", "").strip()
    if not bucket:
        logger.warning(
            "invoice_email_skipped",
            extra={"reason": "assets_bucket_missing", "invoice_id": str(invoice_id)},
        )
        return
    obj = get_s3_client().get_object(Bucket=bucket, Key=inv.issued_pdf_s3_key)
    pdf_bytes = obj["Body"].read()
    src = _confirmation_from_address()
    if not src:
        logger.warning(
            "invoice_email_skipped",
            extra={"reason": "from_address_missing", "invoice_id": str(invoice_id)},
        )
        return
    locale = DEFAULT_INVOICE_EMAIL_LOCALE
    num = (inv.invoice_number or str(inv.id)).strip()
    shell = merge_transactional_shell_template_data(locale=locale, template_data={})
    subject, html_doc, body_text = render_invoice_email(
        locale=locale,
        bill_to_name=inv.bill_to_display_name or "",
        invoice_number=num,
        invoice_date=inv.invoice_date,
        due_date=inv.due_date,
        total=Decimal(str(inv.total)),
        balance_due=Decimal(str(inv.balance_due)),
        currency=inv.currency,
        is_paid=inv.paid_at is not None,
        whatsapp_url=resolve_whatsapp_url_for_template(),
        faq_url=str(shell.get("faq_url") or ""),
    )
    body_html = substitute_shell_placeholders(html_doc, shell)
    send_mime_email_with_optional_attachments(
        source=src,
        to_addresses=to_addresses,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        attachments=[(f"invoice-{num}.pdf", "application/pdf", pdf_bytes)],
    )
    inv.email_sent_at = datetime.now(UTC)
    session.flush()


def payment_unapplied_amount(session: Session, payment_id: UUID) -> Decimal:
    """amount - sum(allocations) for same payment."""
    pay = session.get(CustomerPayment, payment_id)
    if pay is None:
        return Decimal("0")
    allocated = session.execute(
        select(func.coalesce(func.sum(PaymentAllocation.allocated_amount), 0))
        .where(PaymentAllocation.payment_id == payment_id)
        .where(PaymentAllocation.currency == pay.currency)
    ).scalar_one()
    return Decimal(str(pay.amount)) - Decimal(str(allocated))


def recompute_invoice_settlement(session: Session, invoice: CustomerInvoice) -> None:
    """Refresh ``amount_allocated``, ``balance_due``, and ``paid_at`` from ``payment_allocations``.

    Source of truth is ``payment_allocations`` for this invoice where allocation currency
    matches the invoice currency. Call inside the same transaction as allocation mutations.

    This function row-locks the invoice (``SELECT … FOR UPDATE``) before recomputing.

    When a DELETE allocation endpoint is added, its handler **must** call this helper after
    removing rows. ``admin_billing_payments`` does not delete or update allocation rows
    (payments with allocations cannot be deleted; refunds are separate payment rows).
    """
    inv = session.execute(
        select(CustomerInvoice)
        .where(CustomerInvoice.id == invoice.id)
        .with_for_update()
    ).scalar_one()

    prev_paid_at = inv.paid_at

    allocated_raw = session.execute(
        select(func.coalesce(func.sum(PaymentAllocation.allocated_amount), 0))
        .where(PaymentAllocation.invoice_id == inv.id)
        .where(PaymentAllocation.currency == inv.currency)
    ).scalar_one()
    allocated = Decimal(str(allocated_raw))
    total = Decimal(str(inv.total))
    balance_due = total - allocated
    if balance_due < Decimal("0"):
        balance_due = Decimal("0")

    inv.amount_allocated = allocated
    inv.balance_due = balance_due

    if inv.status == BillingInvoiceStatus.VOID:
        inv.paid_at = None
    elif balance_due > Decimal("0"):
        inv.paid_at = None
    elif (
        inv.status == BillingInvoiceStatus.ISSUED
        and balance_due == Decimal("0")
        and allocated >= total
        and total > Decimal("0")
    ):
        if inv.paid_at is None:
            inv.paid_at = datetime.now(UTC)
    else:
        inv.paid_at = None

    transition_to_paid = prev_paid_at is None and inv.paid_at is not None
    transition_to_unpaid = prev_paid_at is not None and inv.paid_at is None
    pdf_key = (inv.issued_pdf_s3_key or "").strip()
    if pdf_key and (transition_to_paid or transition_to_unpaid):
        logger.info(
            "invoice_pdf_refresh_due_to_settlement_transition",
            extra={
                "invoice_id": str(inv.id),
                "transition": "to_paid" if transition_to_paid else "to_unpaid",
            },
        )
        refresh_invoice_pdf(session, inv)

    logger.info(
        "invoice_settlement_recomputed",
        extra={
            "invoice_id": str(inv.id),
            "amount_allocated": str(inv.amount_allocated),
            "balance_due": str(inv.balance_due),
            "paid_at": inv.paid_at.isoformat() if inv.paid_at else None,
        },
    )
