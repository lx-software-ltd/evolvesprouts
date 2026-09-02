from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from app.api import (
    admin_contacts,
    admin_entity_services,
    admin_families,
    admin_organizations,
)
from app.api.admin_billing_invoice_draft_helpers import (
    build_enrollment_invoice_line_description,
)
from app.db.models.enums import EnrollmentStatus, ServiceType
from app.exceptions import NotFoundError


def _compiled_sql(stmt: Any) -> str:
    return str(
        stmt.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


def _make_enrollment(
    *,
    service_type: ServiceType = ServiceType.EVENT,
    instance_title: str | None = "June Weekend",
    service_title: str | None = "Event Parent",
    tier_name: str | None = None,
    cohort: str | None = None,
    status: EnrollmentStatus = EnrollmentStatus.CONFIRMED,
) -> Any:
    tier = SimpleNamespace(name=tier_name) if tier_name else None
    svc = SimpleNamespace(
        title=service_title,
        service_tier="ignored",
        service_type=service_type,
    )
    inst = SimpleNamespace(title=instance_title, cohort=cohort, service=svc)
    return SimpleNamespace(
        instance=inst,
        ticket_tier_id=uuid4() if tier else None,
        ticket_tier=tier,
        status=status,
    )


class _FakeScalars:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _FakeUnique:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _FakeScalars:
        return _FakeScalars(self._rows)


class _FakeExecuteResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def unique(self) -> _FakeUnique:
        return _FakeUnique(self._rows)


class _FakeSession:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows
        self.statements: list[Any] = []

    def __enter__(self) -> "_FakeSession":
        return self

    def __exit__(self, *_args: Any) -> None:
        return None

    def execute(self, stmt: Any) -> _FakeExecuteResult:
        self.statements.append(stmt)
        return _FakeExecuteResult(self._rows)


def _patch_session(
    monkeypatch: pytest.MonkeyPatch,
    rows: list[Any],
) -> _FakeSession:
    session = _FakeSession(rows)
    monkeypatch.setattr(
        admin_entity_services,
        "Session",
        lambda *_a, **_k: session,
    )
    monkeypatch.setattr(admin_entity_services, "get_engine", lambda: object())
    return session


def test_list_contact_services_returns_labels(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    contact_id = uuid4()
    en = _make_enrollment()
    expected = build_enrollment_invoice_line_description(en)  # type: ignore[arg-type]

    class _FakeContactRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_for_admin(self, cid: Any) -> object:
            assert cid == contact_id
            return object()

    _patch_session(monkeypatch, [en])
    monkeypatch.setattr(admin_entity_services, "ContactRepository", _FakeContactRepo)

    resp = admin_entity_services.list_contact_services(
        api_gateway_event(
            method="GET", path=f"/v1/admin/contacts/{contact_id}/services"
        ),
        contact_id=contact_id,
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body == {"items": [{"label": expected}]}


def test_list_contact_services_query_includes_contact_family_and_org(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    contact_id = uuid4()

    class _FakeContactRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_for_admin(self, _cid: Any) -> object:
            return object()

    session = _patch_session(monkeypatch, [])
    monkeypatch.setattr(admin_entity_services, "ContactRepository", _FakeContactRepo)

    admin_entity_services.list_contact_services(
        api_gateway_event(
            method="GET", path=f"/v1/admin/contacts/{contact_id}/services"
        ),
        contact_id=contact_id,
    )

    assert len(session.statements) == 1
    sql = _compiled_sql(session.statements[0])
    assert "enrollments.contact_id" in sql
    assert str(contact_id) in sql
    assert "enrollments.status" in sql
    assert "cancelled" in sql.lower()
    # Services purchased by the contact's family or organisation are inherited.
    assert "enrollments.family_id" in sql
    assert "family_members" in sql
    assert "enrollments.organization_id" in sql
    assert "organization_members" in sql


def test_list_contact_services_excludes_cancelled(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    contact_id = uuid4()

    class _FakeContactRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_for_admin(self, _cid: Any) -> object:
            return object()

    _patch_session(monkeypatch, [])
    monkeypatch.setattr(admin_entity_services, "ContactRepository", _FakeContactRepo)

    resp = admin_entity_services.list_contact_services(
        api_gateway_event(
            method="GET", path=f"/v1/admin/contacts/{contact_id}/services"
        ),
        contact_id=contact_id,
    )
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"]) == {"items": []}


def test_list_contact_services_unknown_contact_404(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    contact_id = uuid4()

    class _FakeContactRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_for_admin(self, _cid: Any) -> None:
            return None

    _patch_session(monkeypatch, [])
    monkeypatch.setattr(admin_entity_services, "ContactRepository", _FakeContactRepo)

    with pytest.raises(NotFoundError, match="Contact"):
        admin_entity_services.list_contact_services(
            api_gateway_event(
                method="GET", path=f"/v1/admin/contacts/{contact_id}/services"
            ),
            contact_id=contact_id,
        )


def test_list_family_services_query_includes_family_and_member_contacts(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    family_id = uuid4()

    class _FakeFamilyRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_for_admin(self, _fid: Any) -> object:
            return object()

    session = _patch_session(monkeypatch, [])
    monkeypatch.setattr(admin_entity_services, "FamilyRepository", _FakeFamilyRepo)

    admin_entity_services.list_family_services(
        api_gateway_event(
            method="GET", path=f"/v1/admin/families/{family_id}/services"
        ),
        family_id=family_id,
    )

    assert len(session.statements) == 1
    sql = _compiled_sql(session.statements[0])
    assert "enrollments.family_id" in sql
    assert str(family_id) in sql
    assert "family_members" in sql
    assert "enrollments.contact_id" in sql
    assert "cancelled" in sql.lower()


def test_list_family_services_includes_member_enrollments_and_dedupes(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    family_id = uuid4()
    en_family = _make_enrollment(
        instance_title="Shared Label", service_title="Event Parent"
    )
    en_member = _make_enrollment(
        instance_title="Shared Label", service_title="Event Parent"
    )
    label = build_enrollment_invoice_line_description(en_family)  # type: ignore[arg-type]

    class _FakeFamilyRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_for_admin(self, fid: Any) -> object:
            assert fid == family_id
            return object()

    _patch_session(monkeypatch, [en_family, en_member])
    monkeypatch.setattr(admin_entity_services, "FamilyRepository", _FakeFamilyRepo)

    resp = admin_entity_services.list_family_services(
        api_gateway_event(
            method="GET", path=f"/v1/admin/families/{family_id}/services"
        ),
        family_id=family_id,
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body == {"items": [{"label": label}]}


def test_list_family_services_unknown_family_404(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    family_id = uuid4()

    class _FakeFamilyRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_for_admin(self, _fid: Any) -> None:
            return None

    _patch_session(monkeypatch, [])
    monkeypatch.setattr(admin_entity_services, "FamilyRepository", _FakeFamilyRepo)

    with pytest.raises(NotFoundError, match="Family"):
        admin_entity_services.list_family_services(
            api_gateway_event(
                method="GET", path=f"/v1/admin/families/{family_id}/services"
            ),
            family_id=family_id,
        )


def test_list_organization_services_query_includes_org_and_member_contacts(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    organization_id = uuid4()

    class _FakeOrgRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_non_vendor_organization_by_id(self, _oid: Any) -> object:
            return object()

    session = _patch_session(monkeypatch, [])
    monkeypatch.setattr(admin_entity_services, "OrganizationRepository", _FakeOrgRepo)

    admin_entity_services.list_organization_services(
        api_gateway_event(
            method="GET",
            path=f"/v1/admin/organizations/{organization_id}/services",
        ),
        organization_id=organization_id,
    )

    assert len(session.statements) == 1
    sql = _compiled_sql(session.statements[0])
    assert "enrollments.organization_id" in sql
    assert str(organization_id) in sql
    assert "organization_members" in sql
    assert "enrollments.contact_id" in sql
    assert "cancelled" in sql.lower()


def test_list_organization_services_includes_member_enrollments(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    organization_id = uuid4()
    en_org = _make_enrollment(
        service_type=ServiceType.CONSULTATION,
        instance_title="Intro",
        service_title=None,
    )
    en_member = _make_enrollment(
        service_type=ServiceType.TRAINING_COURSE,
        instance_title="Course A",
        service_title="Course Parent",
    )
    labels = sorted(
        [
            build_enrollment_invoice_line_description(en_org),  # type: ignore[arg-type]
            build_enrollment_invoice_line_description(en_member),  # type: ignore[arg-type]
        ]
    )

    class _FakeOrgRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_non_vendor_organization_by_id(self, oid: Any) -> object:
            assert oid == organization_id
            return object()

    _patch_session(monkeypatch, [en_org, en_member])
    monkeypatch.setattr(admin_entity_services, "OrganizationRepository", _FakeOrgRepo)

    resp = admin_entity_services.list_organization_services(
        api_gateway_event(
            method="GET",
            path=f"/v1/admin/organizations/{organization_id}/services",
        ),
        organization_id=organization_id,
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert [item["label"] for item in body["items"]] == labels


def test_list_organization_services_unknown_organization_404(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
) -> None:
    organization_id = uuid4()

    class _FakeOrgRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_non_vendor_organization_by_id(self, _oid: Any) -> None:
            return None

    _patch_session(monkeypatch, [])
    monkeypatch.setattr(admin_entity_services, "OrganizationRepository", _FakeOrgRepo)

    with pytest.raises(NotFoundError, match="Organization"):
        admin_entity_services.list_organization_services(
            api_gateway_event(
                method="GET",
                path=f"/v1/admin/organizations/{organization_id}/services",
            ),
            organization_id=organization_id,
        )


def test_handle_admin_contacts_services_get(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    contact_id = str(uuid4())

    def _fake_list(_event: Any, *, contact_id: Any) -> dict[str, Any]:
        assert str(contact_id)
        return marker

    monkeypatch.setattr(admin_contacts, "list_contact_services", _fake_list)
    monkeypatch.setattr(
        admin_contacts,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_contacts.handle_admin_contacts_request(
        api_gateway_event(
            method="GET", path=f"/v1/admin/contacts/{contact_id}/services"
        ),
        "GET",
        f"/v1/admin/contacts/{contact_id}/services",
    )

    assert response is marker


def test_handle_admin_families_services_get(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    family_id = str(uuid4())

    def _fake_list(_event: Any, *, family_id: Any) -> dict[str, Any]:
        assert str(family_id)
        return marker

    monkeypatch.setattr(admin_families, "list_family_services", _fake_list)
    monkeypatch.setattr(
        admin_families,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_families.handle_admin_families_request(
        api_gateway_event(
            method="GET", path=f"/v1/admin/families/{family_id}/services"
        ),
        "GET",
        f"/v1/admin/families/{family_id}/services",
    )

    assert response is marker


def test_handle_admin_organizations_services_get(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    organization_id = str(uuid4())

    def _fake_list(_event: Any, *, organization_id: Any) -> dict[str, Any]:
        assert str(organization_id)
        return marker

    monkeypatch.setattr(admin_organizations, "list_organization_services", _fake_list)
    monkeypatch.setattr(
        admin_organizations,
        "require_admin_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    response = admin_organizations.handle_admin_organizations_request(
        api_gateway_event(
            method="GET",
            path=f"/v1/admin/organizations/{organization_id}/services",
        ),
        "GET",
        f"/v1/admin/organizations/{organization_id}/services",
    )

    assert response is marker
