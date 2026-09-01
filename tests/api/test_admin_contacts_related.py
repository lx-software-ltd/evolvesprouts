"""Tests for contact related-record flags and invoice contact filter."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.api.admin_contacts_related import (
    SALES_INBOX_INSTAGRAM,
    SALES_INBOX_MESSENGER,
    SALES_INBOX_WHATSAPP,
    ContactRelatedFlags,
    related_flags_for_contacts,
)
from app.db.models.enums import MetaChannel


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


def test_related_flags_empty_ids() -> None:
    session = _FakeSession([])
    assert related_flags_for_contacts(session, []) == {}


def test_related_flags_picks_latest_sales_channel() -> None:
    contact_id = uuid4()
    older = datetime(2026, 1, 1, tzinfo=UTC)
    newer = datetime(2026, 8, 1, tzinfo=UTC)
    session = _FakeSession(
        [
            [(contact_id, older)],
            [(contact_id, MetaChannel.INSTAGRAM, newer)],
            [],
            [],
            [],
            [],
            [],
            [],
        ]
    )
    flags = related_flags_for_contacts(session, [contact_id])
    assert flags[contact_id] == ContactRelatedFlags(
        has_sales_conversation=True,
        sales_conversation_channel=SALES_INBOX_INSTAGRAM,
        has_service_instance=False,
        has_invoice=False,
    )


def test_related_flags_whatsapp_when_newer_than_meta() -> None:
    contact_id = uuid4()
    older = datetime(2026, 1, 1, tzinfo=UTC)
    newer = datetime(2026, 8, 1, tzinfo=UTC)
    session = _FakeSession(
        [
            [(contact_id, newer)],
            [(contact_id, MetaChannel.FACEBOOK, older)],
            [],
            [],
            [],
            [],
            [],
            [],
        ]
    )
    flags = related_flags_for_contacts(session, [contact_id])
    assert flags[contact_id].sales_conversation_channel == SALES_INBOX_WHATSAPP
    assert flags[contact_id].has_sales_conversation is True


def test_related_flags_messenger_from_facebook_channel() -> None:
    contact_id = uuid4()
    session = _FakeSession(
        [
            [],
            [(contact_id, MetaChannel.FACEBOOK, datetime(2026, 8, 1, tzinfo=UTC))],
            [],
            [],
            [],
            [],
            [],
            [],
        ]
    )
    flags = related_flags_for_contacts(session, [contact_id])
    assert flags[contact_id].sales_conversation_channel == SALES_INBOX_MESSENGER


def test_related_flags_instance_and_invoice_from_direct_ids() -> None:
    contact_id = uuid4()
    session = _FakeSession(
        [
            [],
            [],
            [],
            [],
            [contact_id],
            [],
            [],
            [contact_id],
        ]
    )
    flags = related_flags_for_contacts(session, [contact_id])
    assert flags[contact_id].has_service_instance is True
    assert flags[contact_id].has_invoice is True


def test_related_flags_instance_from_family_membership() -> None:
    contact_id = uuid4()
    family_id = uuid4()
    session = _FakeSession(
        [
            [],
            [],
            [(contact_id, family_id)],
            [],
            [],
            [family_id],
            [(contact_id, family_id)],
            [],
            [],
            [],
        ]
    )
    flags = related_flags_for_contacts(session, [contact_id])
    assert flags[contact_id].has_service_instance is True
    assert flags[contact_id].has_invoice is False


def test_related_flags_serializer_kwargs() -> None:
    flags = ContactRelatedFlags(
        has_sales_conversation=True,
        sales_conversation_channel=SALES_INBOX_WHATSAPP,
        has_service_instance=True,
        has_invoice=False,
    )
    assert flags.as_serializer_kwargs() == {
        "has_sales_conversation": True,
        "sales_conversation_channel": SALES_INBOX_WHATSAPP,
        "has_service_instance": True,
        "has_invoice": False,
    }
