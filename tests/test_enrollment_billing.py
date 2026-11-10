"""Enrollment payment and invoice orchestration."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from app.api.admin_enrollments_payloads import parse_create_enrollment_payload
from app.db.models.customer_invoice import CustomerInvoice
from app.db.models.enums import (
    BillingInvoiceStatus,
    BillingPaymentStatus,
    DiscountType,
    EnrollmentStatus,
    ServiceType,
)
from app.exceptions import ConflictError
from app.services import enrollment_billing as billing
from app.services import enrollment_invoice_build as build


def test_auto_invoice_flag_is_off_unless_explicitly_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ENROLLMENT_AUTO_INVOICE", raising=False)
    assert build.enrollment_auto_invoice_enabled() is False
    monkeypatch.setenv("ENROLLMENT_AUTO_INVOICE", "false")
    assert build.enrollment_auto_invoice_enabled() is False
    monkeypatch.setenv("ENROLLMENT_AUTO_INVOICE", "yes")
    assert build.enrollment_auto_invoice_enabled() is True


def test_percentage_discount_rounds_half_up_to_a_whole_dollar() -> None:
    code = SimpleNamespace(
        discount_type=DiscountType.PERCENTAGE, discount_value=Decimal(10)
    )
    assert build._discounted(Decimal(15), code) == Decimal(14)


def test_catalogue_charge_uses_the_intro_call_price() -> None:
    enrollment = SimpleNamespace(
        instance_id=uuid4(),
        ticket_tier_id=None,
        discount_code_id=None,
        discount_code=None,
        instance=SimpleNamespace(
            service_id=uuid4(),
            service=SimpleNamespace(service_type=ServiceType.INTRO_CALL),
        ),
    )
    assert build.catalogue_charge(MagicMock(), enrollment) == (Decimal(0), "HKD")


def test_flag_off_keeps_the_payment_and_skips_the_invoice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ENROLLMENT_AUTO_INVOICE", raising=False)
    receipt_id = uuid4()
    monkeypatch.setattr(
        build,
        "receipt_for_positive_succeeded_payment",
        lambda _session, _payment: receipt_id,
    )
    payment = SimpleNamespace(
        id=uuid4(),
        amount=Decimal(100),
        currency="HKD",
        status=BillingPaymentStatus.SUCCEEDED,
    )
    enrollment = SimpleNamespace(id=uuid4(), status=EnrollmentStatus.REGISTERED)
    followup = build._invoice_for_payment(
        MagicMock(),
        enrollment,
        payment,
        actor="staff",
        request_id=None,
        send_email=True,
        display_name=None,
        require_catalogue_match=False,
    )
    assert followup.invoice_id is None
    assert followup.receipt_id == receipt_id


def test_catalogue_mismatch_leaves_a_draft(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENROLLMENT_AUTO_INVOICE", "on")
    invoice = SimpleNamespace(
        id=uuid4(),
        invoice_number=None,
        status=BillingInvoiceStatus.DRAFT,
        bill_to_email=None,
    )
    monkeypatch.setattr(build, "open_invoice_enrollment_ids", lambda *_a, **_k: set())
    monkeypatch.setattr(build, "_draft_invoice", lambda *_a, **_k: invoice)
    monkeypatch.setattr(
        build, "catalogue_charge", lambda *_a, **_k: (Decimal(80), "HKD")
    )
    monkeypatch.setattr(
        build,
        "issue_draft_invoice",
        lambda *_a, **_k: pytest.fail("mismatch must stay a draft"),
    )
    monkeypatch.setattr(
        build, "receipt_for_positive_succeeded_payment", lambda *_a, **_k: None
    )
    payment = SimpleNamespace(
        id=uuid4(),
        amount=Decimal(100),
        currency="HKD",
        status=BillingPaymentStatus.PENDING,
    )
    enrollment = SimpleNamespace(id=uuid4(), status=EnrollmentStatus.REGISTERED)
    followup = build._invoice_for_payment(
        MagicMock(),
        enrollment,
        payment,
        actor="public",
        request_id=None,
        send_email=True,
        display_name="Ada Example",
        require_catalogue_match=True,
    )
    assert followup.invoice_status == BillingInvoiceStatus.DRAFT.value
    assert followup.warning is not None
    assert "catalogue" in followup.warning
    assert followup.email_to is None


def test_catalogue_match_issues_and_queues_the_attendee_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENROLLMENT_AUTO_INVOICE", "true")
    invoice = SimpleNamespace(
        id=uuid4(),
        invoice_number=None,
        status=BillingInvoiceStatus.DRAFT,
        bill_to_email="ada@example.com",
    )

    def _issue(*_args: object, **_kwargs: object) -> None:
        invoice.status = BillingInvoiceStatus.ISSUED
        invoice.invoice_number = "INV-2026-000001"

    monkeypatch.setattr(build, "open_invoice_enrollment_ids", lambda *_a, **_k: set())
    monkeypatch.setattr(build, "_draft_invoice", lambda *_a, **_k: invoice)
    monkeypatch.setattr(
        build, "catalogue_charge", lambda *_a, **_k: (Decimal(100), "HKD")
    )
    monkeypatch.setattr(build, "issue_draft_invoice", _issue)
    monkeypatch.setattr(build, "allocate_succeeded_payment", lambda *_a, **_k: None)
    monkeypatch.setattr(
        build, "receipt_for_positive_succeeded_payment", lambda *_a, **_k: None
    )
    payment = SimpleNamespace(
        id=uuid4(),
        amount=Decimal(100),
        currency="HKD",
        status=BillingPaymentStatus.SUCCEEDED,
    )
    enrollment = SimpleNamespace(id=uuid4(), status=EnrollmentStatus.REGISTERED)
    followup = build._invoice_for_payment(
        MagicMock(),
        enrollment,
        payment,
        actor="public",
        request_id=None,
        send_email=True,
        display_name="Ada Example",
        require_catalogue_match=True,
    )
    assert followup.invoice_number == "INV-2026-000001"
    assert followup.email_to == "ada@example.com"


def test_pending_payment_is_not_allocated() -> None:
    session = MagicMock()
    payment = SimpleNamespace(
        id=uuid4(),
        status=BillingPaymentStatus.PENDING,
        currency="HKD",
        amount=Decimal(10),
    )
    invoice = SimpleNamespace(
        currency="HKD", total=Decimal(10), amount_allocated=Decimal(0)
    )
    build.allocate_succeeded_payment(session, payment, invoice)
    session.add.assert_not_called()


def test_bill_later_and_free_enrollments_do_not_invoice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enrollment = SimpleNamespace(id=uuid4(), status=EnrollmentStatus.REGISTERED)
    followup = billing.apply_admin_enrollment_billing(
        MagicMock(),
        enrollment,
        {"bill_later": True, "payment_method": "fps"},
        actor="staff",
        request_id=None,
    )
    assert followup.payment_id is None
    assert followup.invoice_id is None

    payment = SimpleNamespace(id=uuid4(), amount=Decimal(0), currency="HKD")
    monkeypatch.setattr(billing, "_record_admin_payment", lambda *_a, **_k: payment)
    monkeypatch.setattr(
        billing,
        "_invoice_for_payment",
        lambda *_a, **_k: pytest.fail("a free enrollment has no invoice"),
    )
    free = billing.apply_admin_enrollment_billing(
        MagicMock(),
        enrollment,
        {"bill_later": False, "payment_received": False},
        actor="staff",
        request_id=None,
    )
    assert free.payment_id == payment.id
    assert free.invoice_id is None


def _issued_invoice(*, allocated: Decimal, number: str) -> CustomerInvoice:
    return CustomerInvoice(
        id=uuid4(),
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        subtotal=Decimal(40),
        tax_total=Decimal(0),
        total=Decimal(40),
        amount_allocated=allocated,
        invoice_number=number,
    )


def test_cancelling_an_unpaid_invoice_voids_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invoice = _issued_invoice(allocated=Decimal(0), number="INV-2026-000002")
    session = MagicMock()
    session.execute.return_value.all.return_value = [(SimpleNamespace(), invoice)]
    session.scalar.return_value = 0
    monkeypatch.setattr(billing, "recompute_invoice_settlement", lambda *_a, **_k: None)
    monkeypatch.setattr(
        billing,
        "AuditService",
        lambda *_a, **_k: SimpleNamespace(log_custom=lambda **_kw: None),
    )
    enrollment = SimpleNamespace(id=uuid4(), notes=None)
    warning = billing.release_billing_for_cancelled_enrollment(
        session, enrollment, actor="staff"
    )
    assert warning is None
    assert invoice.status == BillingInvoiceStatus.VOID
    assert invoice.void_reason == "Enrollment cancelled"


def test_cancelling_a_paid_invoice_keeps_it_and_flags_a_refund() -> None:
    invoice = _issued_invoice(allocated=Decimal(40), number="INV-2026-000003")
    session = MagicMock()
    session.execute.return_value.all.return_value = [(SimpleNamespace(), invoice)]
    session.scalar.return_value = 0
    enrollment = SimpleNamespace(id=uuid4(), notes=None)
    warning = billing.release_billing_for_cancelled_enrollment(
        session, enrollment, actor="staff"
    )
    assert invoice.status == BillingInvoiceStatus.ISSUED
    assert warning is not None
    assert "Refund required" in warning
    assert enrollment.notes is not None
    assert "Refund required" in enrollment.notes


def test_amount_edit_is_blocked_once_an_invoice_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enrollment = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(
        billing,
        "open_invoice_enrollment_ids",
        lambda _session, ids: set(ids),
    )
    with pytest.raises(ConflictError, match="enrollment_invoiced"):
        billing.assert_enrollment_amount_unlocked(MagicMock(), enrollment)


def test_create_payload_billing_is_absent_for_the_legacy_client() -> None:
    contact_id = str(uuid4())
    legacy = parse_create_enrollment_payload({"contact_id": contact_id})
    assert legacy["billing"] is None
    billed = parse_create_enrollment_payload(
        {
            "contact_id": contact_id,
            "payment_received": True,
            "send_invoice_email": False,
        }
    )
    assert billed["billing"] == {
        "bill_later": False,
        "payment_method": "fps",
        "payment_received": True,
        "send_invoice_email": False,
    }
