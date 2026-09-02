"""Tests for admin billing enrollment listing and bill-to FK helpers."""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.api import admin_billing
from app.api import (
    admin_billing_enrollment_queries as admin_billing_enrollment_queries_mod,
)
from app.api.admin_billing_common import (
    effective_enrollment_bill_to_fks,
    enrollment_bill_to_merge_key,
)
from app.db.models import Enrollment
from app.db.models.enums import (
    BillingBillToKind,
    EnrollmentStatus,
)


def test_list_recent_enrollments_orders_and_filters(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """blocked_eids scoped to candidates; cancel excluded; party email from primary."""

    iid = uuid4()
    earlier = datetime(2026, 1, 1, tzinfo=UTC)
    later = datetime(2026, 2, 1, tzinfo=UTC)
    fam_id = uuid4()

    inst = MagicMock()
    inst.title = "Spring Unit"
    inst.cohort = "A"

    tier = MagicMock()
    tier.name = "VIP"

    e_later = uuid4()
    e_earlier = uuid4()
    e_cancel = uuid4()

    en_later = Enrollment(
        instance_id=iid,
        contact_id=None,
        family_id=fam_id,
        organization_id=None,
        ticket_tier_id=None,
        discount_code_id=None,
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_contact_id=None,
        bill_to_family_id=fam_id,
        bill_to_organization_id=None,
        status=EnrollmentStatus.CONFIRMED,
        amount_paid=Decimal("50.00"),
        currency="HKD",
        enrolled_at=later,
        cancelled_at=None,
        notes=None,
        created_by="test",
    )
    en_later.id = e_later
    en_later.instance = inst
    en_later.ticket_tier = tier
    en_later.contact = None
    en_later.family = MagicMock(family_name="Smith Family")
    en_later.organization = None
    en_later.bill_to_contact = None
    en_later.bill_to_family = MagicMock(family_name="Smith Family")
    en_later.bill_to_organization = None

    en_cancel = Enrollment(
        instance_id=iid,
        contact_id=None,
        family_id=fam_id,
        organization_id=None,
        ticket_tier_id=None,
        discount_code_id=None,
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_contact_id=None,
        bill_to_family_id=fam_id,
        bill_to_organization_id=None,
        status=EnrollmentStatus.CANCELLED,
        amount_paid=Decimal("1"),
        currency="HKD",
        enrolled_at=later,
        cancelled_at=later,
        notes=None,
        created_by="test",
    )
    en_cancel.id = e_cancel

    en_earlier = Enrollment(
        instance_id=iid,
        contact_id=None,
        family_id=fam_id,
        organization_id=None,
        ticket_tier_id=None,
        discount_code_id=None,
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_contact_id=None,
        bill_to_family_id=fam_id,
        bill_to_organization_id=None,
        status=EnrollmentStatus.CONFIRMED,
        amount_paid=Decimal("25"),
        currency="HKD",
        enrolled_at=earlier,
        cancelled_at=None,
        notes=None,
        created_by="test",
    )
    en_earlier.id = e_earlier
    en_earlier.instance = inst
    en_earlier.ticket_tier = None
    en_earlier.contact = None
    en_earlier.family = MagicMock(family_name="Smith Family")
    en_earlier.organization = None
    en_earlier.bill_to_contact = None
    en_earlier.bill_to_family = MagicMock(family_name="Smith Family")
    en_earlier.bill_to_organization = None

    exec_calls: list[Any] = []

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            exec_calls.append(stmt)
            out = MagicMock()
            sql = str(stmt)

            if "FROM enrollments" in sql or "enrollments." in sql:
                out.unique.return_value.scalars.return_value.all.return_value = [
                    en_later,
                    en_earlier,
                ]
            elif "customer_invoice_lines" in sql:
                out.scalars.return_value.all.return_value = [en_later.id]
            elif "FamilyMember" in sql or "family_members" in sql:
                if "first_name" in sql.lower():
                    out.all.return_value = [(fam_id, "Primary", "Person")]
                else:
                    out.all.return_value = [(fam_id, "primary@example.com")]
            elif "organization_members" in sql:
                out.all.return_value = []
            else:
                out.unique.return_value.scalars.return_value.all.return_value = []
                out.scalars.return_value.all.return_value = []
                out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    monkeypatch.setattr(
        admin_billing_enrollment_queries_mod, "session_with_audit", _fake_session
    )

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/enrollments/recent-for-invoicing",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/enrollments/recent-for-invoicing"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["truncated"] is False
    ids = [x["enrollmentId"] for x in body["items"]]
    assert str(en_later.id) == ids[0]
    assert str(en_earlier.id) == ids[1]
    assert all(str(en_cancel.id) != x for x in ids)
    row0 = body["items"][0]
    assert row0["invoiceLinked"] is True
    assert row0["partyEmail"] == "primary@example.com"
    assert row0["partyDisplayName"] == "Smith Family · Primary Person"
    assert row0["billToKind"] == "family"
    assert body["items"][1]["partyDisplayName"] == "Smith Family · Primary Person"
    assert body["items"][1]["billToKind"] == "family"


def test_list_recent_enrollments_infers_family_when_bill_to_kind_null(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Legacy enrollments may omit bill_to_kind while still being family-scoped (family_id only)."""

    iid = uuid4()
    fam_id = uuid4()
    ts = datetime(2026, 3, 1, tzinfo=UTC)
    eid = uuid4()

    en = Enrollment(
        instance_id=iid,
        contact_id=None,
        family_id=fam_id,
        organization_id=None,
        ticket_tier_id=None,
        discount_code_id=None,
        bill_to_kind=None,
        bill_to_contact_id=None,
        bill_to_family_id=None,
        bill_to_organization_id=None,
        status=EnrollmentStatus.CONFIRMED,
        amount_paid=Decimal("10"),
        currency="HKD",
        enrolled_at=ts,
        cancelled_at=None,
        notes=None,
        created_by="test",
    )
    en.id = eid
    en.instance = MagicMock(title="Workshop", cohort=None)
    en.ticket_tier = None
    en.contact = None
    fam_m = MagicMock()
    fam_m.family_name = "Ng Household"
    en.family = fam_m
    en.bill_to_family = fam_m
    en.organization = None
    en.bill_to_organization = None

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            sql = str(stmt)
            if "FROM enrollments" in sql or "enrollments." in sql:
                out.unique.return_value.scalars.return_value.all.return_value = [en]
            elif "customer_invoice_lines" in sql:
                out.scalars.return_value.all.return_value = []
            elif "FamilyMember" in sql or "family_members" in sql:
                if "first_name" in sql.lower():
                    out.all.return_value = [(fam_id, "Pat", "Ng")]
                else:
                    out.all.return_value = [(fam_id, "pat.ng@example.com")]
            elif "organization_members" in sql:
                out.all.return_value = []
            else:
                out.unique.return_value.scalars.return_value.all.return_value = []
                out.scalars.return_value.all.return_value = []
                out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    monkeypatch.setattr(
        admin_billing_enrollment_queries_mod, "session_with_audit", _fake_session
    )

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/enrollments/recent-for-invoicing",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/enrollments/recent-for-invoicing"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["items"][0]["billToKind"] == "family"
    assert body["items"][0]["partyDisplayName"] == "Ng Household · Pat Ng"


def test_effective_enrollment_bill_to_fks_family_falls_back_to_family_id() -> None:
    """Family-scoped enrollments may set ``family_id`` without ``bill_to_family_id``."""
    iid = uuid4()
    fam_id = uuid4()
    contact_id = uuid4()
    en = Enrollment(
        instance_id=iid,
        contact_id=contact_id,
        family_id=fam_id,
        organization_id=None,
        ticket_tier_id=None,
        discount_code_id=None,
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_contact_id=None,
        bill_to_family_id=None,
        bill_to_organization_id=None,
        status=EnrollmentStatus.CONFIRMED,
        amount_paid=Decimal("10"),
        currency="HKD",
        enrolled_at=datetime(2026, 3, 1, tzinfo=UTC),
        cancelled_at=None,
        notes=None,
        created_by="test",
    )
    bk, cid, fid, oid = effective_enrollment_bill_to_fks(en)
    assert bk == BillingBillToKind.FAMILY
    assert cid is None
    assert fid == fam_id
    assert oid is None
    key = enrollment_bill_to_merge_key(en)
    assert key.startswith("family||")
    assert str(fam_id) in key


def test_list_recent_enrollments_void_invoice_does_not_block_linked_flag(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """invoiceLinked ignores lines whose parent invoice is void (status filter)."""

    iid = uuid4()
    ts = datetime(2026, 2, 1, tzinfo=UTC)
    eid = uuid4()

    en = Enrollment(
        instance_id=iid,
        contact_id=None,
        family_id=None,
        organization_id=None,
        ticket_tier_id=None,
        discount_code_id=None,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        bill_to_family_id=None,
        bill_to_organization_id=None,
        status=EnrollmentStatus.CONFIRMED,
        amount_paid=Decimal("10"),
        currency="HKD",
        enrolled_at=ts,
        cancelled_at=None,
        notes=None,
        created_by="test",
    )
    en.id = eid
    en.instance = MagicMock(title="T", cohort=None)
    en.ticket_tier = None
    en.contact = MagicMock(email="x@example.com", first_name="X", last_name="Y")
    en.family = None
    en.organization = None
    en.bill_to_contact = None
    en.bill_to_family = None
    en.bill_to_organization = None

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            sql = str(stmt)
            if "FROM enrollments" in sql or "enrollments." in sql:
                out.unique.return_value.scalars.return_value.all.return_value = [en]
            elif "customer_invoice_lines" in sql:
                out.scalars.return_value.all.return_value = []
            else:
                out.unique.return_value.scalars.return_value.all.return_value = []
                out.scalars.return_value.all.return_value = []
                out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    monkeypatch.setattr(
        admin_billing_enrollment_queries_mod, "session_with_audit", _fake_session
    )

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/enrollments/recent-for-invoicing",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/enrollments/recent-for-invoicing"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert len(body["items"]) == 1
    assert body["items"][0]["invoiceLinked"] is False


def test_list_recent_enrollments_org_bill_to_primary_email(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    iid = uuid4()
    oid = uuid4()
    ts = datetime(2026, 2, 1, tzinfo=UTC)
    eid = uuid4()

    en = Enrollment(
        instance_id=iid,
        contact_id=None,
        family_id=None,
        organization_id=None,
        ticket_tier_id=None,
        discount_code_id=None,
        bill_to_kind=BillingBillToKind.ORGANIZATION,
        bill_to_contact_id=None,
        bill_to_family_id=None,
        bill_to_organization_id=oid,
        status=EnrollmentStatus.CONFIRMED,
        amount_paid=Decimal("10"),
        currency="HKD",
        enrolled_at=ts,
        cancelled_at=None,
        notes=None,
        created_by="test",
    )
    en.id = eid
    en.instance = MagicMock(title="OrgInst", cohort=None)
    en.ticket_tier = None
    en.contact = None
    en.family = None
    org_obj = MagicMock()
    org_obj.name = "Acme Corp"
    en.organization = org_obj
    en.bill_to_contact = None
    en.bill_to_family = None
    en.bill_to_organization = org_obj

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            sql = str(stmt)
            if "FROM enrollments" in sql or "enrollments." in sql:
                out.unique.return_value.scalars.return_value.all.return_value = [en]
            elif "customer_invoice_lines" in sql:
                out.scalars.return_value.all.return_value = []
            elif "organization_members" in sql:
                if "first_name" in sql.lower():
                    out.all.return_value = [(oid, "Jane", "Doe")]
                else:
                    out.all.return_value = [(oid, "org.primary@example.com")]
            elif "FamilyMember" in sql or "family_members" in sql:
                out.all.return_value = []
            else:
                out.unique.return_value.scalars.return_value.all.return_value = []
                out.scalars.return_value.all.return_value = []
                out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    monkeypatch.setattr(
        admin_billing_enrollment_queries_mod, "session_with_audit", _fake_session
    )

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/enrollments/recent-for-invoicing",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/enrollments/recent-for-invoicing"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    assert body["items"][0]["partyEmail"] == "org.primary@example.com"
    assert body["items"][0]["partyDisplayName"] == "Acme Corp · Jane Doe"
    assert body["items"][0]["billToKind"] == "organization"


def test_list_recent_enrollments_parent_service_title_and_service_tier_fallback(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty instance title exposes parent service title; tier falls back to service.service_tier."""

    iid = uuid4()
    ts = datetime(2026, 2, 1, tzinfo=UTC)
    eid = uuid4()

    svc = MagicMock()
    svc.title = "Parent Course"
    svc.service_tier = "Standard"

    inst = MagicMock()
    inst.title = ""
    inst.cohort = "Cohort A"
    inst.service = svc

    en = Enrollment(
        instance_id=iid,
        contact_id=None,
        family_id=None,
        organization_id=None,
        ticket_tier_id=None,
        discount_code_id=None,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=None,
        bill_to_family_id=None,
        bill_to_organization_id=None,
        status=EnrollmentStatus.CONFIRMED,
        amount_paid=Decimal("10"),
        currency="HKD",
        enrolled_at=ts,
        cancelled_at=None,
        notes=None,
        created_by="test",
    )
    en.id = eid
    en.instance = inst
    en.ticket_tier = None
    en.contact = MagicMock(email="x@example.com", first_name="X", last_name="Y")
    en.family = None
    en.organization = None
    en.bill_to_contact = None
    en.bill_to_family = None
    en.bill_to_organization = None

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        s = MagicMock()

        def _exec(stmt: Any, *a: Any, **k: Any) -> MagicMock:
            out = MagicMock()
            sql = str(stmt)
            if "FROM enrollments" in sql or "enrollments." in sql:
                out.unique.return_value.scalars.return_value.all.return_value = [en]
            elif "customer_invoice_lines" in sql:
                out.scalars.return_value.all.return_value = []
            else:
                out.unique.return_value.scalars.return_value.all.return_value = []
                out.scalars.return_value.all.return_value = []
                out.all.return_value = []
            return out

        s.execute.side_effect = _exec
        yield s

    monkeypatch.setattr(
        admin_billing_enrollment_queries_mod, "session_with_audit", _fake_session
    )

    ev = api_gateway_event(
        method="GET",
        path="/v1/admin/billing/enrollments/recent-for-invoicing",
        authorizer_context=admin_identity,
    )
    r = admin_billing.handle_admin_billing_request(
        ev, "GET", "/v1/admin/billing/enrollments/recent-for-invoicing"
    )
    assert r["statusCode"] == 200
    body = json.loads(r["body"])
    row = body["items"][0]
    assert row["instanceTitle"] is None
    assert row["parentServiceTitle"] == "Parent Course"
    assert row["serviceTierName"] == "Standard"
    assert row["instanceCohort"] == "Cohort A"
    assert row["billToKind"] == "contact"
