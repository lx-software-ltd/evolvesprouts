"""Tests for admin billing bill-to party resolution and display."""

from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest

from app.api import admin_billing
from app.db.models import Contact
from app.db.models.enums import (
    BillingBillToKind,
    ServiceType,
)
from app.exceptions import ValidationError


def test_family_or_organization_bill_to_display_label() -> None:
    from app.api.admin_billing_common import (
        family_or_organization_bill_to_display_label,
    )

    assert (
        family_or_organization_bill_to_display_label(
            entity_name="Smith Family",
            primary_display_name="Jane Doe",
        )
        == "Smith Family \u00b7 Jane Doe"
    )
    assert (
        family_or_organization_bill_to_display_label(
            entity_name="Acme Ltd",
            primary_display_name=None,
        )
        == "Acme Ltd"
    )
    assert (
        family_or_organization_bill_to_display_label(
            entity_name=None,
            primary_display_name="Pat Lee",
        )
        == "Pat Lee"
    )
    assert (
        family_or_organization_bill_to_display_label(
            entity_name="  ",
            primary_display_name="  ",
        )
        is None
    )


def test_compose_enrollment_party_display_name_contact_includes_email_when_known() -> (
    None
):
    from types import SimpleNamespace

    from app.api.admin_billing_common import compose_enrollment_party_display_name
    from app.db.models.enums import BillingBillToKind

    contact = SimpleNamespace(
        first_name="Sam", last_name="Sample", email="sam@example.com"
    )
    enrollment = SimpleNamespace(
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact=None,
        contact=contact,
        bill_to_family_id=None,
        family_id=None,
        bill_to_organization_id=None,
        organization_id=None,
        bill_to_family=None,
        family=None,
        bill_to_organization=None,
        organization=None,
    )
    assert (
        compose_enrollment_party_display_name(
            enrollment,
            family_primary_contact_name=None,
            org_primary_contact_name=None,
        )
        == "Sam Sample \u00b7 sam@example.com"
    )


def test_resolve_bill_to_party_from_invoice_fks_family_uses_primary_contact_only() -> (
    None
):
    """Family invoices show primary contact as bill-to display name (no family · name line)."""
    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )
    from app.db.models import Family

    fid = uuid4()
    fam = SimpleNamespace(family_name="The Ng Household")
    primary = SimpleNamespace(
        first_name="Pat",
        last_name="Ng",
        email="pat@example.com",
    )
    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Family and pk == fid:
            return fam
        return None

    session.get.side_effect = _get

    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = primary
    session.execute.return_value = exec_result

    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_family_id=fid,
        bill_to_display_name=None,
        bill_to_email=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_display_name == "Pat Ng"
    assert inv.bill_to_email == "pat@example.com"


def test_resolve_bill_to_party_from_invoice_fks_family_without_primary_name() -> None:
    """When no primary contact name exists, family bill-to omits the family entity label."""
    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )
    from app.db.models import Family

    fid = uuid4()
    fam = SimpleNamespace(family_name="Orphan Household")
    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Family and pk == fid:
            return fam
        return None

    session.get.side_effect = _get

    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = None
    session.execute.return_value = exec_result

    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_family_id=fid,
        bill_to_display_name=None,
        bill_to_email=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_display_name is None


def test_build_enrollment_merge_line_description_title_tier_cohort() -> None:
    from app.api.admin_billing_invoice_draft_helpers import (
        _build_enrollment_merge_line_description,
    )

    svc = SimpleNamespace(
        title="Parent Service",
        service_tier="premium",
        service_type=ServiceType.EVENT,
    )
    inst = SimpleNamespace(title=None, cohort="spring 2026", service=svc)
    en = SimpleNamespace(
        instance=inst,
        ticket_tier_id=None,
        ticket_tier=None,
    )
    assert (
        _build_enrollment_merge_line_description(en)  # type: ignore[arg-type]
        == "Event: Parent Service Premium Spring 2026"
    )


def test_build_enrollment_merge_line_description_prefers_instance_title_and_ticket_tier() -> (
    None
):
    from app.api.admin_billing_invoice_draft_helpers import (
        _build_enrollment_merge_line_description,
    )

    tier = SimpleNamespace(name="early bird")
    svc = SimpleNamespace(
        title="Event Parent",
        service_tier="ignored_when_ticket",
        service_type=ServiceType.EVENT,
    )
    inst = SimpleNamespace(title="June Weekend", cohort=None, service=svc)
    tt_id = uuid4()
    en = SimpleNamespace(
        instance=inst,
        ticket_tier_id=tt_id,
        ticket_tier=tier,
    )
    assert (
        _build_enrollment_merge_line_description(en)  # type: ignore[arg-type]
        == "Event: June Weekend Early bird"
    )


