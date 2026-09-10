"""Admin CRM map pins for contacts, families, and organisations."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.admin_entities_serializers import contact_label
from app.db.engine import get_engine
from app.db.models import Contact, Family, FamilyMember, Location, Organization
from app.db.models.enums import RelationshipType
from app.db.models.organization import OrganizationMember
from app.utils import json_response
from app.utils.logging import get_logger

logger = get_logger(__name__)

_CRM_ORG_RELATIONSHIP_TYPES: tuple[RelationshipType, ...] = tuple(
    rt
    for rt in RelationshipType
    if rt not in (RelationshipType.VENDOR, RelationshipType.PARTNER)
)


def is_confirmed_map_location(location: Location | None) -> bool:
    """True when a venue has coordinates and non-blank address text."""
    if location is None:
        return False
    if location.lat is None or location.lng is None:
        return False
    address = location.address
    if address is None:
        return False
    return bool(str(address).strip())


def confirmed_location_sql():
    """SQL filter matching :func:`is_confirmed_map_location`."""
    return and_(
        Location.lat.is_not(None),
        Location.lng.is_not(None),
        Location.address.is_not(None),
        func.length(func.trim(Location.address)) > 0,
    )


def _area_name(location: Location) -> str:
    area = location.area
    if area is None:
        return ""
    return area.name


def _member_labels(members: Iterable[FamilyMember | OrganizationMember]) -> list[str]:
    labels: list[str] = []
    seen: set[str] = set()
    for member in members:
        contact = member.contact
        label = contact_label(contact).strip()
        if not label or label in seen:
            continue
        seen.add(label)
        labels.append(label)
    return labels


def contact_ids_suppressed_by_mapped_families(
    families: Sequence[Family],
) -> set[UUID]:
    """Contact ids that belong to a family that will be shown as a pin."""
    suppressed: set[UUID] = set()
    for family in families:
        if not is_confirmed_map_location(family.location):
            continue
        for member in family.family_members:
            suppressed.add(member.contact_id)
    return suppressed


def serialize_map_pin(
    *,
    entity_type: str,
    entity_id: UUID,
    label: str,
    location: Location,
    contact_type: str | None = None,
    organization_type: str | None = None,
    member_labels: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Build one map-pin payload. Caller must pass a confirmed location."""
    pin: dict[str, Any] = {
        "entity_type": entity_type,
        "id": str(entity_id),
        "label": label,
        "address": str(location.address).strip() if location.address else None,
        "area_name": _area_name(location),
        "lat": float(location.lat) if location.lat is not None else None,
        "lng": float(location.lng) if location.lng is not None else None,
    }
    if contact_type is not None:
        pin["contact_type"] = contact_type
    if organization_type is not None:
        pin["organization_type"] = organization_type
    if member_labels is not None:
        pin["member_labels"] = list(member_labels)
    return pin


def build_map_pin_items(
    *,
    families: Sequence[Family],
    organizations: Sequence[Organization],
    contacts: Sequence[Contact],
) -> list[dict[str, Any]]:
    """Serialize confirmed pins and hide contacts that belong to a mapped family."""
    suppressed = contact_ids_suppressed_by_mapped_families(families)
    items: list[dict[str, Any]] = []

    for family in families:
        location = family.location
        if not is_confirmed_map_location(location) or location is None:
            continue
        items.append(
            serialize_map_pin(
                entity_type="family",
                entity_id=family.id,
                label=family.family_name,
                location=location,
                member_labels=_member_labels(family.family_members),
            )
        )

    for organization in organizations:
        location = organization.location
        if not is_confirmed_map_location(location) or location is None:
            continue
        items.append(
            serialize_map_pin(
                entity_type="organization",
                entity_id=organization.id,
                label=organization.name,
                location=location,
                organization_type=organization.organization_type.value,
                member_labels=_member_labels(organization.organization_members),
            )
        )

    for contact in contacts:
        if contact.id in suppressed:
            continue
        location = contact.location
        if not is_confirmed_map_location(location) or location is None:
            continue
        items.append(
            serialize_map_pin(
                entity_type="contact",
                entity_id=contact.id,
                label=contact_label(contact) or str(contact.id),
                location=location,
                contact_type=contact.contact_type.value,
            )
        )

    items.sort(
        key=lambda item: (item["entity_type"], item["label"].lower(), item["id"])
    )
    return items


def load_map_pin_entities(
    session: Session,
) -> tuple[list[Family], list[Organization], list[Contact]]:
    """Load active CRM rows whose linked venue is a confirmed map location."""
    confirmed = confirmed_location_sql()

    families = list(
        session.scalars(
            select(Family)
            .join(Location, Family.location_id == Location.id)
            .where(Family.archived_at.is_(None), confirmed)
            .options(
                selectinload(Family.location).selectinload(Location.area),
                selectinload(Family.family_members).selectinload(FamilyMember.contact),
            )
        ).all()
    )

    organizations = list(
        session.scalars(
            select(Organization)
            .join(Location, Organization.location_id == Location.id)
            .where(
                Organization.archived_at.is_(None),
                Organization.relationship_type.in_(_CRM_ORG_RELATIONSHIP_TYPES),
                confirmed,
            )
            .options(
                selectinload(Organization.location).selectinload(Location.area),
                selectinload(Organization.organization_members).selectinload(
                    OrganizationMember.contact
                ),
            )
        ).all()
    )

    suppressed = contact_ids_suppressed_by_mapped_families(families)
    contact_statement = (
        select(Contact)
        .join(Location, Contact.location_id == Location.id)
        .where(Contact.archived_at.is_(None), confirmed)
        .options(selectinload(Contact.location).selectinload(Location.area))
    )
    if suppressed:
        contact_statement = contact_statement.where(
            Contact.id.notin_(tuple(suppressed))
        )
    contacts = list(session.scalars(contact_statement).all())
    return families, organizations, contacts


def list_contact_map_pins(event: Mapping[str, Any]) -> dict[str, Any]:
    """Return confirmed CRM map pins for the Contacts Map tab."""
    logger.info("Listing admin CRM map pins")
    with Session(get_engine()) as session:
        families, organizations, contacts = load_map_pin_entities(session)
        items = build_map_pin_items(
            families=families,
            organizations=organizations,
            contacts=contacts,
        )
        return json_response(200, {"items": items}, event=event)
