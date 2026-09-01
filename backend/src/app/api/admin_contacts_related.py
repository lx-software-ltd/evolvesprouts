"""Batch related-record flags for admin contact summaries."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.db.models import (
    CustomerInvoice,
    Enrollment,
    EnrollmentStatus,
    FamilyMember,
    MetaConversation,
    OrganizationMember,
    WhatsAppConversation,
)
from app.db.models.enums import MetaChannel

SALES_INBOX_WHATSAPP = "whatsapp"
SALES_INBOX_INSTAGRAM = "instagram"
SALES_INBOX_MESSENGER = "messenger"


@dataclass(frozen=True, slots=True)
class ContactRelatedFlags:
    """Presence of related sales, service, and invoice records."""

    has_sales_conversation: bool = False
    sales_conversation_channel: str | None = None
    has_service_instance: bool = False
    has_invoice: bool = False

    def as_serializer_kwargs(self) -> dict[str, bool | str | None]:
        return {
            "has_sales_conversation": self.has_sales_conversation,
            "sales_conversation_channel": self.sales_conversation_channel,
            "has_service_instance": self.has_service_instance,
            "has_invoice": self.has_invoice,
        }


def empty_related_flags() -> ContactRelatedFlags:
    return ContactRelatedFlags()


def related_flags_for_contacts(
    session: Session, contact_ids: list[UUID]
) -> dict[UUID, ContactRelatedFlags]:
    """Return related-record flags for each contact id (missing ids get empty flags)."""
    unique_ids = list(dict.fromkeys(contact_ids))
    result: dict[UUID, ContactRelatedFlags] = {
        contact_id: empty_related_flags() for contact_id in unique_ids
    }
    if not unique_ids:
        return result

    latest_channel = _latest_sales_inbox_channel(session, unique_ids)
    instance_ids = _contact_ids_with_service_instances(session, unique_ids)
    invoice_ids = _contact_ids_with_invoices(session, unique_ids)

    for contact_id in unique_ids:
        channel = latest_channel.get(contact_id)
        result[contact_id] = ContactRelatedFlags(
            has_sales_conversation=channel is not None,
            sales_conversation_channel=channel,
            has_service_instance=contact_id in instance_ids,
            has_invoice=contact_id in invoice_ids,
        )
    return result


def contact_family_and_org_ids(
    session: Session, contact_id: UUID
) -> tuple[list[UUID], list[UUID]]:
    """Return family and organisation ids the contact belongs to."""
    family_ids = list(
        session.execute(
            select(FamilyMember.family_id).where(FamilyMember.contact_id == contact_id)
        )
        .scalars()
        .all()
    )
    organization_ids = list(
        session.execute(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.contact_id == contact_id
            )
        )
        .scalars()
        .all()
    )
    return family_ids, organization_ids


def _meta_channel_to_sales_inbox(channel: MetaChannel | str) -> str:
    value = channel.value if isinstance(channel, MetaChannel) else str(channel)
    if value == MetaChannel.INSTAGRAM.value:
        return SALES_INBOX_INSTAGRAM
    return SALES_INBOX_MESSENGER


def _is_newer(
    candidate_at: datetime | None,
    incumbent_at: datetime | None,
) -> bool:
    if incumbent_at is None:
        return True
    if candidate_at is None:
        return False
    return candidate_at > incumbent_at


def _latest_sales_inbox_channel(
    session: Session, contact_ids: list[UUID]
) -> dict[UUID, str]:
    latest_at: dict[UUID, datetime | None] = {}
    latest_channel: dict[UUID, str] = {}

    wa_rows = session.execute(
        select(
            WhatsAppConversation.contact_id, WhatsAppConversation.last_message_at
        ).where(WhatsAppConversation.contact_id.in_(contact_ids))
    ).all()
    for contact_id, last_message_at in wa_rows:
        if contact_id is None:
            continue
        if contact_id not in latest_channel or _is_newer(
            last_message_at, latest_at.get(contact_id)
        ):
            latest_at[contact_id] = last_message_at
            latest_channel[contact_id] = SALES_INBOX_WHATSAPP

    meta_rows = session.execute(
        select(
            MetaConversation.contact_id,
            MetaConversation.channel,
            MetaConversation.last_message_at,
        ).where(MetaConversation.contact_id.in_(contact_ids))
    ).all()
    for contact_id, channel, last_message_at in meta_rows:
        if contact_id is None:
            continue
        inbox = _meta_channel_to_sales_inbox(channel)
        if contact_id not in latest_channel or _is_newer(
            last_message_at, latest_at.get(contact_id)
        ):
            latest_at[contact_id] = last_message_at
            latest_channel[contact_id] = inbox

    return latest_channel


def _membership_maps(
    session: Session, contact_ids: list[UUID]
) -> tuple[dict[UUID, set[UUID]], dict[UUID, set[UUID]], set[UUID], set[UUID]]:
    family_ids_by_contact: dict[UUID, set[UUID]] = defaultdict(set)
    org_ids_by_contact: dict[UUID, set[UUID]] = defaultdict(set)

    for contact_id, family_id in session.execute(
        select(FamilyMember.contact_id, FamilyMember.family_id).where(
            FamilyMember.contact_id.in_(contact_ids)
        )
    ).all():
        family_ids_by_contact[contact_id].add(family_id)

    for contact_id, organization_id in session.execute(
        select(OrganizationMember.contact_id, OrganizationMember.organization_id).where(
            OrganizationMember.contact_id.in_(contact_ids)
        )
    ).all():
        org_ids_by_contact[contact_id].add(organization_id)

    all_family_ids = {fid for ids in family_ids_by_contact.values() for fid in ids}
    all_org_ids = {oid for ids in org_ids_by_contact.values() for oid in ids}
    return family_ids_by_contact, org_ids_by_contact, all_family_ids, all_org_ids


def _contact_ids_with_service_instances(
    session: Session, contact_ids: list[UUID]
) -> set[UUID]:
    family_ids_by_contact, org_ids_by_contact, all_family_ids, all_org_ids = (
        _membership_maps(session, contact_ids)
    )
    matches: set[UUID] = set()

    direct_ids = set(
        session.execute(
            select(Enrollment.contact_id).where(
                Enrollment.contact_id.in_(contact_ids),
                Enrollment.status != EnrollmentStatus.CANCELLED,
            )
        )
        .scalars()
        .all()
    )
    matches.update(cid for cid in direct_ids if cid is not None)

    if all_family_ids:
        family_hits = set(
            session.execute(
                select(Enrollment.family_id).where(
                    Enrollment.family_id.in_(all_family_ids),
                    Enrollment.status != EnrollmentStatus.CANCELLED,
                )
            )
            .scalars()
            .all()
        )
        for contact_id, family_ids in family_ids_by_contact.items():
            if family_ids & family_hits:
                matches.add(contact_id)

    if all_org_ids:
        org_hits = set(
            session.execute(
                select(Enrollment.organization_id).where(
                    Enrollment.organization_id.in_(all_org_ids),
                    Enrollment.status != EnrollmentStatus.CANCELLED,
                )
            )
            .scalars()
            .all()
        )
        for contact_id, organization_ids in org_ids_by_contact.items():
            if organization_ids & org_hits:
                matches.add(contact_id)

    return matches


def _contact_ids_with_invoices(session: Session, contact_ids: list[UUID]) -> set[UUID]:
    family_ids_by_contact, org_ids_by_contact, all_family_ids, all_org_ids = (
        _membership_maps(session, contact_ids)
    )
    matches: set[UUID] = set()

    direct_ids = set(
        session.execute(
            select(CustomerInvoice.bill_to_contact_id).where(
                CustomerInvoice.bill_to_contact_id.in_(contact_ids)
            )
        )
        .scalars()
        .all()
    )
    matches.update(cid for cid in direct_ids if cid is not None)

    if all_family_ids:
        family_hits = set(
            session.execute(
                select(CustomerInvoice.bill_to_family_id).where(
                    CustomerInvoice.bill_to_family_id.in_(all_family_ids)
                )
            )
            .scalars()
            .all()
        )
        for contact_id, family_ids in family_ids_by_contact.items():
            if family_ids & family_hits:
                matches.add(contact_id)

    if all_org_ids:
        org_hits = set(
            session.execute(
                select(CustomerInvoice.bill_to_organization_id).where(
                    CustomerInvoice.bill_to_organization_id.in_(all_org_ids)
                )
            )
            .scalars()
            .all()
        )
        for contact_id, organization_ids in org_ids_by_contact.items():
            if organization_ids & org_hits:
                matches.add(contact_id)

    return matches


def enrollment_instance_ids_for_contact(session: Session, contact_id: UUID) -> set[UUID]:
    """Instance ids with a non-cancelled enrollment attributed to the contact."""
    family_ids, organization_ids = contact_family_and_org_ids(session, contact_id)
    conditions = [Enrollment.contact_id == contact_id]
    if family_ids:
        conditions.append(Enrollment.family_id.in_(family_ids))
    if organization_ids:
        conditions.append(Enrollment.organization_id.in_(organization_ids))
    rows = session.execute(
        select(Enrollment.instance_id).where(
            Enrollment.status != EnrollmentStatus.CANCELLED,
            or_(*conditions),
        )
    ).scalars()
    return set(rows)


def invoice_party_filter(session: Session, contact_id: UUID) -> ColumnElement[bool]:
    """SQLAlchemy filter matching invoices billed to the contact or their parties."""
    family_ids, organization_ids = contact_family_and_org_ids(session, contact_id)
    conditions = [CustomerInvoice.bill_to_contact_id == contact_id]
    if family_ids:
        conditions.append(CustomerInvoice.bill_to_family_id.in_(family_ids))
    if organization_ids:
        conditions.append(CustomerInvoice.bill_to_organization_id.in_(organization_ids))
    return or_(*conditions)
