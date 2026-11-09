from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from app.api.admin_entities_serializers import (
    serialize_contact_summary,
    serialize_organization_summary,
)
from app.db.models import Organization
from app.db.models.contact import Contact
from app.db.models.enums import (
    ContactSource,
    ContactType,
    MailchimpSyncStatus,
    OrganizationType,
    RelationshipType,
)
from sqlalchemy.orm import attributes


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


def _organization() -> Organization:
    return Organization(
        name="Vendor Co",
        organization_type=OrganizationType.COMPANY,
        relationship_type=RelationshipType.VENDOR,
    )


def test_organization_summary_omits_unloaded_relationships() -> None:
    org = _organization()

    payload = serialize_organization_summary(org)

    unloaded = attributes.instance_state(org).unloaded
    assert payload["tags"] == []
    assert payload["members"] == []
    assert payload["location_summary"] is None
    assert "organization_tags" in unloaded
    assert "organization_members" in unloaded
    assert "location" in unloaded


def test_organization_summary_includes_loaded_tags() -> None:
    org = _organization()
    tag_id = uuid4()
    attributes.set_committed_value(
        org,
        "organization_tags",
        [SimpleNamespace(tag=SimpleNamespace(id=tag_id, name="Finance", color=None))],
    )
    attributes.set_committed_value(org, "organization_members", [])

    payload = serialize_organization_summary(org)

    assert payload["tags"] == [{"id": str(tag_id), "name": "Finance", "color": None}]
    assert payload["tag_ids"] == [str(tag_id)]
    assert payload["members"] == []
