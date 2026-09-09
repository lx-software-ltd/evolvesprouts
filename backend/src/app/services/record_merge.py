"""Shared helpers to fold one CRM record's identity and related rows onto another."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin_contacts_helpers import REFERRAL_CONTACT_METADATA_KEY
from app.api.admin_entities_helpers import (
    assert_contact_can_join_family,
    assert_contact_can_join_organization,
)
from app.db.models import Contact, ContactTag, FamilyMember, OrganizationMember
from app.db.models.enums import MailchimpSyncStatus, RelationshipType
from app.db.models.family import family_membership_role_from_contact_type
from app.db.models.organization import organization_membership_role_from_contact_type
from app.db.repositories.contact import (
    _normalize_email,
    _normalize_text,
    _should_replace_first_name,
    _should_replace_source,
)
from app.exceptions import ValidationError
from app.services.record_merge_related import (
    collapse_lead_rows,
    reassign_related_records,
    remap_referrer_ids,
    resolve_open_lead_conflicts,
)

_MAILCHIMP_REMOVE_STATUSES = frozenset(
    {
        MailchimpSyncStatus.SYNCED,
        MailchimpSyncStatus.FAILED,
        MailchimpSyncStatus.PENDING,
    }
)

_RELATIONSHIP_PRIORITY: dict[RelationshipType, int] = {
    RelationshipType.CLIENT: 60,
    RelationshipType.PARTNER: 50,
    RelationshipType.PROSPECT: 40,
    RelationshipType.PAST_CLIENT: 30,
    RelationshipType.VENDOR: 20,
    RelationshipType.OTHER: 10,
}

__all__ = [
    "absorb_loser_record",
    "archive_email_if_discarded",
    "collapse_lead_rows",
    "fill_keeper_identity",
    "transfer_group_memberships",
    "union_tag_links",
]


def absorb_loser_record(
    session: Session,
    keeper: Contact,
    loser: Contact,
    *,
    actor_sub: str,
    conflict_field: str,
    event_source: str,
    preferred_lead_id: UUID | None = None,
) -> str | None:
    """Fold ``loser`` onto ``keeper`` and delete ``loser``.

    Returns a Mailchimp email to archive only when that address is not kept.
    """
    fill_keeper_identity(keeper, loser, conflict_field=conflict_field)
    archive_email = archive_email_if_discarded(keeper, loser)
    loser.email = None
    loser.instagram_handle = None
    transfer_group_memberships(session, keeper, loser, conflict_field=conflict_field)
    union_tag_links(session, keeper.id, loser.id)
    with session.no_autoflush:
        reassign_related_records(
            session,
            from_id=loser.id,
            to_id=keeper.id,
            actor_sub=actor_sub,
            event_source=event_source,
        )
        resolve_open_lead_conflicts(
            session,
            keeper_id=keeper.id,
            actor_sub=actor_sub,
            event_source=event_source,
            preferred_lead_id=preferred_lead_id,
        )
    remap_referrer_ids(session, loser.id, keeper.id)
    session.delete(loser)
    session.flush()
    return archive_email


def fill_keeper_identity(
    keeper: Contact, loser: Contact, *, conflict_field: str
) -> None:
    """Copy missing identity fields from ``loser`` onto ``keeper``."""
    if loser.email:
        loser_email = _normalize_email(loser.email)
        if keeper.email:
            if _normalize_email(keeper.email) != loser_email:
                raise ValidationError(
                    "Cannot merge records with different email addresses",
                    field=conflict_field,
                )
        else:
            keeper.email = loser_email

    if loser.instagram_handle:
        keeper_handle = (keeper.instagram_handle or "").lstrip("@").lower()
        loser_handle = loser.instagram_handle.lstrip("@").lower()
        if keeper.instagram_handle:
            if keeper_handle != loser_handle:
                raise ValidationError(
                    "Cannot merge records with different Instagram handles",
                    field=conflict_field,
                )
        else:
            keeper.instagram_handle = loser.instagram_handle

    keeper_has_phone = bool(keeper.phone_region and keeper.phone_national_number)
    loser_has_phone = bool(loser.phone_region and loser.phone_national_number)
    if not keeper_has_phone and loser_has_phone:
        keeper.phone_region = loser.phone_region
        keeper.phone_national_number = loser.phone_national_number

    if _should_replace_first_name(keeper.first_name, loser.first_name):
        keeper.first_name = _normalize_text(loser.first_name) or keeper.first_name
    if not keeper.last_name and loser.last_name:
        keeper.last_name = _normalize_text(loser.last_name)
    if not keeper.job_title and loser.job_title:
        keeper.job_title = _normalize_text(loser.job_title)
    if not keeper.date_of_birth and loser.date_of_birth:
        keeper.date_of_birth = loser.date_of_birth

    if _should_replace_source(keeper.source, loser.source):
        keeper.source = loser.source
        if loser.source_detail and not keeper.source_detail:
            keeper.source_detail = loser.source_detail
    elif loser.source_detail and not keeper.source_detail:
        keeper.source_detail = loser.source_detail

    if _relationship_rank(loser.relationship_type) > _relationship_rank(
        keeper.relationship_type
    ):
        keeper.relationship_type = loser.relationship_type

    if keeper.location_id is None and loser.location_id is not None:
        keeper.location_id = loser.location_id

    if keeper.archived_at is not None and loser.archived_at is None:
        keeper.archived_at = None

    if keeper.created_at > loser.created_at:
        keeper.created_at = loser.created_at

    if (
        keeper.mailchimp_status not in _MAILCHIMP_REMOVE_STATUSES
        and loser.mailchimp_status in _MAILCHIMP_REMOVE_STATUSES
        and loser.mailchimp_subscriber_id
    ):
        keeper.mailchimp_subscriber_id = loser.mailchimp_subscriber_id
        keeper.mailchimp_status = loser.mailchimp_status

    keeper_meta = dict(keeper.source_metadata or {})
    loser_meta = dict(loser.source_metadata or {})
    for key, value in loser_meta.items():
        if key == REFERRAL_CONTACT_METADATA_KEY:
            continue
        if key not in keeper_meta:
            keeper_meta[key] = value
    keeper.source_metadata = keeper_meta or None


def archive_email_if_discarded(keeper: Contact, loser: Contact) -> str | None:
    """Return a Mailchimp address to archive when it will not remain on keeper."""
    if not loser.email:
        return None
    if loser.mailchimp_status not in _MAILCHIMP_REMOVE_STATUSES:
        return None
    loser_email = _normalize_email(loser.email)
    keeper_email = _normalize_email(keeper.email) if keeper.email else None
    if keeper_email == loser_email:
        return None
    return loser.email


def transfer_group_memberships(
    session: Session,
    keeper: Contact,
    loser: Contact,
    *,
    conflict_field: str,
) -> None:
    """Move family/organisation membership onto ``keeper`` when it has none."""
    keeper_family = session.scalar(
        select(FamilyMember.family_id).where(FamilyMember.contact_id == keeper.id)
    )
    loser_family = session.scalar(
        select(FamilyMember.family_id).where(FamilyMember.contact_id == loser.id)
    )
    if keeper_family and loser_family and keeper_family != loser_family:
        raise ValidationError(
            "Selected records belong to different families",
            field=conflict_field,
        )
    if not keeper_family and loser_family:
        assert_contact_can_join_family(
            session, contact_id=keeper.id, family_id=loser_family
        )
        session.add(
            FamilyMember(
                family_id=loser_family,
                contact_id=keeper.id,
                role=family_membership_role_from_contact_type(keeper.contact_type),
            )
        )

    keeper_org = session.scalar(
        select(OrganizationMember.organization_id).where(
            OrganizationMember.contact_id == keeper.id
        )
    )
    loser_org = session.scalar(
        select(OrganizationMember.organization_id).where(
            OrganizationMember.contact_id == loser.id
        )
    )
    if keeper_org and loser_org and keeper_org != loser_org:
        raise ValidationError(
            "Selected records belong to different organisations",
            field=conflict_field,
        )
    if not keeper_org and loser_org:
        assert_contact_can_join_organization(
            session, contact_id=keeper.id, organization_id=loser_org
        )
        session.add(
            OrganizationMember(
                organization_id=loser_org,
                contact_id=keeper.id,
                role=organization_membership_role_from_contact_type(
                    keeper.contact_type
                ),
            )
        )


def union_tag_links(
    session: Session,
    keeper_id: UUID,
    loser_id: UUID,
) -> None:
    existing_tag_ids = set(
        session.scalars(
            select(ContactTag.tag_id).where(ContactTag.contact_id == keeper_id)
        ).all()
    )
    loser_tags = session.scalars(
        select(ContactTag).where(ContactTag.contact_id == loser_id)
    ).all()
    for row in loser_tags:
        if row.tag_id not in existing_tag_ids:
            session.add(ContactTag(contact_id=keeper_id, tag_id=row.tag_id))
            existing_tag_ids.add(row.tag_id)


def _relationship_rank(value: RelationshipType) -> int:
    return _RELATIONSHIP_PRIORITY.get(value, 0)
