"""CRM family PATCH aligns member contacts' relationship_type with the family."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from unittest.mock import MagicMock

from app.api import admin_families
from app.api.admin_request import RequestIdentity
from app.db.models import RelationshipType


def _admin_identity() -> RequestIdentity:
    return RequestIdentity(
        user_sub="admin-sub",
        groups={"admin"},
        organization_ids=set(),
    )


@pytest.fixture
def families_session(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    session = MagicMock()

    class _SessionCtx:
        def __init__(self, _engine: Any) -> None:
            pass

        def __enter__(self) -> MagicMock:
            return session

        def __exit__(self, *_args: Any) -> bool:
            return False

    monkeypatch.setattr(admin_families, "Session", _SessionCtx)
    monkeypatch.setattr(admin_families, "get_engine", lambda: object())
    monkeypatch.setattr(
        admin_families,
        "extract_identity",
        lambda _event: _admin_identity(),
    )
    monkeypatch.setattr(admin_families, "set_audit_context", lambda *_a, **_k: None)
    monkeypatch.setattr(
        admin_families,
        "family_related_serializer_kwargs",
        lambda _session, _fid: {
            "has_sales_conversation": False,
            "sales_conversation_channel": None,
            "has_service_instance": False,
            "has_invoice": False,
        },
    )
    monkeypatch.setattr(
        admin_families,
        "serialize_family_summary",
        lambda _fam, **_k: {"serialized": True},
    )
    return session


def test_patch_family_relationship_propagates_to_all_member_contacts(
    monkeypatch: pytest.MonkeyPatch,
    api_gateway_event: Any,
    families_session: MagicMock,
) -> None:
    fam_id = uuid4()
    member_row_id = uuid4()
    member_row_id2 = uuid4()

    class _StubContact:
        def __init__(self, rel: RelationshipType) -> None:
            self.relationship_type = rel

    contact_a = _StubContact(RelationshipType.PROSPECT)
    contact_b = _StubContact(RelationshipType.PAST_CLIENT)

    class _StubMember:
        def __init__(self, mid: UUID, contact: _StubContact) -> None:
            self.id = mid
            self.contact = contact

    class _StubFamily:
        family_tags: list[Any] = []

        def __init__(self) -> None:
            self.id = fam_id
            self.family_name = "Unit"
            self.relationship_type = RelationshipType.PROSPECT
            self.family_members = [
                _StubMember(member_row_id, contact_a),
                _StubMember(member_row_id2, contact_b),
            ]

    stub_family = _StubFamily()

    class _FakeFamilyRepo:
        def __init__(self, _session: Any) -> None:
            pass

        def get_by_id_for_admin(self, fid: UUID) -> _StubFamily | None:
            assert fid == fam_id
            return stub_family

        def update(self, _family: Any) -> None:
            return None

    monkeypatch.setattr(admin_families, "FamilyRepository", _FakeFamilyRepo)

    event = api_gateway_event(
        method="PATCH",
        path=f"/v1/admin/families/{fam_id}",
        body=json.dumps({"relationship_type": "client"}),
    )
    response = admin_families.handle_admin_families_request(
        event,
        "PATCH",
        f"/v1/admin/families/{fam_id}",
    )

    assert response["statusCode"] == 200
    assert contact_a.relationship_type == RelationshipType.CLIENT
    assert contact_b.relationship_type == RelationshipType.CLIENT
    assert stub_family.relationship_type == RelationshipType.CLIENT
