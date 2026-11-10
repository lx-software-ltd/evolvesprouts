"""Enrollment payment and invoice orchestration."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from app.api.admin_enrollments_payloads import parse_create_enrollment_payload
from app.db.models.customer_invoice import CustomerInvoice, CustomerInvoiceLine
from app.db.models.customer_payment import CustomerPayment
from app.db.models.enums import (
    BillingInvoiceStatus,
    BillingPaymentDirection,
    BillingPaymentStatus,
    ConsultationPricingModel,
    DiscountType,
    EnrollmentStatus,
    ServiceType,
)
from app.exceptions import ConflictError, ValidationError
from app.services import enrollment_billing as billing
from app.services import enrollment_billing_release as release
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
    website = build.invoice_for_payment(
        MagicMock(),
        enrollment,
        payment,
        actor="public",
        request_id=None,
        send_email=True,
        display_name=None,
        require_catalogue_match=False,
        receipt_when_uninvoiced=False,
    )
    assert website.invoice_id is None
    assert website.receipt_id is None
    admin = build.invoice_for_payment(
        MagicMock(),
        enrollment,
        payment,
        actor="staff",
        request_id=None,
        send_email=False,
        display_name=None,
        require_catalogue_match=False,
        receipt_when_uninvoiced=True,
    )
    assert admin.invoice_id is None
    assert admin.receipt_id == receipt_id


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
    followup = build.invoice_for_payment(
        MagicMock(),
        enrollment,
        payment,
        actor="public",
        request_id=None,
        send_email=True,
        display_name="Ada Example",
        require_catalogue_match=True,
        receipt_when_uninvoiced=False,
    )
    assert followup.invoice_status == BillingInvoiceStatus.DRAFT.value
    assert followup.warning is not None
    assert "does not match" in followup.warning
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
        invoice.issued_pdf_s3_key = "billing/invoices/issued.pdf"

    monkeypatch.setattr(build, "open_invoice_enrollment_ids", lambda *_a, **_k: set())
    monkeypatch.setattr(build, "_draft_invoice", lambda *_a, **_k: invoice)
    monkeypatch.setattr(
        build, "catalogue_charge", lambda *_a, **_k: (Decimal(100), "HKD")
    )
    monkeypatch.setattr(build, "issue_draft_invoice", _issue)
    monkeypatch.setattr(build, "allocate_succeeded_payment", lambda *_a, **_k: None)
    monkeypatch.setattr(build, "refresh_invoice_pdf", lambda *_a, **_k: None)
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
    followup = build.invoice_for_payment(
        MagicMock(),
        enrollment,
        payment,
        actor="public",
        request_id=None,
        send_email=True,
        display_name="Ada Example",
        require_catalogue_match=True,
        receipt_when_uninvoiced=False,
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

    payment = SimpleNamespace(
        id=uuid4(),
        amount=Decimal(0),
        currency="HKD",
        status=BillingPaymentStatus.SUCCEEDED,
    )
    monkeypatch.setattr(billing, "_record_admin_payment", lambda *_a, **_k: payment)
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


class _ResultRow:
    """Positional row that is not a tuple, matching SQLAlchemy's ``Row``."""

    def __init__(self, *values: object) -> None:
        self._values = values

    def __getitem__(self, index: int) -> object:
        return self._values[index]


def test_cancelling_an_unpaid_invoice_voids_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invoice = _issued_invoice(allocated=Decimal(0), number="INV-2026-000002")
    line = CustomerInvoiceLine(
        invoice_id=invoice.id,
        line_order=0,
        description="Seat",
        quantity=Decimal(1),
        unit_amount=Decimal(40),
        line_total=Decimal(40),
        currency="HKD",
    )
    session = MagicMock()
    session.execute.return_value.all.return_value = [_ResultRow(line, invoice)]
    session.scalar.return_value = 0
    session.scalars.return_value.all.return_value = []
    monkeypatch.setattr(release, "recompute_invoice_settlement", lambda *_a, **_k: None)
    monkeypatch.setattr(
        release,
        "AuditService",
        lambda *_a, **_k: SimpleNamespace(log_custom=lambda **_kw: None),
    )
    enrollment = SimpleNamespace(id=uuid4(), notes=None)
    warning = release.release_billing_for_cancelled_enrollment(
        session, enrollment, actor="staff"
    )
    assert warning is None
    assert invoice.status == BillingInvoiceStatus.VOID
    assert invoice.void_reason == "Enrollment cancelled"


