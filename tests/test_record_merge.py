"""Tests for shared record-merge identity fill and Mailchimp archive rules."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.models.enums import (
    ContactSource,
    MailchimpSyncStatus,
    RelationshipType,
)
from app.exceptions import ValidationError
from app.services.record_merge import (
    archive_email_if_discarded,
    fill_keeper_identity,
)


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
