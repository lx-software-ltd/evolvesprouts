from __future__ import annotations

from uuid import uuid4

from app.api.admin_entities_serializers import serialize_contact_summary
from app.db.models.contact import Contact
from app.db.models.enums import (
    ContactSource,
    ContactType,
    MailchimpSyncStatus,
    RelationshipType,
)


def _contact(**overrides: object) -> Contact:
    contact = Contact(
        id=uuid4(),
        email="amelia@example.com",
        first_name="Amelia",
        last_name="Chan",
        contact_type=ContactType.PARENT,
        relationship_type=RelationshipType.CLIENT,
        source=ContactSource.MANUAL,
        source_detail="Playgroup flyer",
        mailchimp_status=MailchimpSyncStatus.PENDING,
    )
    for key, value in overrides.items():
        setattr(contact, key, value)
    return contact


def test_contact_summary_exposes_job_title() -> None:
    payload = serialize_contact_summary(_contact(job_title="Product manager"))

    assert payload["source_detail"] == "Playgroup flyer"
    assert payload["job_title"] == "Product manager"


def test_contact_summary_job_title_defaults_to_null() -> None:
    payload = serialize_contact_summary(_contact())

    assert payload["job_title"] is None