def test_build_enrollment_merge_line_description_dedupes_when_tail_matches_kind() -> (
    None
):
    from app.api.admin_billing_invoice_draft_helpers import (
        _build_enrollment_merge_line_description,
    )

    svc = SimpleNamespace(
        title="Event", service_tier=None, service_type=ServiceType.EVENT
    )
    inst = SimpleNamespace(title="Event", cohort=None, service=svc)
    en = SimpleNamespace(
        instance=inst,
        ticket_tier_id=None,
        ticket_tier=None,
    )
    assert (
        _build_enrollment_merge_line_description(en)  # type: ignore[arg-type]
        == "Event"
    )


def test_build_enrollment_merge_line_description_same_instance_and_service_title() -> (
    None
):
    from app.api.admin_billing_invoice_draft_helpers import (
        _build_enrollment_merge_line_description,
    )

    svc = SimpleNamespace(
        title="Holiday Workshop",
        service_tier="standard",
        service_type=ServiceType.TRAINING_COURSE,
    )
    inst = SimpleNamespace(title="Holiday Workshop", cohort="week 1", service=svc)
    en = SimpleNamespace(
        instance=inst,
        ticket_tier_id=None,
        ticket_tier=None,
    )
    assert (
        _build_enrollment_merge_line_description(en)  # type: ignore[arg-type]
        == "Training course: Holiday Workshop Standard Week 1"
    )


def test_build_enrollment_merge_line_description_instance_title_without_service_title() -> (
    None
):
    from app.api.admin_billing_invoice_draft_helpers import (
        _build_enrollment_merge_line_description,
    )

    svc = SimpleNamespace(
        title=None,
        service_tier="solo",
        service_type=ServiceType.CONSULTATION,
    )
    inst = SimpleNamespace(title="Drop-in Session", cohort=None, service=svc)
    en = SimpleNamespace(
        instance=inst,
        ticket_tier_id=None,
        ticket_tier=None,
    )
    assert (
        _build_enrollment_merge_line_description(en)  # type: ignore[arg-type]
        == "Consultation: Drop-in Session Solo"
    )


def test_resolve_bill_to_party_from_invoice_fks_organization_two_lines() -> None:
    """Organization invoices store entity and primary contact on separate lines (PDF breaks)."""
    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )
    from app.db.models import Organization
    from app.db.models.enums import RelationshipType

    oid = uuid4()
    org = SimpleNamespace(
        name="Acme Learning Ltd",
        relationship_type=RelationshipType.CLIENT,
        legal_name=None,
    )
    primary = SimpleNamespace(
        first_name="Jordan",
        last_name="Lee",
        email="jordan@example.com",
    )
    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Organization and pk == oid:
            return org
        return None

    session.get.side_effect = _get

    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = primary
    session.execute.return_value = exec_result

    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.ORGANIZATION,
        bill_to_organization_id=oid,
        bill_to_display_name=None,
        bill_to_email=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_display_name == "Acme Learning Ltd\nJordan Lee"
    assert inv.bill_to_email == "jordan@example.com"


def test_resolve_bill_to_party_from_invoice_fks_partner_uses_legal_name() -> None:
    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )
    from app.db.models import Organization
    from app.db.models.enums import RelationshipType

    oid = uuid4()
    org = SimpleNamespace(
        name="Acme Display",
        legal_name="Acme Learning Limited",
        relationship_type=RelationshipType.PARTNER,
    )
    primary = SimpleNamespace(
        first_name="Jordan",
        last_name="Lee",
        email="jordan@example.com",
    )
    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Organization and pk == oid:
            return org
        return None

    session.get.side_effect = _get

    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = primary
    session.execute.return_value = exec_result

    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.ORGANIZATION,
        bill_to_organization_id=oid,
        bill_to_display_name=None,
        bill_to_email=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_display_name == "Acme Learning Limited\nJordan Lee"


