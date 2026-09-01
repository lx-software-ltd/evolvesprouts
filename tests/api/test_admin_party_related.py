"""Tests for family and organisation related-record flags and party filters."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.api.admin_contacts_related import (
    SALES_INBOX_INSTAGRAM,
    SALES_INBOX_WHATSAPP,
    ContactRelatedFlags,
)
from app.api.admin_party_related import (
    parse_related_party_ids,
    related_flags_for_families,
    related_flags_for_organizations,
)
from app.db.models.enums import MetaChannel
from app.exceptions import ValidationError


class _ScalarResult:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    def all(self) -> list[object]:
        return self._values

    def scalars(self) -> _ScalarResult:
        return self


class _FakeSession:
    def __init__(self, results: list[list[object]]) -> None:
        self._results = list(results)

    def execute(self, _stmt: object) -> _ScalarResult:
        return _ScalarResult(self._results.pop(0) if self._results else [])


def test_parse_related_party_ids_rejects_multiple() -> None:
    event = {
        "queryStringParameters": {
            "contact_id": "11111111-1111-1111-1111-111111111111",
            "family_id": "22222222-2222-2222-2222-222222222222",
        }
    }
    with pytest.raises(ValidationError, match="Only one of"):
        parse_related_party_ids(event)


def test_related_flags_for_families_empty_ids() -> None:
    session = _FakeSession([])
    assert related_flags_for_families(session, []) == {}


def test_related_flags_for_families_picks_newest_member_channel() -> None:
    family_id = uuid4()
    contact_a = uuid4()
    contact_b = uuid4()
    older = datetime(2026, 1, 1, tzinfo=UTC)
    newer = datetime(2026, 8, 1, tzinfo=UTC)
    session = _FakeSession(
        [
            [(family_id, contact_a), (family_id, contact_b)],
            [(contact_a, older)],
            [(contact_b, MetaChannel.INSTAGRAM, newer)],
            [],
            [],
            [],
            [],
        ]
    )
    flags = related_flags_for_families(session, [family_id])
    assert flags[family_id] == ContactRelatedFlags(
        has_sales_conversation=True,
        sales_conversation_channel=SALES_INBOX_INSTAGRAM,
        has_service_instance=False,
        has_invoice=False,
    )


def test_related_flags_for_families_direct_enrollment_and_invoice() -> None:
    family_id = uuid4()
    session = _FakeSession(
        [
            [],
            [family_id],
            [family_id],
        ]
    )
    flags = related_flags_for_families(session, [family_id])
    assert flags[family_id].has_service_instance is True
    assert flags[family_id].has_invoice is True
    assert flags[family_id].has_sales_conversation is False


def test_related_flags_for_families_member_enrollment() -> None:
    family_id = uuid4()
    contact_id = uuid4()
    session = _FakeSession(
        [
            [(family_id, contact_id)],
            [],
            [],
            [],
            [contact_id],
            [],
            [],
        ]
    )
    flags = related_flags_for_families(session, [family_id])
    assert flags[family_id].has_service_instance is True
    assert flags[family_id].has_invoice is False
    assert flags[family_id].sales_conversation_channel is None


def test_related_flags_for_organizations_member_whatsapp() -> None:
    organization_id = uuid4()
    contact_id = uuid4()
    session = _FakeSession(
        [
            [(organization_id, contact_id)],
            [(contact_id, datetime(2026, 8, 1, tzinfo=UTC))],
            [],
            [],
            [],
            [],
            [],
        ]
    )
    flags = related_flags_for_organizations(session, [organization_id])
    assert flags[organization_id].has_sales_conversation is True
    assert flags[organization_id].sales_conversation_channel == SALES_INBOX_WHATSAPP
