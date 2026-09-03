"""Merge selected sales leads and consolidate their contacts."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.api.admin_contacts_helpers import REFERRAL_CONTACT_METADATA_KEY
from app.api.admin_entities_helpers import (
    assert_contact_can_join_family,
    assert_contact_can_join_organization,
)
from app.db.models import (
    CompletionCertificate,
    Contact,
    ContactTag,
    CustomerInvoice,
    CustomerPayment,
    Enrollment,
    FamilyMember,
    MetaConversation,
    Note,
    OrganizationMember,
    SalesLead,
    SalesLeadAiSuggestion,
    SalesLeadAiSuggestionJob,
    SalesLeadEvent,
    WhatsAppConversation,
)
from app.db.models.enums import (
    LeadEventType,
    MailchimpSyncStatus,
    RelationshipType,
)
from app.db.models.family import family_membership_role_from_contact_type
from app.db.models.organization import organization_membership_role_from_contact_type
from app.db.repositories.contact import (
    _normalize_email,
    _normalize_text,
    _should_replace_first_name,
    _should_replace_source,
)
from app.exceptions import NotFoundError, ValidationError
from app.services.lead_funnel_automation import _LEAD_TYPE_RANK

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


def merge_leads(
    session: Session,
    *,
    lead_ids: list[UUID],
    keeper_lead_id: UUID,
    actor_sub: str,
) -> tuple[SalesLead, list[str]]:
    """Merge ``lead_ids`` into ``keeper_lead_id`` and delete orphaned contacts.

    Returns the surviving lead and Mailchimp emails to archive after commit.
    """
    unique_ids = list(dict.fromkeys(lead_ids))
    if len(unique_ids) < 2:
        raise ValidationError("At least two lead_ids are required", field="lead_ids")
    if keeper_lead_id not in unique_ids:
        raise ValidationError(
            "keeper_lead_id must be one of lead_ids", field="keeper_lead_id"
        )

    leads = session.scalars(select(SalesLead).where(SalesLead.id.in_(unique_ids))).all()
    if len(leads) != len(unique_ids):
        raise NotFoundError("SalesLead", "one or more lead_ids")

    keeper = next(lead for lead in leads if lead.id == keeper_lead_id)
    merged_leads = [lead for lead in leads if lead.id != keeper_lead_id]
    if keeper.contact_id is None:
        raise ValidationError(
            "Keeper lead must belong to a contact", field="keeper_lead_id"
        )
    for lead in merged_leads:
        if lead.contact_id is None:
            raise ValidationError(
                "All selected leads must belong to a contact", field="lead_ids"
            )

    keeper_contact = session.get(Contact, keeper.contact_id)
    if keeper_contact is None:
        raise NotFoundError("Contact", str(keeper.contact_id))

    mailchimp_archive_emails: list[str] = []
    loser_contact_ids = {
        lead.contact_id for lead in merged_leads if lead.contact_id != keeper.contact_id
    }
    for loser_contact_id in loser_contact_ids:
        loser_contact = session.get(Contact, loser_contact_id)
        if loser_contact is None:
            raise NotFoundError("Contact", str(loser_contact_id))
        _merge_contact_fields(keeper_contact, loser_contact)
        _transfer_memberships(session, keeper_contact, loser_contact)
        _union_contact_tags(session, keeper_contact.id, loser_contact.id)
        _reassign_contact_foreign_keys(
            session,
            from_contact_id=loser_contact.id,
            to_contact_id=keeper_contact.id,
            actor_sub=actor_sub,
        )
        _remap_referral_metadata(session, loser_contact.id, keeper_contact.id)
        email = _mailchimp_email_for_contact(loser_contact)
        if email:
            mailchimp_archive_emails.append(email)
        session.delete(loser_contact)
        session.flush()

    keeper.contact_id = keeper_contact.id
    surviving_merged: list[SalesLead] = []
    for merged_lead in merged_leads:
        loaded = session.get(SalesLead, merged_lead.id)
        if loaded is not None and loaded.id != keeper.id:
            surviving_merged.append(loaded)
    _merge_lead_records(session, keeper, surviving_merged, actor_sub=actor_sub)
    keeper.updated_at = datetime.now(UTC)
    session.flush()
    return keeper, mailchimp_archive_emails


def _merge_contact_fields(keeper: Contact, loser: Contact) -> None:
    if loser.email:
        loser_email = _normalize_email(loser.email)
        if keeper.email:
            if _normalize_email(keeper.email) != loser_email:
                raise ValidationError(
                    "Cannot merge contacts with different email addresses",
                    field="lead_ids",
                )
        else:
            keeper.email = loser_email

    if loser.instagram_handle:
        keeper_handle = (keeper.instagram_handle or "").lstrip("@").lower()
        loser_handle = loser.instagram_handle.lstrip("@").lower()
        if keeper.instagram_handle:
            if keeper_handle != loser_handle:
                raise ValidationError(
                    "Cannot merge contacts with different Instagram handles",
                    field="lead_ids",
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


def _relationship_rank(value: RelationshipType) -> int:
    return _RELATIONSHIP_PRIORITY.get(value, 0)


def _transfer_memberships(
    session: Session,
    keeper: Contact,
    loser: Contact,
) -> None:
    keeper_family = session.scalar(
        select(FamilyMember.family_id).where(FamilyMember.contact_id == keeper.id)
    )
    loser_family = session.scalar(
        select(FamilyMember.family_id).where(FamilyMember.contact_id == loser.id)
    )
    if keeper_family and loser_family and keeper_family != loser_family:
        raise ValidationError(
            "Selected leads belong to contacts in different families",
            field="lead_ids",
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
            "Selected leads belong to contacts in different organisations",
            field="lead_ids",
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


def _union_contact_tags(
    session: Session,
    keeper_contact_id: UUID,
    loser_contact_id: UUID,
) -> None:
    existing_tag_ids = set(
        session.scalars(
            select(ContactTag.tag_id).where(ContactTag.contact_id == keeper_contact_id)
        ).all()
    )
    loser_tags = session.scalars(
        select(ContactTag).where(ContactTag.contact_id == loser_contact_id)
    ).all()
    for row in loser_tags:
        if row.tag_id not in existing_tag_ids:
            session.add(ContactTag(contact_id=keeper_contact_id, tag_id=row.tag_id))
            existing_tag_ids.add(row.tag_id)


def _reassign_contact_foreign_keys(
    session: Session,
    *,
    from_contact_id: UUID,
    to_contact_id: UUID,
    actor_sub: str,
) -> None:
    session.execute(
        update(CompletionCertificate)
        .where(CompletionCertificate.contact_id == from_contact_id)
        .values(contact_id=to_contact_id)
    )
    session.execute(
        update(CustomerInvoice)
        .where(CustomerInvoice.bill_to_contact_id == from_contact_id)
        .values(bill_to_contact_id=to_contact_id)
    )
    session.execute(
        update(CustomerPayment)
        .where(CustomerPayment.contact_id == from_contact_id)
        .values(contact_id=to_contact_id)
    )
    session.execute(
        update(Note)
        .where(Note.contact_id == from_contact_id)
        .values(contact_id=to_contact_id)
    )
    session.execute(
        update(WhatsAppConversation)
        .where(WhatsAppConversation.contact_id == from_contact_id)
        .values(contact_id=to_contact_id)
    )
    session.execute(
        update(MetaConversation)
        .where(MetaConversation.contact_id == from_contact_id)
        .values(contact_id=to_contact_id)
    )
    session.execute(
        update(Enrollment)
        .where(Enrollment.bill_to_contact_id == from_contact_id)
        .values(bill_to_contact_id=to_contact_id)
    )
    _reassign_enrollments(session, from_contact_id, to_contact_id)

    loser_leads = list(
        session.scalars(
            select(SalesLead).where(SalesLead.contact_id == from_contact_id)
        ).all()
    )
    for lead in loser_leads:
        conflict = session.scalar(
            select(SalesLead.id).where(
                SalesLead.contact_id == to_contact_id,
                SalesLead.lead_type == lead.lead_type,
                SalesLead.asset_id == lead.asset_id,
                SalesLead.asset_id.is_not(None),
                SalesLead.id != lead.id,
            )
        )
        if conflict is not None:
            target = session.get(SalesLead, conflict)
            if target is None:
                continue
            _merge_lead_records(session, target, [lead], actor_sub=actor_sub)
        else:
            lead.contact_id = to_contact_id


def _reassign_enrollments(
    session: Session,
    from_contact_id: UUID,
    to_contact_id: UUID,
) -> None:
    keeper_instance_ids = set(
        session.scalars(
            select(Enrollment.instance_id).where(Enrollment.contact_id == to_contact_id)
        ).all()
    )
    loser_enrollments = session.scalars(
        select(Enrollment).where(Enrollment.contact_id == from_contact_id)
    ).all()
    for enrollment in loser_enrollments:
        if enrollment.instance_id in keeper_instance_ids:
            session.delete(enrollment)
        else:
            enrollment.contact_id = to_contact_id
            keeper_instance_ids.add(enrollment.instance_id)


def _remap_referral_metadata(
    session: Session,
    loser_contact_id: UUID,
    keeper_contact_id: UUID,
) -> None:
    loser_key = str(loser_contact_id)
    contacts = session.scalars(
        select(Contact).where(
            Contact.source_metadata[REFERRAL_CONTACT_METADATA_KEY].as_string()
            == loser_key
        )
    ).all()
    for contact in contacts:
        updated = dict(contact.source_metadata or {})
        updated[REFERRAL_CONTACT_METADATA_KEY] = str(keeper_contact_id)
        contact.source_metadata = updated


def _merge_lead_records(
    session: Session,
    keeper: SalesLead,
    merged_leads: Iterable[SalesLead],
    *,
    actor_sub: str,
) -> None:
    merged_ids: list[UUID] = []
    for lead in merged_leads:
        if lead.id == keeper.id:
            continue
        merged_ids.append(lead.id)
        if _LEAD_TYPE_RANK.get(lead.lead_type, 0) > _LEAD_TYPE_RANK.get(
            keeper.lead_type, 0
        ):
            keeper.lead_type = lead.lead_type
        if keeper.assigned_to is None and lead.assigned_to is not None:
            keeper.assigned_to = lead.assigned_to
        if lead.is_manual:
            keeper.is_manual = True
        if keeper.asset_id is None and lead.asset_id is not None:
            keeper.asset_id = lead.asset_id
        if keeper.converted_at is None and lead.converted_at is not None:
            keeper.converted_at = lead.converted_at
        if keeper.lost_at is None and lead.lost_at is not None:
            keeper.lost_at = lead.lost_at
        if keeper.lost_reason is None and lead.lost_reason is not None:
            keeper.lost_reason = lead.lost_reason

    if not merged_ids:
        return

    for model, column in (
        (Note, Note.lead_id),
        (SalesLeadEvent, SalesLeadEvent.lead_id),
        (SalesLeadAiSuggestion, SalesLeadAiSuggestion.lead_id),
        (SalesLeadAiSuggestionJob, SalesLeadAiSuggestionJob.lead_id),
        (WhatsAppConversation, WhatsAppConversation.lead_id),
        (MetaConversation, MetaConversation.lead_id),
    ):
        session.execute(
            update(model).where(column.in_(merged_ids)).values(lead_id=keeper.id)
        )

    session.execute(delete(SalesLead).where(SalesLead.id.in_(merged_ids)))

    session.add(
        SalesLeadEvent(
            lead_id=keeper.id,
            event_type=LeadEventType.ACTION_RECORDED,
            metadata={
                "source": "admin_lead_merge",
                "merged_lead_ids": [str(value) for value in merged_ids],
                "actor_sub": actor_sub,
            },
            created_by=actor_sub,
        )
    )


def _mailchimp_email_for_contact(contact: Contact) -> str | None:
    if not contact.email:
        return None
    if contact.mailchimp_status not in _MAILCHIMP_REMOVE_STATUSES:
        return None
    return contact.email