def test_resolve_bill_to_party_from_invoice_fks_partner_falls_back_to_name() -> None:
    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )
    from app.db.models import Organization
    from app.db.models.enums import RelationshipType

    oid = uuid4()
    org = SimpleNamespace(
        name="Acme Display",
        legal_name=None,
        relationship_type=RelationshipType.PARTNER,
    )
    primary = SimpleNamespace(
        first_name="Jordan",
        last_name="Lee",
        email="jordan@example.com",
    )
    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Organization and pk == oid:
            return org
        return None

    session.get.side_effect = _get

    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = primary
    session.execute.return_value = exec_result

    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.ORGANIZATION,
        bill_to_organization_id=oid,
        bill_to_display_name=None,
        bill_to_email=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_display_name == "Acme Display\nJordan Lee"


def test_resolve_bill_to_party_from_invoice_fks_contact_without_email_sets_display_name() -> (
    None
):
    """Contact bill-to must populate display name even when email is absent (list + PDF)."""
    from types import SimpleNamespace

    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )

    cid = uuid4()
    contact = SimpleNamespace(email=None, first_name="Pat", last_name="Ng")
    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Contact and pk == cid:
            return contact
        return None

    session.get.side_effect = _get
    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=cid,
        bill_to_display_name=None,
        bill_to_email=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_display_name == "Pat Ng"
    assert inv.bill_to_email is None


def test_resolve_bill_to_party_from_invoice_fks_contact_includes_location_text() -> (
    None
):
    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )
    from app.db.models import Location

    cid = uuid4()
    lid = uuid4()
    contact = SimpleNamespace(
        email="p@example.com",
        first_name="Pat",
        last_name="Ng",
        location_id=lid,
    )
    loc = SimpleNamespace(name="Harbour Studio", address="1 Pier\nCentral")

    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Contact and pk == cid:
            return contact
        if model is Location and pk == lid:
            return loc
        return None

    session.get.side_effect = _get
    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.CONTACT,
        bill_to_contact_id=cid,
        bill_to_display_name=None,
        bill_to_email=None,
        bill_to_location_text=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_location_text == "Harbour Studio\n1 Pier\nCentral"


def test_resolve_bill_to_party_from_invoice_fks_family_primary_location_fallback() -> (
    None
):
    """When family has no location, use primary contact's linked location.

    The family bill-to snapshot intentionally drops ``Location.name`` (venue label) so
    family-affiliated locations don't duplicate the household name in the Bill To block.
    """
    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )
    from app.db.models import Family, Location

    fid = uuid4()
    lid = uuid4()
    fam = SimpleNamespace(family_name="Ng Family", location_id=None)
    primary = SimpleNamespace(
        first_name="Pat",
        last_name="Ng",
        email="pat@example.com",
        location_id=lid,
    )
    loc = SimpleNamespace(name="Home Base", address="99 Road")

    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Family and pk == fid:
            return fam
        if model is Location and pk == lid:
            return loc
        return None

    session.get.side_effect = _get

    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = primary
    session.execute.return_value = exec_result

    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_family_id=fid,
        bill_to_display_name=None,
        bill_to_email=None,
        bill_to_location_text=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_location_text == "99 Road"


def test_resolve_bill_to_party_from_invoice_fks_family_prefers_family_location() -> (
    None
):
    """Family-level location wins over primary contact location.

    The family branch drops ``Location.name`` from the snapshot so the assertion uses a
    distinctive ``address`` to verify which Location was chosen.
    """
    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )
    from app.db.models import Family, Location

    fid = uuid4()
    fam_lid = uuid4()
    primary_lid = uuid4()
    fam = SimpleNamespace(family_name="Ng Family", location_id=fam_lid)
    primary = SimpleNamespace(
        first_name="Pat",
        last_name="Ng",
        email="pat@example.com",
        location_id=primary_lid,
    )
    fam_loc = SimpleNamespace(name="Family Venue", address="2 Family Road")
    primary_loc = SimpleNamespace(name="Wrong", address="99 Other Road")

    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Family and pk == fid:
            return fam
        if model is Location and pk == fam_lid:
            return fam_loc
        if model is Location and pk == primary_lid:
            return primary_loc
        return None

    session.get.side_effect = _get

    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = primary
    session.execute.return_value = exec_result

    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_family_id=fid,
        bill_to_display_name=None,
        bill_to_email=None,
        bill_to_location_text=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_location_text == "2 Family Road"


