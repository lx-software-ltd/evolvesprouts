"""Handler-level tests for admin organizations routes."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.api import admin_organizations
from app.api.admin import lambda_handler
from app.db.models import Organization, OrganizationType, RelationshipType
from app.exceptions import ValidationError


def _install_organizations_persistence_fakes(
    monkeypatch: Any,
    *,
    stored: dict[UUID, Organization],
) -> None:
    """Fake DB session/repository so create/update handlers persist in ``stored``."""

    class _FakeSession:
        def commit(self) -> None:
            return None

        def rollback(self) -> None:
            return None

    class _FakeSessionCtx:
        def __enter__(self) -> _FakeSession:
            return _FakeSession()

        def __exit__(self, *args: object) -> None:
            return None

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def create(self, org: Organization) -> Organization:
            if org.id is None:
                org.id = uuid4()
            now = datetime.now(UTC)
            org.created_at = now
            org.updated_at = now
            org.organization_tags = []
            org.organization_members = []
            stored[org.id] = org
            return org

        def update(self, org: Organization) -> Organization:
            org.updated_at = datetime.now(UTC)
            stored[org.id] = org
            return org

        def get_non_vendor_organization_by_id(
            self, organization_id: UUID
        ) -> Organization | None:
            return stored.get(organization_id)

    monkeypatch.setattr(admin_organizations, "OrganizationRepository", _FakeRepo)
    monkeypatch.setattr(
        admin_organizations, "Session", lambda _engine: _FakeSessionCtx()
    )
    monkeypatch.setattr(admin_organizations, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_organizations, "set_audit_context", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        admin_organizations, "ensure_location_exists", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        admin_organizations, "replace_organization_tags", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        admin_organizations,
        "organization_related_serializer_kwargs",
        lambda _session, _oid: {
            "has_sales_conversation": False,
            "sales_conversation_channel": None,
            "has_service_instance": False,
            "has_invoice": False,
        },
    )
    monkeypatch.setattr(
        admin_organizations,
        "extract_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )


def test_create_partner_with_legal_name_round_trips(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    stored: dict[UUID, Organization] = {}
    _install_organizations_persistence_fakes(monkeypatch, stored=stored)

    response = admin_organizations.handle_admin_organizations_request(
        api_gateway_event(
            method="POST",
            path="/v1/admin/organizations",
            body=json.dumps(
                {
                    "name": "Acme Display",
                    "organization_type": "company",
                    "relationship_type": "partner",
                    "legal_name": "Acme Learning Limited",
                }
            ),
        ),
        "POST",
        "/v1/admin/organizations",
    )

    assert response["statusCode"] == 201
    body = json.loads(response["body"])
    assert body["organization"]["legal_name"] == "Acme Learning Limited"
    assert body["organization"]["name"] == "Acme Display"
    assert len(stored) == 1
    org = next(iter(stored.values()))
    assert org.legal_name == "Acme Learning Limited"


def test_update_partner_legal_name_round_trips(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    stored: dict[UUID, Organization] = {}
    _install_organizations_persistence_fakes(monkeypatch, stored=stored)
    org_id = uuid4()
    now = datetime.now(UTC)
    stored[org_id] = Organization(
        id=org_id,
        name="Acme Display",
        organization_type=OrganizationType.COMPANY,
        relationship_type=RelationshipType.PARTNER,
        legal_name="Old Legal Ltd",
        created_at=now,
        updated_at=now,
    )
    stored[org_id].organization_tags = []
    stored[org_id].organization_members = []

    response = admin_organizations.handle_admin_organizations_request(
        api_gateway_event(
            method="PATCH",
            path=f"/v1/admin/organizations/{org_id}",
            body=json.dumps({"legal_name": "New Legal Limited"}),
        ),
        "PATCH",
        f"/v1/admin/organizations/{org_id}",
    )

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["organization"]["legal_name"] == "New Legal Limited"
    assert stored[org_id].legal_name == "New Legal Limited"


def test_create_non_partner_with_legal_name_returns_validation_error(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    stored: dict[UUID, Organization] = {}
    _install_organizations_persistence_fakes(monkeypatch, stored=stored)

    with pytest.raises(ValidationError, match="only allowed when") as exc:
        admin_organizations.handle_admin_organizations_request(
            api_gateway_event(
                method="POST",
                path="/v1/admin/organizations",
                body=json.dumps(
                    {
                        "name": "Prospect Org",
                        "organization_type": "company",
                        "relationship_type": "prospect",
                        "legal_name": "Not Allowed Ltd",
                    }
                ),
            ),
            "POST",
            "/v1/admin/organizations",
        )

    assert exc.value.field == "legal_name"
    assert exc.value.status_code == 400
    assert stored == {}


def test_update_non_partner_with_legal_name_returns_validation_error(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    stored: dict[UUID, Organization] = {}
    _install_organizations_persistence_fakes(monkeypatch, stored=stored)
    org_id = uuid4()
    now = datetime.now(UTC)
    stored[org_id] = Organization(
        id=org_id,
        name="Prospect Org",
        organization_type=OrganizationType.COMPANY,
        relationship_type=RelationshipType.PROSPECT,
        created_at=now,
        updated_at=now,
    )
    stored[org_id].organization_tags = []
    stored[org_id].organization_members = []

    with pytest.raises(ValidationError, match="only allowed when") as exc:
        admin_organizations.handle_admin_organizations_request(
            api_gateway_event(
                method="PATCH",
                path=f"/v1/admin/organizations/{org_id}",
                body=json.dumps({"legal_name": "Not Allowed Ltd"}),
            ),
            "PATCH",
            f"/v1/admin/organizations/{org_id}",
        )

    assert exc.value.field == "legal_name"
    assert exc.value.status_code == 400


def test_update_partner_to_non_partner_clears_legal_name(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    stored: dict[UUID, Organization] = {}
    _install_organizations_persistence_fakes(monkeypatch, stored=stored)
    org_id = uuid4()
    now = datetime.now(UTC)
    stored[org_id] = Organization(
        id=org_id,
        name="Partner Co",
        organization_type=OrganizationType.COMPANY,
        relationship_type=RelationshipType.PARTNER,
        legal_name="Partner Legal Ltd",
        partner_key="partner-co",
        created_at=now,
        updated_at=now,
    )
    stored[org_id].organization_tags = []
    stored[org_id].organization_members = []

    response = admin_organizations.handle_admin_organizations_request(
        api_gateway_event(
            method="PATCH",
            path=f"/v1/admin/organizations/{org_id}",
            body=json.dumps({"relationship_type": "client"}),
        ),
        "PATCH",
        f"/v1/admin/organizations/{org_id}",
    )

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["organization"]["relationship_type"] == "client"
    assert body["organization"]["legal_name"] is None
    assert stored[org_id].legal_name is None
    assert stored[org_id].partner_key is None


def test_list_organizations_default_excludes_vendors_from_repository_filter(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    """Unfiltered list should not pass relationship_types (repository excludes vendors and partners)."""
    captured: dict[str, Any] = {}

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def list_organizations(self, **kwargs: Any) -> list[object]:
            captured["list"] = kwargs
            return []

        def count_organizations(self, **kwargs: Any) -> int:
            captured["count"] = kwargs
            return 0

    class _FakeSessionCtx:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(admin_organizations, "OrganizationRepository", _FakeRepo)
    monkeypatch.setattr(
        admin_organizations, "Session", lambda _engine: _FakeSessionCtx()
    )
    monkeypatch.setattr(admin_organizations, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_organizations,
        "extract_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    admin_organizations.handle_admin_organizations_request(
        api_gateway_event(method="GET", path="/v1/admin/organizations"),
        "GET",
        "/v1/admin/organizations",
    )

    assert captured["list"].get("relationship_types") is None
    assert captured["list"].get("include_relationships") is True
    assert captured["list"].get("list_order") == "created_desc"
    assert captured["count"].get("relationship_types") is None


def test_list_organizations_vendor_query_sets_vendor_filter_and_skips_relationship_loads(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    from app.db.models import RelationshipType

    captured: dict[str, Any] = {}

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def list_organizations(self, **kwargs: Any) -> list[object]:
            captured["list"] = kwargs
            return []

        def count_organizations(self, **kwargs: Any) -> int:
            captured["count"] = kwargs
            return 0

    class _FakeSessionCtx:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(admin_organizations, "OrganizationRepository", _FakeRepo)
    monkeypatch.setattr(
        admin_organizations, "Session", lambda _engine: _FakeSessionCtx()
    )
    monkeypatch.setattr(admin_organizations, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_organizations,
        "extract_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    admin_organizations.handle_admin_organizations_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/organizations",
            query_params={"relationship_type": "vendor"},
        ),
        "GET",
        "/v1/admin/organizations",
    )

    assert captured["list"]["relationship_types"] == (RelationshipType.VENDOR,)
    assert captured["list"]["include_relationships"] is False
    assert captured["list"].get("list_order") == "created_desc"
    assert captured["count"]["relationship_types"] == (RelationshipType.VENDOR,)


def test_list_organizations_sort_name_sets_name_asc_list_order(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    captured: dict[str, Any] = {}

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def list_organizations(self, **kwargs: Any) -> list[object]:
            captured["list"] = kwargs
            return []

        def count_organizations(self, **kwargs: Any) -> int:
            captured["count"] = kwargs
            return 0

    class _FakeSessionCtx:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(admin_organizations, "OrganizationRepository", _FakeRepo)
    monkeypatch.setattr(
        admin_organizations, "Session", lambda _engine: _FakeSessionCtx()
    )
    monkeypatch.setattr(admin_organizations, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_organizations,
        "extract_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    admin_organizations.handle_admin_organizations_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/organizations",
            query_params={"relationship_type": "vendor", "sort": "name"},
        ),
        "GET",
        "/v1/admin/organizations",
    )

    assert captured["list"]["list_order"] == "name_asc"


def test_get_organization_returns_partner_row_via_non_vendor_loader(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    """Partner rows load through get_non_vendor_organization_by_id (shared with CRM orgs)."""
    partner_id = uuid4()

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_non_vendor_organization_by_id(self, organization_id: UUID) -> object:
            assert organization_id == partner_id
            return type("Org", (), {"id": partner_id})()

    class _FakeSessionCtx:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(admin_organizations, "OrganizationRepository", _FakeRepo)
    monkeypatch.setattr(
        admin_organizations, "Session", lambda _engine: _FakeSessionCtx()
    )
    monkeypatch.setattr(admin_organizations, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_organizations,
        "extract_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )
    monkeypatch.setattr(
        admin_organizations,
        "organization_related_serializer_kwargs",
        lambda _session, _oid: {
            "has_sales_conversation": False,
            "sales_conversation_channel": None,
            "has_service_instance": False,
            "has_invoice": False,
        },
    )
    monkeypatch.setattr(
        admin_organizations,
        "serialize_organization_summary",
        lambda _org, **_k: {
            "id": str(partner_id),
            "relationship_type": "partner",
            "members": [],
        },
    )

    response = admin_organizations.handle_admin_organizations_request(
        api_gateway_event(
            method="GET",
            path=f"/v1/admin/organizations/{partner_id}",
        ),
        "GET",
        f"/v1/admin/organizations/{partner_id}",
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["organization"]["relationship_type"] == "partner"


def test_get_organization_returns_404_when_crm_loader_finds_nothing(
    monkeypatch: Any,
    api_gateway_event: Any,
) -> None:
    """CRM GET by id uses get_non_vendor_organization_by_id (e.g. vendor rows are invisible)."""

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_non_vendor_organization_by_id(self, _organization_id: object) -> None:
            return None

    class _FakeSessionCtx:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *args: object) -> None:
            return None

    monkeypatch.setattr(admin_organizations, "OrganizationRepository", _FakeRepo)
    monkeypatch.setattr(
        admin_organizations, "Session", lambda _engine: _FakeSessionCtx()
    )
    monkeypatch.setattr(admin_organizations, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_organizations,
        "extract_identity",
        lambda _event: type("Identity", (), {"user_sub": "admin-sub"})(),
    )

    org_id = str(uuid4())
    event = api_gateway_event(
        method="GET",
        path=f"/v1/admin/organizations/{org_id}",
        authorizer_context={"userSub": "admin-sub"},
    )
    response = lambda_handler(event, None)
    assert response["statusCode"] == 404
    body = json.loads(response["body"])
    assert "error" in body