def test_cancelling_a_paid_invoice_keeps_it_and_flags_a_refund() -> None:
    invoice = _issued_invoice(allocated=Decimal(40), number="INV-2026-000003")
    line = CustomerInvoiceLine(
        invoice_id=invoice.id,
        line_order=0,
        description="Seat",
        quantity=Decimal(1),
        unit_amount=Decimal(40),
        line_total=Decimal(40),
        currency="HKD",
    )
    session = MagicMock()
    session.execute.return_value.all.return_value = [_ResultRow(line, invoice)]
    session.scalar.return_value = 0
    session.scalars.return_value.all.return_value = []
    enrollment = SimpleNamespace(id=uuid4(), notes=None)
    warning = release.release_billing_for_cancelled_enrollment(
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


def test_unchanged_amount_and_currency_are_not_an_edit() -> None:
    enrollment = SimpleNamespace(amount_paid=Decimal("480.00"), currency="HKD")
    assert (
        billing.enrollment_charge_is_changing(
            enrollment, {"amount_paid": "480", "currency": "hkd", "notes": "later"}
        )
        is False
    )
    assert (
        billing.enrollment_charge_is_changing(enrollment, {"amount_paid": "481"})
        is True
    )


def test_cancelled_and_waitlisted_admin_billing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cancelled = SimpleNamespace(id=uuid4(), status=EnrollmentStatus.CANCELLED)
    monkeypatch.setattr(
        billing,
        "_record_admin_payment",
        lambda *_a, **_k: pytest.fail("a cancelled enrollment is not billed"),
    )
    empty = billing.apply_admin_enrollment_billing(
        MagicMock(),
        cancelled,
        {"bill_later": False, "payment_received": True},
        actor="staff",
        request_id=None,
    )
    assert empty.payment_id is None

    payment = SimpleNamespace(
        id=uuid4(),
        amount=Decimal(20),
        currency="HKD",
        status=BillingPaymentStatus.PENDING,
    )
    monkeypatch.setattr(billing, "_record_admin_payment", lambda *_a, **_k: payment)
    waiting = SimpleNamespace(id=uuid4(), status=EnrollmentStatus.WAITLISTED)
    followup = billing.apply_admin_enrollment_billing(
        MagicMock(),
        waiting,
        {"bill_later": False, "payment_method": "cash", "payment_received": False},
        actor="staff",
        request_id=None,
    )
    assert followup.payment_id == payment.id
    assert followup.invoice_id is None


def test_promotion_does_not_invent_a_payment(monkeypatch: pytest.MonkeyPatch) -> None:
    enrollment = SimpleNamespace(
        id=uuid4(),
        status=EnrollmentStatus.REGISTERED,
        amount_paid=Decimal(80),
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    monkeypatch.setattr(
        billing,
        "apply_admin_enrollment_billing",
        lambda *_a, **_k: pytest.fail("promotion must not invent a payment"),
    )
    followup = billing.bill_promoted_enrollment(
        session, enrollment, actor="staff", request_id=None
    )
    assert followup.payment_id is None


def test_cancelling_an_unallocated_card_payment_flags_a_refund() -> None:
    invoice = _issued_invoice(allocated=Decimal(0), number="INV-2026-000004")
    line = CustomerInvoiceLine(
        invoice_id=invoice.id,
        line_order=0,
        description="Seat",
        quantity=Decimal(1),
        unit_amount=Decimal(40),
        line_total=Decimal(40),
        currency="HKD",
    )
    session = MagicMock()
    session.execute.return_value.all.return_value = [_ResultRow(line, invoice)]
    session.scalar.side_effect = [0, 1]
    session.scalars.return_value.all.return_value = []
    enrollment = SimpleNamespace(id=uuid4(), notes=None)
    warning = release.release_billing_for_cancelled_enrollment(
        session, enrollment, actor="staff"
    )
    assert invoice.status == BillingInvoiceStatus.ISSUED
    assert warning is not None
    assert "Refund required" in warning


def test_several_ticket_tiers_and_hourly_consultations_have_no_catalogue_price() -> (
    None
):
    tiers = [
        SimpleNamespace(
            id=uuid4(),
            price=Decimal(100),
            currency="HKD",
            sort_order=0,
            created_at=1,
        ),
        SimpleNamespace(
            id=uuid4(),
            price=Decimal(200),
            currency="HKD",
            sort_order=1,
            created_at=2,
        ),
    ]
    event = SimpleNamespace(
        ticket_tier_id=None,
        discount_code_id=None,
        discount_code=None,
        instance=SimpleNamespace(
            ticket_tiers=tiers,
            service=SimpleNamespace(service_type=ServiceType.EVENT, event_details=None),
        ),
    )
    assert build.catalogue_charge(MagicMock(), event) is None
    hourly = SimpleNamespace(
        ticket_tier_id=None,
        discount_code_id=None,
        discount_code=None,
        instance=SimpleNamespace(
            service=SimpleNamespace(
                service_type=ServiceType.CONSULTATION,
                consultation_details=SimpleNamespace(
                    pricing_model=ConsultationPricingModel.HOURLY,
                    default_hourly_rate=Decimal(100),
                    default_currency="HKD",
                ),
            )
        ),
    )
    assert build.catalogue_charge(MagicMock(), hourly) is None


def test_unknown_catalogue_price_stays_a_draft(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENROLLMENT_AUTO_INVOICE", "on")
    invoice = SimpleNamespace(
        id=uuid4(),
        invoice_number=None,
        status=BillingInvoiceStatus.DRAFT,
        bill_to_email=None,
    )
    monkeypatch.setattr(build, "open_invoice_enrollment_ids", lambda *_a, **_k: set())
    monkeypatch.setattr(build, "_draft_invoice", lambda *_a, **_k: invoice)
    monkeypatch.setattr(build, "catalogue_charge", lambda *_a, **_k: None)
    monkeypatch.setattr(
        build,
        "issue_draft_invoice",
        lambda *_a, **_k: pytest.fail("unknown price must stay a draft"),
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
    followup = build.invoice_for_payment(
        MagicMock(),
        enrollment,
        payment,
        actor="public",
        request_id=None,
        send_email=True,
        display_name="Ada Example",
        require_catalogue_match=True,
        receipt_when_uninvoiced=False,
    )
    assert followup.invoice_status == BillingInvoiceStatus.DRAFT.value
    assert followup.warning is not None
    assert "could not be determined" in followup.warning


def test_confirm_does_not_allocate_when_the_flag_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ENROLLMENT_AUTO_INVOICE", raising=False)
    session = MagicMock()
    payment = SimpleNamespace(
        id=uuid4(),
        enrollment_id=uuid4(),
        amount=Decimal(10),
        currency="HKD",
        status=BillingPaymentStatus.SUCCEEDED,
    )
    billing.settle_confirmed_payment(session, payment)
    session.execute.assert_not_called()


def test_blank_currency_matches_the_default() -> None:
    enrollment = SimpleNamespace(amount_paid=Decimal("480.00"), currency=None)
    assert (
        billing.enrollment_charge_is_changing(enrollment, {"currency": "HKD"}) is False
    )
    assert (
        billing.enrollment_charge_is_changing(enrollment, {"currency": "USD"}) is True
    )


def test_cancel_count_includes_lines_with_no_enrollment() -> None:
    from sqlalchemy.dialects import postgresql

    statement = release.other_charge_count_select(uuid4(), uuid4())
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "IS NULL" in sql


def test_cancelling_a_shared_unpaid_invoice_does_not_void_it() -> None:
    invoice = _issued_invoice(allocated=Decimal(0), number="INV-2026-000005")
    line = CustomerInvoiceLine(
        invoice_id=invoice.id,
        line_order=0,
        description="Seat",
        quantity=Decimal(1),
        unit_amount=Decimal(40),
        line_total=Decimal(40),
        currency="HKD",
    )
    session = MagicMock()
    session.execute.return_value.all.return_value = [_ResultRow(line, invoice)]
    session.scalar.side_effect = [1, 0]
    session.scalars.return_value.all.return_value = []
    enrollment = SimpleNamespace(id=uuid4(), notes=None)
    warning = release.release_billing_for_cancelled_enrollment(
        session, enrollment, actor="staff"
    )
    assert invoice.status == BillingInvoiceStatus.ISSUED
    assert warning is not None
    assert "other charges" in warning
    assert "Refund required" not in warning


def test_pending_payment_follows_a_waitlist_amount_edit() -> None:
    enrollment = SimpleNamespace(
        id=uuid4(), amount_paid=Decimal("500.00"), currency="HKD"
    )
    payment = CustomerPayment(
        direction=BillingPaymentDirection.INBOUND,
        status=BillingPaymentStatus.PENDING,
        method="fps",
        amount=Decimal("480.00"),
        currency="HKD",
        enrollment_id=enrollment.id,
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [payment]
    session.scalar.return_value = 0
    release.align_uninvoiced_enrollment_payment(session, enrollment)
    assert payment.amount == Decimal("500.00")


def test_received_payment_blocks_a_different_charge() -> None:
    enrollment = SimpleNamespace(
        id=uuid4(), amount_paid=Decimal("500.00"), currency="HKD"
    )
    payment = CustomerPayment(
        direction=BillingPaymentDirection.INBOUND,
        status=BillingPaymentStatus.SUCCEEDED,
        method="fps",
        amount=Decimal("480.00"),
        currency="HKD",
        enrollment_id=enrollment.id,
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [payment]
    with pytest.raises(ValidationError, match="received payment"):
        release.align_uninvoiced_enrollment_payment(session, enrollment)


def test_promotion_does_not_invoice_a_mismatched_payment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payment = CustomerPayment(
        id=uuid4(),
        direction=BillingPaymentDirection.INBOUND,
        status=BillingPaymentStatus.PENDING,
        method="fps",
        amount=Decimal("20.00"),
        currency="HKD",
    )
    payment.status = BillingPaymentStatus.PENDING
    enrollment = SimpleNamespace(
        id=uuid4(),
        status=EnrollmentStatus.REGISTERED,
        amount_paid=Decimal("80.00"),
        currency="HKD",
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [payment]
    monkeypatch.setattr(
        billing,
        "invoice_for_payment",
        lambda *_a, **_k: pytest.fail("a mismatched payment is not invoiced"),
    )
    followup = billing.bill_promoted_enrollment(
        session, enrollment, actor="staff", request_id=None
    )
    assert followup.invoice_id is None
    assert followup.warning is not None
    assert "does not match" in followup.warning


def test_promotion_emails_when_the_enrollment_asked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payment = CustomerPayment(
        id=uuid4(),
        direction=BillingPaymentDirection.INBOUND,
        status=BillingPaymentStatus.SUCCEEDED,
        method="fps",
        amount=Decimal("80.00"),
        currency="HKD",
    )
    enrollment = SimpleNamespace(
        id=uuid4(),
        status=EnrollmentStatus.CONFIRMED,
        amount_paid=Decimal("80.00"),
        currency="HKD",
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [payment]
    seen: dict[str, object] = {}

    def _invoice(*_args: object, **kwargs: object) -> billing.BillingFollowup:
        seen["send_email"] = kwargs.get("send_email")
        return billing.BillingFollowup()

    monkeypatch.setattr(billing, "invoice_for_payment", _invoice)
    monkeypatch.setattr(release, "invoice_email_requested", lambda *_a, **_k: True)
    billing.bill_promoted_enrollment(
        session, enrollment, actor="staff", request_id=None
    )
    assert seen["send_email"] is True


def test_allocation_failure_keeps_the_issued_invoice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENROLLMENT_AUTO_INVOICE", "on")
    invoice = SimpleNamespace(
        id=uuid4(),
        status=BillingInvoiceStatus.ISSUED,
        invoice_number="INV-2026-000006",
        bill_to_email=None,
        issued_pdf_s3_key="billing/invoices/existing.pdf",
    )
    monkeypatch.setattr(build, "open_invoice_enrollment_ids", lambda *_a, **_k: set())
    monkeypatch.setattr(build, "_draft_invoice", lambda *_a, **_k: invoice)
    monkeypatch.setattr(build, "issue_draft_invoice", lambda *_a, **_k: None)
    monkeypatch.setattr(
        build, "receipt_for_positive_succeeded_payment", lambda *_a, **_k: None
    )

    def _fail(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("allocation failed")

    monkeypatch.setattr(build, "allocate_succeeded_payment", _fail)
    payment = SimpleNamespace(
        id=uuid4(),
        amount=Decimal(40),
        currency="HKD",
        status=BillingPaymentStatus.SUCCEEDED,
    )
    enrollment = SimpleNamespace(id=uuid4(), status=EnrollmentStatus.REGISTERED)
    followup = build.invoice_for_payment(
        MagicMock(),
        enrollment,
        payment,
        actor="staff",
        request_id=None,
        send_email=False,
        display_name=None,
        require_catalogue_match=False,
        receipt_when_uninvoiced=True,
    )
    assert followup.invoice_id == invoice.id
    assert followup.warning is not None
    assert "not allocated" in followup.warning
    assert "PDF" not in followup.warning


def test_settle_failure_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENROLLMENT_AUTO_INVOICE", "on")

    def _fail(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("settle failed")

    monkeypatch.setattr(release, "allocate_confirmed_payment", _fail)
    payment = SimpleNamespace(
        id=uuid4(),
        enrollment_id=uuid4(),
        amount=Decimal(10),
        currency="HKD",
        status=BillingPaymentStatus.SUCCEEDED,
    )
    billing.settle_confirmed_payment(MagicMock(), payment)


def test_paid_invoice_drops_the_pending_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    invoice = CustomerInvoice(
        id=uuid4(),
        status=BillingInvoiceStatus.ISSUED,
        currency="HKD",
        subtotal=Decimal(40),
        tax_total=Decimal(0),
        total=Decimal(40),
        balance_due=Decimal(0),
    )
    stub = CustomerPayment(
        id=uuid4(),
        direction=BillingPaymentDirection.INBOUND,
        status=BillingPaymentStatus.PENDING,
        method="fps",
        amount=Decimal(40),
        currency="HKD",
    )
    received = CustomerPayment(
        id=uuid4(),
        direction=BillingPaymentDirection.INBOUND,
        status=BillingPaymentStatus.SUCCEEDED,
        method="fps",
        amount=Decimal(40),
        currency="HKD",
        enrollment_id=uuid4(),
        confirmed_by="staff",
    )
    session = MagicMock()
    session.execute.return_value.scalars.return_value.all.return_value = [invoice]
    session.scalars.return_value.all.return_value = [stub]
    session.scalar.return_value = 0
    monkeypatch.setattr(release, "allocate_succeeded_payment", lambda *_a, **_k: None)
    monkeypatch.setattr(
        release,
        "AuditService",
        lambda *_a, **_k: SimpleNamespace(log_custom=lambda **_kw: None),
    )
    release.allocate_confirmed_payment(session, received)
    session.delete.assert_called_once_with(stub)