def test_resolve_bill_to_party_from_invoice_fks_family_excludes_venue_name() -> None:
    """Family bill-to drops the venue label even when address is empty."""
    from app.api.admin_billing_invoice_draft_helpers import (
        _resolve_bill_to_party_from_invoice_fks,
    )
    from app.db.models import Family, Location

    fid = uuid4()
    lid = uuid4()
    fam = SimpleNamespace(family_name="Ng Family", location_id=lid)
    primary = SimpleNamespace(
        first_name="Pat",
        last_name="Ng",
        email="pat@example.com",
        location_id=None,
    )
    loc = SimpleNamespace(name="Ng Family Home", address=None)

    session = MagicMock()

    def _get(model: Any, pk: Any) -> Any:
        if model is Family and pk == fid:
            return fam
        if model is Location and pk == lid:
            return loc
        return None

    session.get.side_effect = _get

    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = primary
    session.execute.return_value = exec_result

    inv = SimpleNamespace(
        bill_to_kind=BillingBillToKind.FAMILY,
        bill_to_family_id=fid,
        bill_to_display_name=None,
        bill_to_email=None,
        bill_to_location_text=None,
    )
    _resolve_bill_to_party_from_invoice_fks(session, inv=inv)  # type: ignore[arg-type]
    assert inv.bill_to_location_text is None


def test_bill_to_location_snapshot_text_includes_geo_district_and_country() -> None:
    from app.api.admin_billing_invoice_draft_helpers import (
        _bill_to_location_snapshot_text,
    )
    from app.db.models import GeographicArea, Location

    lid = uuid4()
    area_leaf = uuid4()
    area_root = uuid4()
    loc = SimpleNamespace(name="Venue", address="99 Road", area_id=area_leaf)
    district = SimpleNamespace(
        id=area_leaf,
        name="Central",
        level="district",
        parent_id=area_root,
    )
    country = SimpleNamespace(
        id=area_root,
        name="Hong Kong",
        level="country",
        parent_id=None,
    )

    def _get(model: Any, pk: Any) -> Any:
        if model is Location and pk == lid:
            return loc
        if model is GeographicArea and pk == area_leaf:
            return district
        if model is GeographicArea and pk == area_root:
            return country
        return None

    session = MagicMock()
    session.get.side_effect = _get
    out = _bill_to_location_snapshot_text(session, lid)  # type: ignore[arg-type]
    assert out == "Venue\n99 Road\nCentral\nHong Kong"


def test_resolve_bill_to_primary_contacts_rejects_too_many_family_ids(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    body = {"familyIds": [str(uuid4()) for _ in range(401)]}
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/dashboard/resolve-bill-to-primary-contacts",
        authorizer_context=admin_identity,
        headers={"Content-Type": "application/json"},
        body=json.dumps(body),
    )
    with pytest.raises(ValidationError):
        admin_billing.handle_admin_billing_request(
            ev,
            "POST",
            "/v1/admin/billing/dashboard/resolve-bill-to-primary-contacts",
        )


def test_resolve_bill_to_primary_contacts_returns_family_primary_map(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import admin_billing_dashboard as admin_billing_dashboard_mod

    fam_id = uuid4()
    contact_id = uuid4()
    call_count = {"n": 0}

    @contextmanager
    def _fake_session(_u: str, _r: str | None) -> Any:
        class _Sess:
            def execute(self, _stmt: Any) -> Any:
                class _Res:
                    def all(self) -> list[tuple[UUID, UUID, bool, int]]:
                        call_count["n"] += 1
                        if call_count["n"] == 1:
                            return [(fam_id, contact_id, True, 1)]
                        return []

                return _Res()

        yield _Sess()

    monkeypatch.setattr(
        admin_billing_dashboard_mod, "session_with_audit", _fake_session
    )

    body = {"familyIds": [str(fam_id)]}
    ev = api_gateway_event(
        method="POST",
        path="/v1/admin/billing/dashboard/resolve-bill-to-primary-contacts",
        authorizer_context=admin_identity,
        headers={"Content-Type": "application/json"},
        body=json.dumps(body),
    )
    r = admin_billing.handle_admin_billing_request(
        ev,
        "POST",
        "/v1/admin/billing/dashboard/resolve-bill-to-primary-contacts",
    )
    assert r["statusCode"] == 200
    payload = json.loads(r["body"])
    assert payload["familyPrimaryContactById"][str(fam_id)] == str(contact_id)
    assert payload["organizationPrimaryContactById"] == {}
