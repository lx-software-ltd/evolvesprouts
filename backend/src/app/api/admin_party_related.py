"""Related-record flags and list filters for families and organisations."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

from app.api.admin_contacts_related import (
    ContactRelatedFlags,
    ContactRelatedSerializerKwargs,
    empty_related_flags,
    newest_sales_inbox_channel,
    sales_inbox_state_for_contacts,
)
from app.api.admin_request import query_param
from app.api.admin_services_payload_utils import parse_optional_uuid
from app.db.models import (
    CustomerInvoice,
    Enrollment,
    EnrollmentStatus,
    FamilyMember,
    OrganizationMember,
)
from app.exceptions import ValidationError


def parse_related_party_ids(
    event: Mapping[str, object],
) -> tuple[UUID | None, UUID | None, UUID | None]:
    """Parse mutually exclusive contact_id, family_id, and organization_id."""
    contact_id = parse_optional_uuid(query_param(event, "contact_id"), "contact_id")
    family_id = parse_optional_uuid(query_param(event, "family_id"), "family_id")
    organization_id = parse_optional_uuid(
        query_param(event, "organization_id"), "organization_id"
    )
    present = [
        name
        for name, value in (
            ("contact_id", contact_id),
            ("family_id", family_id),
            ("organization_id", organization_id),
        )
        if value is not None
    ]
    if len(present) > 1:
        raise ValidationError(
            "Only one of contact_id, family_id, or organization_id may be set",
            field=present[1],
        )
    return contact_id, family_id, organization_id


def member_contact_ids_for_families(
    session: Session, family_ids: list[UUID]
) -> dict[UUID, set[UUID]]:
    members: dict[UUID, set[UUID]] = defaultdict(set)
    if not family_ids:
        return members
    for family_id, contact_id in session.execute(
        select(FamilyMember.family_id, FamilyMember.contact_id).where(
            FamilyMember.family_id.in_(family_ids)
        )
    ).all():
        members[family_id].add(contact_id)
    return members


def member_contact_ids_for_organizations(
    session: Session, organization_ids: list[UUID]
) -> dict[UUID, set[UUID]]:
    members: dict[UUID, set[UUID]] = defaultdict(set)
    if not organization_ids:
        return members
    for organization_id, contact_id in session.execute(
        select(OrganizationMember.organization_id, OrganizationMember.contact_id).where(
            OrganizationMember.organization_id.in_(organization_ids)
        )
    ).all():
        members[organization_id].add(contact_id)
    return members


def conversation_contact_ids_for_party(
    session: Session,
    *,
    family_id: UUID | None = None,
    organization_id: UUID | None = None,
) -> set[UUID] | None:
    """Member contact ids for a family/org conversation filter, or None if unused."""
    if family_id is not None:
        return member_contact_ids_for_families(session, [family_id]).get(
            family_id, set()
        )
    if organization_id is not None:
        return member_contact_ids_for_organizations(session, [organization_id]).get(
            organization_id, set()
        )
    return None


def related_flags_for_families(
    session: Session, family_ids: list[UUID]
) -> dict[UUID, ContactRelatedFlags]:
    unique_ids = list(dict.fromkeys(family_ids))
    result: dict[UUID, ContactRelatedFlags] = {
        family_id: empty_related_flags() for family_id in unique_ids
    }
    if not unique_ids:
        return result

    members = member_contact_ids_for_families(session, unique_ids)
    inbox_state = sales_inbox_state_for_contacts(
        session, [cid for ids in members.values() for cid in ids]
    )
    instance_ids = _party_ids_with_direct_or_member_enrollments(
        session,
        unique_ids,
        members,
        Enrollment.family_id,
    )
    invoice_ids = _party_ids_with_direct_or_member_invoices(
        session,
        unique_ids,
        members,
        CustomerInvoice.bill_to_family_id,
    )
    for family_id in unique_ids:
        channel = newest_sales_inbox_channel(inbox_state, members.get(family_id, set()))
        result[family_id] = ContactRelatedFlags(
            has_sales_conversation=channel is not None,
            sales_conversation_channel=channel,
            has_service_instance=family_id in instance_ids,
            has_invoice=family_id in invoice_ids,
        )
    return result


def related_flags_for_organizations(
    session: Session, organization_ids: list[UUID]
) -> dict[UUID, ContactRelatedFlags]:
    unique_ids = list(dict.fromkeys(organization_ids))
    result: dict[UUID, ContactRelatedFlags] = {
        organization_id: empty_related_flags() for organization_id in unique_ids
    }
    if not unique_ids:
        return result

    members = member_contact_ids_for_organizations(session, unique_ids)
    inbox_state = sales_inbox_state_for_contacts(
        session, [cid for ids in members.values() for cid in ids]
    )
    instance_ids = _party_ids_with_direct_or_member_enrollments(
        session,
        unique_ids,
        members,
        Enrollment.organization_id,
    )
    invoice_ids = _party_ids_with_direct_or_member_invoices(
        session,
        unique_ids,
        members,
        CustomerInvoice.bill_to_organization_id,
    )
    for organization_id in unique_ids:
        channel = newest_sales_inbox_channel(
            inbox_state, members.get(organization_id, set())
        )
        result[organization_id] = ContactRelatedFlags(
            has_sales_conversation=channel is not None,
            sales_conversation_channel=channel,
            has_service_instance=organization_id in instance_ids,
            has_invoice=organization_id in invoice_ids,
        )
    return result


def enrollment_instance_ids_for_family(session: Session, family_id: UUID) -> set[UUID]:
    member_ids = member_contact_ids_for_families(session, [family_id]).get(
        family_id, set()
    )
    conditions = [Enrollment.family_id == family_id]
    if member_ids:
        conditions.append(Enrollment.contact_id.in_(member_ids))
    return set(
        session.execute(
            select(Enrollment.instance_id).where(
                Enrollment.status != EnrollmentStatus.CANCELLED,
                or_(*conditions),
            )
        ).scalars()
    )


def enrollment_instance_ids_for_organization(
    session: Session, organization_id: UUID
) -> set[UUID]:
    member_ids = member_contact_ids_for_organizations(session, [organization_id]).get(
        organization_id, set()
    )
    conditions = [Enrollment.organization_id == organization_id]
    if member_ids:
        conditions.append(Enrollment.contact_id.in_(member_ids))
    return set(
        session.execute(
            select(Enrollment.instance_id).where(
                Enrollment.status != EnrollmentStatus.CANCELLED,
                or_(*conditions),
            )
        ).scalars()
    )


def invoice_family_filter(session: Session, family_id: UUID) -> ColumnElement[bool]:
    member_ids = member_contact_ids_for_families(session, [family_id]).get(
        family_id, set()
    )
    conditions = [CustomerInvoice.bill_to_family_id == family_id]
    if member_ids:
        conditions.append(CustomerInvoice.bill_to_contact_id.in_(member_ids))
    return or_(*conditions)


def invoice_organization_filter(
    session: Session, organization_id: UUID
) -> ColumnElement[bool]:
    member_ids = member_contact_ids_for_organizations(session, [organization_id]).get(
        organization_id, set()
    )
    conditions = [CustomerInvoice.bill_to_organization_id == organization_id]
    if member_ids:
        conditions.append(CustomerInvoice.bill_to_contact_id.in_(member_ids))
    return or_(*conditions)


def _party_ids_with_direct_or_member_enrollments(
    session: Session,
    party_ids: list[UUID],
    members: dict[UUID, set[UUID]],
    party_column: InstrumentedAttribute[UUID | None],
) -> set[UUID]:
    matches: set[UUID] = set()
    direct_ids = set(
        session.execute(
            select(party_column).where(
                party_column.in_(party_ids),
                Enrollment.status != EnrollmentStatus.CANCELLED,
            )
        )
        .scalars()
        .all()
    )
    matches.update(pid for pid in direct_ids if pid is not None)

    all_member_ids = {cid for ids in members.values() for cid in ids}
    if all_member_ids:
        member_hits = set(
            session.execute(
                select(Enrollment.contact_id).where(
                    Enrollment.contact_id.in_(all_member_ids),
                    Enrollment.status != EnrollmentStatus.CANCELLED,
                )
            )
            .scalars()
            .all()
        )
        for party_id, contact_ids in members.items():
            if contact_ids & member_hits:
                matches.add(party_id)
    return matches


def _party_ids_with_direct_or_member_invoices(
    session: Session,
    party_ids: list[UUID],
    members: dict[UUID, set[UUID]],
    party_column: InstrumentedAttribute[UUID | None],
) -> set[UUID]:
    matches: set[UUID] = set()
    direct_ids = set(
        session.execute(select(party_column).where(party_column.in_(party_ids)))
        .scalars()
        .all()
    )
    matches.update(pid for pid in direct_ids if pid is not None)

    all_member_ids = {cid for ids in members.values() for cid in ids}
    if all_member_ids:
        member_hits = set(
            session.execute(
                select(CustomerInvoice.bill_to_contact_id).where(
                    CustomerInvoice.bill_to_contact_id.in_(all_member_ids)
                )
            )
            .scalars()
            .all()
        )
        for party_id, contact_ids in members.items():
            if contact_ids & member_hits:
                matches.add(party_id)
    return matches


def family_related_serializer_kwargs(
    session: Session, family_id: UUID
) -> ContactRelatedSerializerKwargs:
    return related_flags_for_families(session, [family_id])[
        family_id
    ].as_serializer_kwargs()


def organization_related_serializer_kwargs(
    session: Session, organization_id: UUID
) -> ContactRelatedSerializerKwargs:
    return related_flags_for_organizations(session, [organization_id])[
        organization_id
    ].as_serializer_kwargs()
