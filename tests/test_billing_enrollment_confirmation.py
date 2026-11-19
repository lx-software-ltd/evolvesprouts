"""Tests for billing-driven enrollment confirmation and CRM promotion."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from app.db.models import Contact, Enrollment, Family, Organization
from app.db.models.enums import (
    BillingBillToKind,
    BillingInvoiceStatus,
    EnrollmentStatus,
    RelationshipType,
)
from app.services import billing_enrollment_confirmation as bec


class _FakeScalarResult:
    def __init__(self, rows: list) -> None:
        self._rows = rows

    def __iter__(self) -> Iterator:
        return iter(self._rows)

    def all(self) -> list:
        return self._rows


class _FakeSession:
    """Minimal session double supporting ``scalars`` queues and ``get`` maps."""

    def __init__(self) -> None:
        self.scalar_queues: list[list] = []
        self.enrollments: dict = {}
        self.contacts: dict = {}
        self.families: dict = {}
        self.organizations: dict = {}

    def scalars(self, _stmt: object) -> _FakeScalarResult:
        if not self.scalar_queues:
            raise AssertionError("unexpected scalars() call")
        return _FakeScalarResult(self.scalar_queues.pop(0))

    def get(self, model: type, pk: object) -> object | None:
        if model is Enrollment:
            return self.enrollments.get(pk)
        if model is Contact:
            return self.contacts.get(pk)
        if model is Family:
            return self.families.get(pk)
        if model is Organization:
            return self.organizations.get(pk)
        return None


def test_maybe_confirm_on_zero_issue_skips_nonzero_total() -> None:
    session = MagicMock()
    inv = SimpleNamespace(total=Decimal(50), id=uuid4())
    bec.maybe_confirm_enrollments_on_zero_total_invoice_issue(session, inv)  # type: ignore[arg-type]
    session.scalars.assert_not_called()


def test_maybe_confirm_on_allocation_skips_non_issued() -> None:
    session = MagicMock()
    inv = SimpleNamespace(
        total=Decimal(50),
        status=BillingInvoiceStatus.DRAFT,
        id=uuid4(),
        paid_at=None,
    )
    bec.maybe_confirm_enrollments_on_positive_invoice_payment_allocation(
        session,
        inv,  # type: ignore[arg-type]
    )
    session.scalars.assert_not_called()


def test_maybe_confirm_on_allocation_skips_zero_total() -> None:
    session = MagicMock()
    inv = SimpleNamespace(
        total=Decimal(0),
        status=BillingInvoiceStatus.ISSUED,
        id=uuid4(),
        paid_at=None,
    )
    bec.maybe_confirm_enrollments_on_positive_invoice_payment_allocation(
        session,
        inv,  # type: ignore[arg-type]
    )
    session.scalars.assert_not_called()


def test_confirm_registered_sets_status_without_promoting() -> None:
    eid = uuid4()
    cid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.REGISTERED,
        organization_id=None,
        family_id=None,
        contact_id=cid,
        cancelled_at="x",
    )
    contact = SimpleNamespace(id=cid, relationship_type=RelationshipType.PROSPECT)
    session = _FakeSession()
    session.scalar_queues.append([eid])
    session.enrollments[eid] = en
    session.contacts[cid] = contact

    bec._confirm_registered_enrollments_for_invoice(session, uuid4())

    assert en.status == EnrollmentStatus.CONFIRMED
    assert en.cancelled_at is None
    assert contact.relationship_type == RelationshipType.PROSPECT


def test_confirm_family_enrollment_does_not_promote() -> None:
    eid = uuid4()
    fid = uuid4()
    c1, c2 = uuid4(), uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.REGISTERED,
        organization_id=None,
        family_id=fid,
        contact_id=None,
        cancelled_at=None,
    )
    fam = SimpleNamespace(id=fid, relationship_type=RelationshipType.PROSPECT)
    contact1 = SimpleNamespace(id=c1, relationship_type=RelationshipType.PROSPECT)
    contact2 = SimpleNamespace(id=c2, relationship_type=RelationshipType.CLIENT)
    session = _FakeSession()
    session.scalar_queues.append([eid])
    session.enrollments[eid] = en
    session.families[fid] = fam
    session.contacts[c1] = contact1
    session.contacts[c2] = contact2

    bec._confirm_registered_enrollments_for_invoice(session, uuid4())

    assert en.status == EnrollmentStatus.CONFIRMED
    assert fam.relationship_type == RelationshipType.PROSPECT
    assert contact1.relationship_type == RelationshipType.PROSPECT
    assert contact2.relationship_type == RelationshipType.CLIENT


def test_promote_prospect_party_for_enrollment_family_and_members() -> None:
    """Helper still promotes family + member contacts when called for full payment."""
    fid = uuid4()
    c1, c2 = uuid4(), uuid4()
    en = SimpleNamespace(
        organization_id=None,
        family_id=fid,
        contact_id=None,
    )
    fam = SimpleNamespace(id=fid, relationship_type=RelationshipType.PROSPECT)
    contact1 = SimpleNamespace(id=c1, relationship_type=RelationshipType.PROSPECT)
    contact2 = SimpleNamespace(id=c2, relationship_type=RelationshipType.CLIENT)
    session = _FakeSession()
    session.scalar_queues.append([c1, c2])
    session.families[fid] = fam
    session.contacts[c1] = contact1
    session.contacts[c2] = contact2

    bec.promote_prospect_party_for_enrollment(session, en)  # type: ignore[arg-type]

    assert fam.relationship_type == RelationshipType.CLIENT
    assert contact1.relationship_type == RelationshipType.CLIENT
    assert contact2.relationship_type == RelationshipType.CLIENT


def test_confirm_org_enrollment_does_not_promote() -> None:
    eid = uuid4()
    oid = uuid4()
    c1, c2 = uuid4(), uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.REGISTERED,
        organization_id=oid,
        family_id=None,
        contact_id=None,
        cancelled_at=None,
    )
    org = SimpleNamespace(id=oid, relationship_type=RelationshipType.PROSPECT)
    contact1 = SimpleNamespace(id=c1, relationship_type=RelationshipType.PARTNER)
    contact2 = SimpleNamespace(id=c2, relationship_type=RelationshipType.PROSPECT)
    session = _FakeSession()
    session.scalar_queues.append([eid])
    session.enrollments[eid] = en
    session.organizations[oid] = org
    session.contacts[c1] = contact1
    session.contacts[c2] = contact2

    bec._confirm_registered_enrollments_for_invoice(session, uuid4())

    assert en.status == EnrollmentStatus.CONFIRMED
    assert org.relationship_type == RelationshipType.PROSPECT
    assert contact1.relationship_type == RelationshipType.PARTNER
    assert contact2.relationship_type == RelationshipType.PROSPECT


def test_confirm_skips_non_registered_enrollment() -> None:
    eid = uuid4()
    cid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        organization_id=None,
        family_id=None,
        contact_id=cid,
        cancelled_at=None,
    )
    contact = SimpleNamespace(id=cid, relationship_type=RelationshipType.PROSPECT)
    session = _FakeSession()
    session.scalar_queues.append([eid])
    session.enrollments[eid] = en
    session.contacts[cid] = contact

    bec._confirm_registered_enrollments_for_invoice(session, uuid4())

    assert en.status == EnrollmentStatus.CONFIRMED
    assert contact.relationship_type == RelationshipType.PROSPECT


def test_part_payment_confirms_enrollment_but_does_not_promote() -> None:
    """A deposit leaves the party as prospect until the invoice is fully paid."""
    eid = uuid4()
    cid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.REGISTERED,
        organization_id=None,
        family_id=None,
        contact_id=cid,
        cancelled_at=None,
    )
    contact = SimpleNamespace(id=cid, relationship_type=RelationshipType.PROSPECT)
    session = _FakeSession()
    session.contacts[cid] = contact
    session.enrollments[eid] = en
    session.scalar_queues.append([eid])
    inv = SimpleNamespace(
        id=uuid4(),
        total=Decimal(3000),
        status=BillingInvoiceStatus.ISSUED,
        paid_at=None,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=cid,
        bill_to_family_id=None,
        bill_to_organization_id=None,
    )

    bec.maybe_confirm_enrollments_on_positive_invoice_payment_allocation(
        session,
        inv,  # type: ignore[arg-type]
    )

    assert en.status == EnrollmentStatus.CONFIRMED
    assert contact.relationship_type == RelationshipType.PROSPECT


def test_full_payment_promotes_bill_to_and_enrollment_party() -> None:
    eid = uuid4()
    cid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.CONFIRMED,
        organization_id=None,
        family_id=None,
        contact_id=cid,
        cancelled_at=None,
    )
    contact = SimpleNamespace(id=cid, relationship_type=RelationshipType.PROSPECT)
    session = _FakeSession()
    session.contacts[cid] = contact
    session.enrollments[eid] = en
    # confirm loop (registered-only; this enrollment is already confirmed)
    session.scalar_queues.append([eid])
    # promote loop over enrollment ids
    session.scalar_queues.append([eid])
    inv = SimpleNamespace(
        id=uuid4(),
        total=Decimal(3000),
        status=BillingInvoiceStatus.ISSUED,
        paid_at=datetime.now(UTC),
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=cid,
        bill_to_family_id=None,
        bill_to_organization_id=None,
    )

    bec.maybe_confirm_enrollments_on_positive_invoice_payment_allocation(
        session,
        inv,  # type: ignore[arg-type]
    )

    assert contact.relationship_type == RelationshipType.CLIENT


def test_zero_value_invoice_confirms_without_promoting() -> None:
    eid = uuid4()
    cid = uuid4()
    en = SimpleNamespace(
        id=eid,
        status=EnrollmentStatus.REGISTERED,
        organization_id=None,
        family_id=None,
        contact_id=cid,
        cancelled_at=None,
    )
    contact = SimpleNamespace(id=cid, relationship_type=RelationshipType.PROSPECT)
    session = _FakeSession()
    session.contacts[cid] = contact
    session.enrollments[eid] = en
    session.scalar_queues.append([eid])
    inv = SimpleNamespace(
        id=uuid4(),
        total=Decimal(0),
        status=BillingInvoiceStatus.ISSUED,
        paid_at=None,
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=cid,
        bill_to_family_id=None,
        bill_to_organization_id=None,
    )

    bec.maybe_confirm_enrollments_on_zero_total_invoice_issue(
        session,
        inv,  # type: ignore[arg-type]
    )

    assert en.status == EnrollmentStatus.CONFIRMED
    assert contact.relationship_type == RelationshipType.PROSPECT
