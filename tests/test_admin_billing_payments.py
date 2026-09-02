"""Tests for admin billing payments (create, update, delete, refunds)."""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.api import admin_billing
from app.api import admin_billing_payment_create as admin_billing_payment_create_mod
from app.api import admin_billing_payment_update as admin_billing_payment_update_mod
from app.api import admin_billing_payments as admin_billing_payments_mod
from app.api import (
    admin_billing_payments_serializers as admin_billing_payments_serializers_mod,
)
from app.db.models import Enrollment
from app.db.models.customer_payment import CustomerPayment
from app.db.models.enums import (
    BillingBillToKind,
    BillingPaymentDirection,
    BillingPaymentStatus,
    EnrollmentStatus,
)
from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.services import customer_billing

from tests.helpers.billing import patch_billing_sessions


def test_handle_admin_billing_get_payment_and_wrong_method_statuses(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GET payment serialises via ``event``; wrong method is 405 and unknown sub-path 404."""
    pid = uuid4()

    class _FakePay:
        id = pid
        direction = MagicMock(value="inbound")
        status = MagicMock(value="succeeded")
        method = "stripe_card"
        amount = Decimal("10")
        currency = "HKD"
        original_payment_id = None
        stripe_payment_intent_id = "pi_test"
        stripe_refund_id = None
        enrollment_id = None
        contact_id = None
        succeeded_at = None
        external_reference = "REF-OUT-1"
        created_at = MagicMock(isoformat=lambda: "2026-01-01T00:00:00+00:00")

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.return_value = _FakePay()
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {r.id: False for r in rows},
    )
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("3"),
    )

    ev = api_gateway_event(
        method="GET",
        path=f"/v1/admin/billing/payments/{pid}",
        authorizer_context=admin_identity,
    )
    r1 = admin_billing.handle_admin_billing_request(
        ev, "GET", f"/v1/admin/billing/payments/{pid}"
    )
    assert r1["statusCode"] == 200
    body1 = json.loads(r1["body"])
    assert body1["unappliedAmount"] == "3"
    assert body1["orphanPaymentDeletable"] is False
    assert body1["externalReference"] == "REF-OUT-1"

    ev2 = api_gateway_event(
        method="PUT",
        path=f"/v1/admin/billing/payments/{pid}",
        authorizer_context=admin_identity,
    )
    r2 = admin_billing.handle_admin_billing_request(
        ev2, "PUT", f"/v1/admin/billing/payments/{pid}"
    )
    assert r2["statusCode"] == 405

    ev3 = api_gateway_event(
        method="GET",
        path=f"/v1/admin/billing/payments/{pid}/unapplied",
        authorizer_context=admin_identity,
    )
    r3 = admin_billing.handle_admin_billing_request(
        ev3, "GET", f"/v1/admin/billing/payments/{pid}/unapplied"
    )
    assert r3["statusCode"] == 404


def test_payment_unapplied_amount_subtracts_allocations() -> None:
    pid = uuid4()
    pay = MagicMock()
    pay.amount = Decimal("100")
    session = MagicMock()
    session.get.return_value = pay
    m = MagicMock()
    m.scalar_one.return_value = Decimal("35")
    session.execute.return_value = m
    assert customer_billing.payment_unapplied_amount(session, pid) == Decimal("65")


@pytest.mark.parametrize("allocated", ("0", "0.00", "-1"))
def test_create_payment_allocation_rejects_non_positive_allocated_amount(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    allocated: str,
) -> None:
    """Zero or negative allocations violate DB CHECK; reject before flush (no 500)."""
    body = {
        "paymentId": str(uuid4()),
        "invoiceId": str(uuid4()),
        "allocatedAmount": allocated,
        "currency": "HKD",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/allocations",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="greater than zero"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/allocations"
        )


def test_confirm_payment_creates_receipt_for_pending_inbound(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pid = uuid4()
    created = {"n": 0}

    class _Pending:
        id = pid
        direction = BillingPaymentDirection.INBOUND
        status = BillingPaymentStatus.PENDING
        method = "bank_transfer"
        amount = Decimal("50")
        currency = "HKD"
        original_payment_id = None
        stripe_payment_intent_id = None
        stripe_refund_id = None
        enrollment_id = None
        contact_id = None
        succeeded_at = None
        created_at = MagicMock(isoformat=lambda: "2026-01-01T00:00:00+00:00")

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is admin_billing_payments_mod.CustomerPayment and pk == pid:
                return _Pending()
            if model is admin_billing_payments_mod.CustomerReceipt:
                return None
            return None

        s.get.side_effect = _get
        ex = MagicMock()
        ex.scalar_one_or_none.return_value = None
        s.execute.return_value = ex
        yield s

    def _create_rcpt(_session: Any, *, payment: Any) -> MagicMock:
        created["n"] += 1
        return MagicMock()

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("50"),
    )
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {r.id: False for r in rows},
    )
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "create_receipt_for_succeeded_inbound_payment",
        _create_rcpt,
    )
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "finalize_receipt_pdf_upload",
        lambda *_a, **_k: None,
    )

    ev = api_gateway_event(
        method="POST",
        path=f"/v1/admin/billing/payments/{pid}/confirm",
        body="{}",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", f"/v1/admin/billing/payments/{pid}/confirm"
    )
    assert r["statusCode"] == 200
    assert created["n"] == 1


def test_delete_orphan_payment_succeeds(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pid = uuid4()
    pay = MagicMock()
    pay.id = pid
    pay.to_audit_dict.return_value = {"id": str(pid)}
    holder: dict[str, Any] = {}

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        holder["s"] = s

        def _get(model: Any, pk: Any) -> Any:
            if model is admin_billing_payments_mod.CustomerPayment and pk == pid:
                return pay
            return None

        s.get.side_effect = _get
        yield s

    class _FakeAudit:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            pass

        def log_custom(self, **_kw: Any) -> None:
            return None

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_mod, "_validate_orphan_delete", lambda *_a, **_k: None
    )
    monkeypatch.setattr(admin_billing_payments_mod, "AuditService", _FakeAudit)

    ev = api_gateway_event(
        method="DELETE",
        path=f"/v1/admin/billing/payments/{pid}",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "DELETE", f"/v1/admin/billing/payments/{pid}"
    )
    assert r["statusCode"] == 204
    assert json.loads(r["body"]) == {}
    holder["s"].delete.assert_called_once_with(pay)


def test_delete_no_enrollment_pending_payment_succeeds(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pid = uuid4()
    pay = MagicMock()
    pay.id = pid
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = None
    pay.method = "bank_transfer"
    pay.amount = Decimal("10")
    pay.to_audit_dict.return_value = {"id": str(pid)}
    holder: dict[str, Any] = {}

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        holder["s"] = s

        def _get(model: Any, pk: Any) -> Any:
            if model is admin_billing_payments_mod.CustomerPayment and pk == pid:
                return pay
            return None

        s.get.side_effect = _get
        ex = MagicMock()
        ex.scalar_one.return_value = False
        s.execute.return_value = ex
        yield s

    class _FakeAudit:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            pass

        def log_custom(self, **_kw: Any) -> None:
            return None

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(admin_billing_payments_mod, "AuditService", _FakeAudit)

    ev = api_gateway_event(
        method="DELETE",
        path=f"/v1/admin/billing/payments/{pid}",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "DELETE", f"/v1/admin/billing/payments/{pid}"
    )
    assert r["statusCode"] == 204
    holder["s"].delete.assert_called_once_with(pay)


def test_delete_orphan_payment_not_found_raises(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pid = uuid4()

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.return_value = None
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    ev = api_gateway_event(
        method="DELETE",
        path=f"/v1/admin/billing/payments/{pid}",
        authorizer_context=admin_identity,
    )
    with pytest.raises(NotFoundError):
        admin_billing.handle_admin_billing_request(
            ev, "DELETE", f"/v1/admin/billing/payments/{pid}"
        )


def test_refund_create_rejects_currency_mismatch_with_original(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    orig_id = uuid4()

    class _Orig:
        id = orig_id
        currency = "HKD"

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.return_value = _Orig()
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    body = {
        "direction": "refund",
        "originalPaymentId": str(orig_id),
        "amount": "10",
        "currency": "USD",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="currency"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )


def test_create_payment_returns_400_on_invalid_amount(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    orig_id = uuid4()

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield MagicMock()

    patch_billing_sessions(monkeypatch, _fake_session)

    body = {
        "direction": "refund",
        "originalPaymentId": str(orig_id),
        "amount": "not-a-number",
        "currency": "HKD",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="amount"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )


def test_create_payment_requires_direction(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield MagicMock()

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {"originalPaymentId": str(uuid4()), "amount": "1", "currency": "HKD"}
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="direction"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )


def test_manual_inbound_payment_without_enrollment_succeeds(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    new_pid = uuid4()
    added: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(_model: Any, _pk: Any) -> Any:
            return None

        s.get.side_effect = _get

        def _add(obj: Any) -> None:
            added.append(obj)

        def _flush() -> None:
            obj = added[-1]
            obj.id = new_pid
            obj.created_at = datetime(2026, 1, 1, tzinfo=UTC)

        s.add.side_effect = _add
        s.flush.side_effect = _flush
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "AuditService",
        lambda *_a, **_k: MagicMock(log_custom=lambda **_kw: None),
    )

    body = {
        "direction": "inbound",
        "amount": "12",
        "currency": "HKD",
        "method": "fps",
        "status": "pending",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/payments"
    )
    assert r["statusCode"] == 201
    assert len(added) == 1
    assert added[0].enrollment_id is None
    assert added[0].contact_id is None


def test_manual_inbound_payment_without_enrollment_contact_not_found(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = uuid4()

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.return_value = None
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {
        "direction": "inbound",
        "amount": "10",
        "currency": "HKD",
        "method": "fps",
        "contactId": str(cid),
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(NotFoundError, match="Contact"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )


def test_manual_inbound_payment_without_enrollment_still_validates_currency(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield MagicMock()

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {"direction": "inbound", "amount": "10", "method": "fps"}
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="currency") as ei:
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )
    assert ei.value.field == "currency"


def test_manual_inbound_payment_without_enrollment_still_validates_method(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        yield MagicMock()

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {"direction": "inbound", "amount": "10", "currency": "HKD"}
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="method") as ei:
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )
    assert ei.value.field == "method"


def test_manual_inbound_payment_enrollment_not_found(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is Enrollment and pk == eid:
                return None
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {
        "direction": "inbound",
        "enrollmentId": str(eid),
        "amount": "10",
        "currency": "HKD",
        "method": "fps",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(NotFoundError, match="Enrollment"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )


def test_patch_manual_inbound_payment_not_found(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(_model: Any, _pk: Any) -> Any:
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {
        "amount": "10",
        "currency": "HKD",
        "method": "fps",
        "status": "pending",
        "externalReference": None,
    }
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(NotFoundError, match="CustomerPayment"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_patch_manual_inbound_payment_rejects_stripe_linked(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = "pi_abc"
    pay.enrollment_id = eid
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {
        "amount": "10",
        "currency": "HKD",
        "method": "fps",
        "status": "pending",
        "externalReference": None,
    }
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="Stripe-linked"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_patch_manual_inbound_payment_rejects_refund_direction(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.REFUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = uuid4()
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: pay if model is CustomerPayment and pk == pay_id else None
        )
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {
        "amount": "10",
        "currency": "HKD",
        "method": "fps",
        "status": "pending",
    }
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="Only inbound"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_patch_manual_inbound_payment_no_enrollment_succeeds(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = None
    pay.amount = Decimal("10")
    pay.currency = "HKD"
    pay.method = "bank_transfer"
    pay.contact_id = uuid4()
    pay.external_reference = None
    pay.succeeded_at = None
    pay.confirmed_by = None
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: pay if model is CustomerPayment and pk == pay_id else None
        )
        ex = MagicMock()
        ex.scalar_one_or_none.return_value = None
        s.execute.return_value = ex
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "_batch_party_label_by_payment",
        lambda _session, rows: {rows[0].id: "Pat"},
    )
    mock_audit = MagicMock()
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "AuditService",
        lambda *_a, **_k: mock_audit,
    )

    body = {
        "amount": "25",
        "currency": "HKD",
        "method": "fps",
        "status": "pending",
        "externalReference": None,
    }
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
    )
    assert r["statusCode"] == 200
    assert pay.amount == Decimal("25")
    assert pay.method == "fps"


def test_patch_manual_inbound_payment_no_enrollment_transitions_to_succeeded(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = None
    pay.amount = Decimal("10")
    pay.currency = "HKD"
    pay.method = "bank_transfer"
    pay.contact_id = uuid4()
    pay.external_reference = None
    pay.succeeded_at = None
    pay.confirmed_by = None
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: pay if model is CustomerPayment and pk == pay_id else None
        )
        ex = MagicMock()
        ex.scalar_one_or_none.return_value = None
        s.execute.return_value = ex
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "_batch_party_label_by_payment",
        lambda _session, rows: {rows[0].id: "Pat"},
    )
    mock_audit = MagicMock()
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "AuditService",
        lambda *_a, **_k: mock_audit,
    )
    created: list[Any] = []

    def _spy_create_rcpt(_session: Any, *, payment: Any) -> MagicMock:
        created.append(payment)
        return MagicMock()

    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "create_receipt_for_succeeded_inbound_payment",
        _spy_create_rcpt,
    )
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "finalize_receipt_pdf_upload",
        lambda *_a, **_k: None,
    )

    body = {
        "amount": "10",
        "currency": "HKD",
        "method": "bank_transfer",
        "status": "succeeded",
        "externalReference": None,
    }
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
    )
    assert r["statusCode"] == 200
    assert pay.status == BillingPaymentStatus.SUCCEEDED
    assert len(created) == 1


def test_patch_manual_inbound_payment_rejects_cancelled_enrollment(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CANCELLED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    body = {"amount": "10", "currency": "HKD", "method": "fps", "status": "pending"}
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="cancelled enrollment"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_patch_manual_inbound_payment_rejects_currency_mismatch(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.currency = "HKD"
    pay.amount = Decimal("10")
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    body = {"amount": "10", "currency": "USD", "method": "fps", "status": "pending"}
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="billing currency"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_patch_manual_inbound_payment_rejects_amount_below_allocated(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.amount = Decimal("10")
    pay.currency = "HKD"
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("3"),
    )
    body = {"amount": "5", "currency": "HKD", "method": "fps", "status": "pending"}
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="allocated to invoices"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_patch_manual_inbound_payment_pending_free_zero_coerces(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.amount = Decimal("10")
    pay.currency = "HKD"
    pay.method = "bank_transfer"
    pay.contact_id = uuid4()
    pay.external_reference = None
    pay.succeeded_at = None
    pay.confirmed_by = None
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        ex = MagicMock()
        ex.scalar_one_or_none.return_value = None
        s.execute.return_value = ex
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "_batch_party_label_by_payment",
        lambda _session, rows: {rows[0].id: "Pat"},
    )
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "create_receipt_for_succeeded_inbound_payment",
        lambda _session, *, payment: MagicMock(id=uuid4()),
    )
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "finalize_receipt_pdf_upload",
        lambda *_a, **_k: None,
    )
    audit_actions: list[str] = []
    mock_audit = MagicMock()

    def _log_custom(**kw: Any) -> None:
        audit_actions.append(str(kw.get("action")))

    mock_audit.log_custom.side_effect = _log_custom
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "AuditService",
        lambda *_a, **_k: mock_audit,
    )

    body = {"amount": "0", "currency": "HKD", "method": "free", "status": "pending"}
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
    )
    assert r["statusCode"] == 200
    assert pay.status == BillingPaymentStatus.SUCCEEDED
    assert pay.method == "free"
    assert "MANUAL_INBOUND_PAYMENT_UPDATED" in audit_actions
    out = json.loads(r["body"])
    assert out["payment"]["status"] == "succeeded"
    assert out["payment"]["party"] == "Pat"


def test_patch_manual_inbound_payment_pending_to_succeeded_creates_receipt(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.amount = Decimal("10")
    pay.currency = "HKD"
    pay.method = "bank_transfer"
    pay.contact_id = uuid4()
    pay.external_reference = None
    pay.succeeded_at = None
    pay.confirmed_by = None
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        ex = MagicMock()
        ex.scalar_one_or_none.return_value = None
        s.execute.return_value = ex
        yield s

    created = {"n": 0}

    def _create_rcpt(_session: Any, *, payment: Any) -> MagicMock:
        created["n"] += 1
        return MagicMock(id=uuid4())

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "_batch_party_label_by_payment",
        lambda _session, rows: {rows[0].id: "Pat"},
    )
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "create_receipt_for_succeeded_inbound_payment",
        _create_rcpt,
    )
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "finalize_receipt_pdf_upload",
        lambda *_a, **_k: None,
    )
    mock_audit = MagicMock()
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "AuditService",
        lambda *_a, **_k: mock_audit,
    )

    body = {
        "amount": "10",
        "currency": "HKD",
        "method": "bank_transfer",
        "status": "succeeded",
        "externalReference": "REF-OK",
    }
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
    )
    assert r["statusCode"] == 200
    assert pay.status == BillingPaymentStatus.SUCCEEDED
    assert pay.confirmed_by == admin_identity["userSub"]
    assert pay.succeeded_at is not None
    assert created["n"] == 1
    mock_audit.log_custom.assert_called()
    call_kw = mock_audit.log_custom.call_args.kwargs
    assert call_kw.get("action") == "MANUAL_INBOUND_PAYMENT_UPDATED"
    out = json.loads(r["body"])
    assert out["payment"]["unappliedAmount"] == "10"
    assert out["payment"]["party"] == "Pat"


def test_patch_manual_inbound_payment_succeeded_rejects_amount_change(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.SUCCEEDED
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.amount = Decimal("100")
    pay.currency = "HKD"
    pay.method = "bank_transfer"
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("100"),
    )
    body = {"amount": "99", "currency": "HKD", "method": "bank_transfer"}
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="Cannot change amount"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_patch_manual_inbound_payment_succeeded_rejects_free_method_when_positive_amount(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.SUCCEEDED
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.amount = Decimal("100")
    pay.currency = "HKD"
    pay.method = "bank_transfer"
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("100"),
    )
    body = {"amount": "100", "currency": "HKD", "method": "free"}
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="free method"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_patch_manual_inbound_payment_succeeded_allows_external_reference_update(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.SUCCEEDED
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.amount = Decimal("100")
    pay.currency = "HKD"
    pay.method = "bank_transfer"
    pay.external_reference = "OLD"
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("100"),
    )
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("100"),
    )
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payments_serializers_mod,
        "_batch_party_label_by_payment",
        lambda _session, rows: {rows[0].id: "Pat"},
    )
    mock_audit = MagicMock()
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "AuditService",
        lambda *_a, **_k: mock_audit,
    )

    body = {
        "amount": "100",
        "currency": "HKD",
        "method": "bank_transfer",
        "externalReference": "NEW-REF",
    }
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
    )
    assert r["statusCode"] == 200
    assert pay.external_reference == "NEW-REF"
    out = json.loads(r["body"])
    assert out["payment"]["externalReference"] == "NEW-REF"


def test_patch_manual_inbound_payment_duplicate_external_reference_conflict(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import IntegrityError

    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.amount = Decimal("10")
    pay.currency = "HKD"
    pay.method = "fps"
    pay.contact_id = uuid4()
    pay.external_reference = None
    pay.succeeded_at = None
    pay.confirmed_by = None
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get
        ex = MagicMock()
        ex.scalar_one_or_none.return_value = None
        s.execute.return_value = ex

        def _flush() -> None:
            raise IntegrityError(
                "stmt", {}, Exception("uq_cp_enrollment_external_ref violated")
            )

        s.flush.side_effect = _flush
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    body = {
        "amount": "10",
        "currency": "HKD",
        "method": "fps",
        "status": "pending",
        "externalReference": "DUP",
    }
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ConflictError, match="duplicate_enrollment_payment_reference"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_patch_manual_inbound_payment_rejects_enrollment_missing(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pay_id = uuid4()
    eid = uuid4()
    pay = MagicMock()
    pay.id = pay_id
    pay.direction = BillingPaymentDirection.INBOUND
    pay.status = BillingPaymentStatus.PENDING
    pay.stripe_payment_intent_id = None
    pay.enrollment_id = eid
    pay.to_audit_dict = MagicMock(return_value={"id": str(pay_id)})

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is CustomerPayment and pk == pay_id:
                return pay
            return None

        s.get.side_effect = _get
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payment_update_mod,
        "payment_unapplied_amount",
        lambda _s, _pid: Decimal("10"),
    )
    body = {"amount": "10", "currency": "HKD", "method": "fps", "status": "pending"}
    ev = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/billing/payments/{pay_id}",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="no longer exists"):
        admin_billing.handle_admin_billing_request(
            ev, "PATCH", f"/v1/admin/billing/payments/{pay_id}"
        )


def test_manual_inbound_payment_cancelled_enrollment_rejected(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CANCELLED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=uuid4(),
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: en if model is Enrollment and pk == eid else None
        )
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {
        "direction": "inbound",
        "enrollmentId": str(eid),
        "amount": "10",
        "currency": "HKD",
        "method": "fps",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="cancelled"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )


def test_manual_inbound_payment_succeeded_creates_receipt(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    cid = uuid4()
    new_pid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=cid,
        currency="HKD",
    )
    added: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get

        def _add(obj: Any) -> None:
            added.append(obj)

        s.add.side_effect = _add

        def _flush() -> None:
            obj = added[-1]
            obj.id = new_pid
            obj.created_at = datetime(2026, 1, 1, tzinfo=UTC)

        s.flush.side_effect = _flush
        ex = MagicMock()
        ex.scalar_one_or_none.return_value = None
        s.execute.return_value = ex
        yield s

    created = {"n": 0}

    def _create_rcpt(_session: Any, *, payment: Any) -> MagicMock:
        created["n"] += 1
        return MagicMock()

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "create_receipt_for_succeeded_inbound_payment",
        _create_rcpt,
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "finalize_receipt_pdf_upload",
        lambda *_a, **_k: None,
    )

    class _FakeAudit:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            pass

        def log_custom(self, **_kw: Any) -> None:
            return None

    monkeypatch.setattr(admin_billing_payment_create_mod, "AuditService", _FakeAudit)

    body = {
        "direction": "inbound",
        "enrollmentId": str(eid),
        "amount": "50",
        "currency": "HKD",
        "method": "bank_transfer",
        "status": "succeeded",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/payments"
    )
    assert r["statusCode"] == 201
    assert created["n"] == 1
    out = json.loads(r["body"])
    assert out["payment"]["enrollmentId"] == str(eid)
    assert out["payment"]["status"] == "succeeded"


def test_manual_inbound_payment_pending_skips_receipt(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    cid = uuid4()
    new_pid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=cid,
        currency="HKD",
    )
    added: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get

        def _add(obj: Any) -> None:
            added.append(obj)

        def _flush() -> None:
            obj = added[-1]
            obj.id = new_pid
            obj.created_at = datetime(2026, 1, 1, tzinfo=UTC)

        s.add.side_effect = _add
        s.flush.side_effect = _flush
        yield s

    created = {"n": 0}

    def _create_rcpt(_session: Any, *, payment: Any) -> MagicMock:
        created["n"] += 1
        return MagicMock()

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "create_receipt_for_succeeded_inbound_payment",
        _create_rcpt,
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "finalize_receipt_pdf_upload",
        lambda *_a, **_k: None,
    )

    class _FakeAudit:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            pass

        def log_custom(self, **_kw: Any) -> None:
            return None

    monkeypatch.setattr(admin_billing_payment_create_mod, "AuditService", _FakeAudit)

    body = {
        "direction": "inbound",
        "enrollmentId": str(eid),
        "amount": "50",
        "currency": "HKD",
        "method": "bank_transfer",
        "status": "pending",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/payments"
    )
    assert r["statusCode"] == 201
    assert created["n"] == 0
    out = json.loads(r["body"])
    assert out["payment"]["status"] == "pending"


def test_manual_inbound_payment_family_enrollment_recorded(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    new_pid = uuid4()
    fid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_contact_id=None,
        bill_to_family_id=None,
        contact_id=None,
        family_id=fid,
        currency="HKD",
    )
    added: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get

        def _add(obj: Any) -> None:
            added.append(obj)

        def _flush() -> None:
            obj = added[-1]
            obj.id = new_pid
            obj.created_at = datetime(2026, 1, 1, tzinfo=UTC)
            obj.external_reference = None

        s.add.side_effect = _add
        s.flush.side_effect = _flush
        ex = MagicMock()
        ex.scalar_one_or_none.return_value = None
        s.execute.return_value = ex
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "create_receipt_for_succeeded_inbound_payment",
        lambda *_a, **_k: MagicMock(),
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "finalize_receipt_pdf_upload",
        lambda *_a, **_k: None,
    )

    class _FakeAudit:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            pass

        def log_custom(self, **_kw: Any) -> None:
            return None

    monkeypatch.setattr(admin_billing_payment_create_mod, "AuditService", _FakeAudit)

    body = {
        "direction": "inbound",
        "enrollmentId": str(eid),
        "amount": "25",
        "currency": "HKD",
        "method": "fps",
        "status": "pending",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/payments"
    )
    assert r["statusCode"] == 201
    out = json.loads(r["body"])
    assert out["payment"]["contactId"] is None
    assert out["payment"]["enrollmentId"] == str(eid)


def test_manual_inbound_payment_rejects_currency_mismatch(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    cid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=cid,
        currency="USD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: en if model is Enrollment and pk == eid else None
        )
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {
        "direction": "inbound",
        "enrollmentId": str(eid),
        "amount": "10",
        "currency": "HKD",
        "method": "fps",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="currency"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )


def test_manual_inbound_payment_unknown_method_rejected(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    cid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        contact_id=cid,
        currency="HKD",
    )

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: en if model is Enrollment and pk == eid else None
        )
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)
    body = {
        "direction": "inbound",
        "enrollmentId": str(eid),
        "amount": "10",
        "currency": "HKD",
        "method": "under_the_table",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ValidationError, match="method"):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )


def test_manual_inbound_payment_duplicate_external_reference_conflict(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import IntegrityError

    eid = uuid4()
    cid = uuid4()
    new_pid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=cid,
        currency="HKD",
    )
    added: list[Any] = []

    class _Orig:
        def __str__(self) -> str:
            return 'duplicate key value violates unique constraint "uq_cp_enrollment_external_ref"'

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get

        def _add(obj: Any) -> None:
            added.append(obj)

        def _flush() -> None:
            if not added:
                return
            obj = added[-1]
            obj.id = new_pid
            obj.created_at = datetime(2026, 1, 1, tzinfo=UTC)
            raise IntegrityError("stmt", {}, _Orig())

        s.add.side_effect = _add
        s.flush.side_effect = _flush
        yield s

    patch_billing_sessions(monkeypatch, _fake_session)

    body = {
        "direction": "inbound",
        "enrollmentId": str(eid),
        "amount": "10",
        "currency": "HKD",
        "method": "fps",
        "externalReference": "dup-ref",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    with pytest.raises(ConflictError):
        admin_billing.handle_admin_billing_request(
            ev, "POST", "/v1/admin/billing/payments"
        )


def test_manual_inbound_payment_audit_includes_reconciliation_fields(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    eid = uuid4()
    cid = uuid4()
    new_pid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        contact_id=cid,
        currency="HKD",
    )
    added: list[Any] = []
    audit_calls: list[dict[str, Any]] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _get(model: Any, pk: Any) -> Any:
            if model is Enrollment and pk == eid:
                return en
            return None

        s.get.side_effect = _get

        def _add(obj: Any) -> None:
            added.append(obj)

        def _flush() -> None:
            obj = added[-1]
            obj.id = new_pid
            obj.created_at = datetime(2026, 1, 1, tzinfo=UTC)

        s.add.side_effect = _add
        s.flush.side_effect = _flush
        ex = MagicMock()
        ex.scalar_one_or_none.return_value = None
        s.execute.return_value = ex
        yield s

    class _FakeAudit:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            pass

        def log_custom(self, **kw: Any) -> None:
            audit_calls.append(kw)

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(
        admin_billing_payments_mod,
        "_batch_orphan_payment_deletable",
        lambda _session, rows: {rows[0].id: False},
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "create_receipt_for_succeeded_inbound_payment",
        lambda *_a, **_k: MagicMock(),
    )
    monkeypatch.setattr(
        admin_billing_payment_create_mod,
        "finalize_receipt_pdf_upload",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(admin_billing_payment_create_mod, "AuditService", _FakeAudit)

    body = {
        "direction": "inbound",
        "enrollmentId": str(eid),
        "amount": "50",
        "currency": "HKD",
        "method": "bank_transfer",
        "status": "succeeded",
        "externalReference": "wire-123",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/payments"
    )
    assert r["statusCode"] == 201
    assert len(audit_calls) == 1
    nv = audit_calls[0]["new_values"]
    assert nv["external_reference"] == "wire-123"
    assert nv["contact_id"] == str(cid)
    assert "succeeded_at" in nv


def test_refund_created_audit_includes_reconciliation_fields(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    orig_id = uuid4()
    new_pid = uuid4()
    audit_calls: list[dict[str, Any]] = []

    class _Orig:
        id = orig_id
        currency = "HKD"

    added: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()
        s.get.side_effect = (
            lambda model, pk: _Orig()
            if model is CustomerPayment and pk == orig_id
            else None
        )

        def _add(obj: Any) -> None:
            added.append(obj)

        def _flush() -> None:
            obj = added[-1]
            obj.id = new_pid
            obj.created_at = datetime(2026, 1, 1, tzinfo=UTC)

        s.add.side_effect = _add
        s.flush.side_effect = _flush
        yield s

    class _FakeAudit:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            pass

        def log_custom(self, **kw: Any) -> None:
            audit_calls.append(kw)

    patch_billing_sessions(monkeypatch, _fake_session)
    monkeypatch.setattr(admin_billing_payment_create_mod, "AuditService", _FakeAudit)

    body = {
        "direction": "refund",
        "originalPaymentId": str(orig_id),
        "amount": "5",
        "currency": "HKD",
        "method": "refund",
        "stripeRefundId": "re_abc",
    }
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/payments",
        body=json.dumps(body),
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "POST", "/v1/admin/billing/payments"
    )
    assert r["statusCode"] == 201
    assert len(audit_calls) == 1
    nv = audit_calls[0]["new_values"]
    assert nv["original_payment_id"] == str(orig_id)
    assert nv["currency"] == "HKD"
    assert nv["method"] == "refund"
    assert nv["stripe_refund_id"] == "re_abc"
    assert nv["contact_id"] is None
    assert nv["external_reference"] is None
    assert "succeeded_at" in nv
