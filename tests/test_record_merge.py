"""Tests for shared record-merge identity fill, archive, and open-lead collapse."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.models.enums import (
    ContactSource,
    FunnelStage,
    LeadEventType,
    LeadType,
    MailchimpSyncStatus,
    RelationshipType,
)
from app.db.models.sales_lead import SalesLead
from app.exceptions import ValidationError
from app.services.record_merge import (
    archive_email_if_discarded,
    fill_keeper_identity,
)
from app.services.record_merge_related import resolve_open_lead_conflicts


def _contact(**overrides: object) -> SimpleNamespace:
    now = datetime(2026, 4, 1, tzinfo=UTC)
    values = dict(
        id=uuid4(),
        email=None,
        instagram_handle=None,
        first_name="Gabriella",
        last_name=None,
        job_title=None,
        phone_region=None,
        phone_national_number=None,
        date_of_birth=None,
        contact_type=None,
        relationship_type=RelationshipType.PROSPECT,
        source=ContactSource.WHATSAPP,
        source_detail="whatsapp_webhook",
        location_id=None,
        archived_at=None,
        created_at=now,
        mailchimp_status=MailchimpSyncStatus.PENDING,
        mailchimp_subscriber_id=None,
        source_metadata=None,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def test_fill_keeper_identity_copies_missing_phone_and_last_name() -> None:
    keeper = _contact(
        source=ContactSource.MANUAL,
        source_detail=None,
        relationship_type=RelationshipType.CLIENT,
        created_at=datetime(2026, 4, 20, tzinfo=UTC),
    )
    loser = _contact(
        last_name="Zavatti",
        phone_region="HK",
        phone_national_number="51234567",
        created_at=datetime(2026, 9, 7, tzinfo=UTC),
    )
    fill_keeper_identity(keeper, loser, conflict_field="contact_ids")
    assert keeper.last_name == "Zavatti"
    assert keeper.phone_region == "HK"
    assert keeper.phone_national_number == "51234567"
    assert keeper.source == ContactSource.MANUAL
    assert keeper.relationship_type == RelationshipType.CLIENT
    assert keeper.created_at == datetime(2026, 4, 20, tzinfo=UTC)


def test_fill_keeper_identity_rejects_different_emails() -> None:
    keeper = _contact(email="keeper@example.com")
    loser = _contact(email="loser@example.com")
    with pytest.raises(ValidationError, match="email") as exc:
        fill_keeper_identity(keeper, loser, conflict_field="contact_ids")
    assert exc.value.field == "contact_ids"


def test_fill_keeper_identity_takes_loser_email_when_keeper_empty() -> None:
    keeper = _contact(email=None)
    loser = _contact(email="g@example.com")
    fill_keeper_identity(keeper, loser, conflict_field="lead_ids")
    assert keeper.email == "g@example.com"


class _IdentityMap:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def values(self) -> list[object]:
        return list(self._rows)


class _LeadSession:
    """Session stand-in: the SELECT misses unflushed contact moves."""

    def __init__(self, db_rows: list[SalesLead], identity: list[object]) -> None:
        self.identity_map = _IdentityMap(identity)
        self.deleted: set[object] = set()
        self.added: list[object] = []
        self._db_rows = db_rows

    def scalars(self, _statement: object) -> SimpleNamespace:
        rows = list(self._db_rows)
        return SimpleNamespace(all=lambda: rows)

    def execute(self, _statement: object) -> None:
        return None

    def add(self, obj: object) -> None:
        self.added.append(obj)


def _lead(**overrides: object) -> SalesLead:
    values: dict[str, object] = {
        "id": uuid4(),
        "contact_id": uuid4(),
        "lead_type": LeadType.FREE_GUIDE,
        "funnel_stage": FunnelStage.NEW,
        "is_manual": False,
        "updated_at": datetime(2026, 5, 1, tzinfo=UTC),
    }
    values.update(overrides)
    return SalesLead(**values)


def test_resolve_open_leads_collapses_unflushed_reassignment() -> None:
    keeper_id = uuid4()
    already_on_keeper = _lead(
        contact_id=keeper_id,
        lead_type=LeadType.FREE_GUIDE,
        updated_at=datetime(2026, 5, 1, tzinfo=UTC),
    )
    moved = _lead(
        contact_id=keeper_id,
        lead_type=LeadType.PROGRAM_ENROLLMENT,
        funnel_stage=FunnelStage.CONTACTED,
        updated_at=datetime(2026, 5, 2, tzinfo=UTC),
    )
    session = _LeadSession([already_on_keeper], [already_on_keeper, moved])

    resolve_open_lead_conflicts(
        session,
        keeper_id=keeper_id,
        actor_sub="admin-sub",
        event_source="admin_contact_merge",
    )

    assert len(session.added) == 1
    event = session.added[0]
    assert event.event_type == LeadEventType.ACTION_RECORDED
    assert event.lead_id == moved.id
    assert event.metadata["merged_lead_ids"] == [str(already_on_keeper.id)]


def test_resolve_open_leads_ignores_other_contacts_and_manual_rows() -> None:
    keeper_id = uuid4()
    keeper_lead = _lead(contact_id=keeper_id)
    still_on_loser = _lead(contact_id=uuid4(), funnel_stage=FunnelStage.ENGAGED)
    manual = _lead(contact_id=keeper_id, is_manual=True)
    closed = _lead(contact_id=keeper_id, funnel_stage=FunnelStage.CONVERTED)
    deleted = _lead(contact_id=keeper_id, funnel_stage=FunnelStage.QUALIFIED)
    session = _LeadSession(
        [keeper_lead],
        [keeper_lead, still_on_loser, manual, closed, deleted],
    )
    session.deleted.add(deleted)

    resolve_open_lead_conflicts(
        session,
        keeper_id=keeper_id,
        actor_sub="admin-sub",
        event_source="admin_contact_merge",
    )

    assert session.added == []


def test_archive_email_skipped_when_keeper_retains_address() -> None:
    keeper = _contact(
        email="g@example.com",
        mailchimp_status=MailchimpSyncStatus.SYNCED,
    )
    loser = _contact(
        email="g@example.com",
        mailchimp_status=MailchimpSyncStatus.SYNCED,
    )
    fill_keeper_identity(keeper, loser, conflict_field="contact_ids")
    assert archive_email_if_discarded(keeper, loser) is None
