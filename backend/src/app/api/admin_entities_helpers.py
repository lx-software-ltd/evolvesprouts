"""Shared helpers for admin CRM contact/family/organization APIs."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar, cast
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import instance_state

from app.api.admin_request import parse_limit as parse_limit
from app.api.admin_request import request_id as request_id
from app.db.models import (
    Contact,
    ContactTag,
    Family,
    FamilyMember,
    FamilyTag,
    Location,
    Organization,
    OrganizationMember,
    OrganizationTag,
    RelationshipType,
    ServiceInstanceTag,
    Tag,
)
from app.db.models.enums import ContactType
from app.exceptions import ValidationError
from app.utils.logging import get_logger

logger = get_logger(__name__)

LinkT = TypeVar("LinkT", ContactTag, FamilyTag, OrganizationTag)


def parse_active_filter(raw: str | None) -> bool | None:
    if raw is None or raw.strip() == "":
        return None
    normalized = raw.strip().lower()
    if normalized in {"true", "1"}:
        return True
    if normalized in {"false", "0"}:
        return False
    raise ValidationError("active must be true or false", field="active")


def parse_contact_type_filter(raw: str | None) -> ContactType | None:
    """Parse optional CRM contact_type query value; empty means no filter."""
    if raw is None or raw.strip() == "":
        return None
    normalized = raw.strip().lower()
    for member in ContactType:
        if member.value == normalized:
            return member
    raise ValidationError(
        "contact_type must be a valid contact type", field="contact_type"
    )


def parse_optional_bool_body(value: Any, *, field: str) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1"}:
            return True
        if normalized in {"false", "0"}:
            return False
    raise ValidationError(f"{field} must be true or false", field=field)


def serialize_tag_ref(tag: Tag) -> dict[str, Any]:
    return {
        "id": str(tag.id),
        "name": tag.name,
        "color": tag.color,
    }


def require_assignable_tag(
    session: Session,
    tag_id: UUID,
    *,
    field: str = "tag_ids",
) -> Tag:
    """Return a tag row that may be linked to CRM entities or services; archived tags fail."""
    tag = session.get(Tag, tag_id)
    if tag is None:
        raise ValidationError("tag_id not found", field=field)
    if tag.archived_at is not None:
        raise ValidationError("tag is archived", field=field)
    return tag


def assert_contact_can_join_family(
    session: Session,
    *,
    contact_id: UUID,
    family_id: UUID,
) -> None:
    """At most one family per contact (may also belong to one organisation)."""
    fam_stmt = select(FamilyMember.family_id).where(
        FamilyMember.contact_id == contact_id
    )
    existing_family_ids = session.execute(fam_stmt).scalars().all()
    for fid in existing_family_ids:
        if fid != family_id:
            raise ValidationError(
                "Contact is already in another family; remove them from that family first",
                field="contact_id",
            )


def assert_contact_can_join_organization(
    session: Session,
    *,
    contact_id: UUID,
    organization_id: UUID,
) -> None:
    """At most one organisation per contact (may also belong to one family)."""
    org_stmt = select(OrganizationMember.organization_id).where(
        OrganizationMember.contact_id == contact_id
    )
    existing_org_ids = session.execute(org_stmt).scalars().all()
    for oid in existing_org_ids:
        if oid != organization_id:
            raise ValidationError(
                "Contact is already in another organisation; remove them from that organisation first",
                field="contact_id",
            )


def ensure_location_exists(session: Session, location_id: UUID | None) -> None:
    if location_id is None:
        return
    loc = session.get(Location, location_id)
    if loc is None:
        raise ValidationError("location_id not found", field="location_id")


def _loaded_collection(parent: Any, attribute: str) -> list[Any] | None:
    """Return a relationship collection only when this instance already has it."""
    if parent is None or attribute in instance_state(parent).unloaded:
        return None
    return cast(list[Any], getattr(parent, attribute))


def _assignable_tag_ids(session: Session, tag_ids: list[UUID]) -> list[UUID]:
    """Drop duplicate ids after confirming each tag can be linked."""
    unique: list[UUID] = []
    seen: set[UUID] = set()
    for tag_id in tag_ids:
        if tag_id in seen:
            continue
        seen.add(tag_id)
        require_assignable_tag(session, tag_id, field="tag_ids")
        unique.append(tag_id)
    return unique


def _sync_tag_links(
    session: Session,
    existing: list[LinkT],
    wanted_ids: list[UUID],
    *,
    collection: list[LinkT] | None,
    add_link: Callable[[UUID], LinkT],
) -> None:
    """Match ``existing`` to ``wanted_ids`` without a bulk DELETE.

    A bulk delete leaves eager-loaded link objects deleted but still sitting
    on the parent. ``session.add(parent)`` then cascades into that collection
    and raises ``InvalidRequestError``. Removing the link from the loaded
    collection lets ``delete-orphan`` drop the row and keeps the collection
    free of deleted instances.
    """
    wanted = set(wanted_ids)
    current_ids = {row.tag_id for row in existing}
    loaded = collection if collection is not None else []
    for row in list(existing):
        if row.tag_id not in wanted:
            if row in loaded:
                loaded.remove(row)
            else:
                session.delete(row)
    for tag_id in wanted_ids:
        if tag_id not in current_ids:
            session.add(add_link(tag_id))
    session.flush()


def replace_contact_tags(
    session: Session,
    *,
    contact_id: UUID,
    tag_ids: list[UUID],
) -> None:
    wanted = _assignable_tag_ids(session, tag_ids)
    existing = list(
        session.scalars(
            select(ContactTag).where(ContactTag.contact_id == contact_id)
        ).all()
    )
    _sync_tag_links(
        session,
        existing,
        wanted,
        collection=cast(
            list[ContactTag] | None,
            _loaded_collection(session.get(Contact, contact_id), "contact_tags"),
        ),
        add_link=lambda tag_id: ContactTag(contact_id=contact_id, tag_id=tag_id),
    )


def replace_family_tags(
    session: Session,
    *,
    family_id: UUID,
    tag_ids: list[UUID],
) -> None:
    wanted = _assignable_tag_ids(session, tag_ids)
    existing = list(
        session.scalars(select(FamilyTag).where(FamilyTag.family_id == family_id)).all()
    )
    _sync_tag_links(
        session,
        existing,
        wanted,
        collection=cast(
            list[FamilyTag] | None,
            _loaded_collection(session.get(Family, family_id), "family_tags"),
        ),
        add_link=lambda tag_id: FamilyTag(family_id=family_id, tag_id=tag_id),
    )


def replace_organization_tags(
    session: Session,
    *,
    organization_id: UUID,
    tag_ids: list[UUID],
) -> None:
    wanted = _assignable_tag_ids(session, tag_ids)
    existing = list(
        session.scalars(
            select(OrganizationTag).where(
                OrganizationTag.organization_id == organization_id
            )
        ).all()
    )
    _sync_tag_links(
        session,
        existing,
        wanted,
        collection=cast(
            list[OrganizationTag] | None,
            _loaded_collection(
                session.get(Organization, organization_id), "organization_tags"
            ),
        ),
        add_link=lambda tag_id: OrganizationTag(
            organization_id=organization_id, tag_id=tag_id
        ),
    )


def replace_service_instance_tags(
    session: Session,
    *,
    instance_id: UUID,
    tag_ids: list[UUID],
) -> None:
    session.execute(
        delete(ServiceInstanceTag).where(
            ServiceInstanceTag.service_instance_id == instance_id
        )
    )
    seen: set[UUID] = set()
    for tag_id in tag_ids:
        if tag_id in seen:
            continue
        seen.add(tag_id)
        require_assignable_tag(session, tag_id, field="tag_ids")
        session.add(ServiceInstanceTag(service_instance_id=instance_id, tag_id=tag_id))
    session.flush()


def parse_relationship_type(
    value: Any,
    *,
    field: str,
    allowed: frozenset[RelationshipType] | None = None,
) -> RelationshipType:
    """Parse relationship_type for CRM payloads.

    When ``allowed`` is set, the parsed value must be a member of that set
    (after resolving the string to :class:`RelationshipType`).
    """
    if value is None or str(value).strip() == "":
        parsed = RelationshipType.PROSPECT
    else:
        try:
            parsed = RelationshipType(str(value).strip().lower())
        except ValueError as exc:
            raise ValidationError(f"Invalid {field}", field=field) from exc
    if allowed is not None and parsed not in allowed:
        raise ValidationError(
            f"{field} is not allowed for this entity",
            field=field,
        )
    return parsed


FAMILY_RELATIONSHIP_TYPES: frozenset[RelationshipType] = frozenset(
    {
        RelationshipType.PROSPECT,
        RelationshipType.CLIENT,
        RelationshipType.OTHER,
    }
)

ORGANIZATION_RELATIONSHIP_TYPES: frozenset[RelationshipType] = frozenset(
    set(RelationshipType) - {RelationshipType.PAST_CLIENT}
)
