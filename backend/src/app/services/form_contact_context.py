"""Display-only contact placeholders for personalised training forms."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models.contact import Contact
from app.db.models.enums import ContactType, FamilyRole
from app.db.models.family import Family, FamilyMember

PLACEHOLDER_CONTACT_NAME = "contactName"
PLACEHOLDER_CONTACT_FIRST_NAME = "contactFirstName"
PLACEHOLDER_CONTACT_LAST_NAME = "contactLastName"
PLACEHOLDER_FAMILY_NAME = "familyName"
PLACEHOLDER_CHILDREN_FIRST_NAME = "children.firstName"
PLACEHOLDER_CHILDREN_LAST_NAME = "children.lastName"
PLACEHOLDER_CHILDREN_CONTACT_NAME = "children.contactName"
PLACEHOLDER_HELPERS_FIRST_NAME = "helpers.firstName"
PLACEHOLDER_HELPERS_LAST_NAME = "helpers.lastName"
PLACEHOLDER_HELPERS_CONTACT_NAME = "helpers.contactName"

FALLBACK_CONTACT_NAME = "there"
FALLBACK_CONTACT_FIRST_NAME = "there"
FALLBACK_CONTACT_LAST_NAME = ""
FALLBACK_FAMILY_NAME = "your family"
FALLBACK_CHILDREN = "your child"
FALLBACK_HELPERS = "your helper"

_CHILD_ROLES = frozenset({FamilyRole.CHILD})
_HELPER_ROLES = frozenset({FamilyRole.HELPER})
_CHILD_TYPES = frozenset({ContactType.CHILD})
_HELPER_TYPES = frozenset({ContactType.HELPER})


def fallback_form_contact_placeholders() -> dict[str, str]:
    """English fallbacks when no contact (or household fields) can be resolved."""
    return {
        PLACEHOLDER_CONTACT_NAME: FALLBACK_CONTACT_NAME,
        PLACEHOLDER_CONTACT_FIRST_NAME: FALLBACK_CONTACT_FIRST_NAME,
        PLACEHOLDER_CONTACT_LAST_NAME: FALLBACK_CONTACT_LAST_NAME,
        PLACEHOLDER_FAMILY_NAME: FALLBACK_FAMILY_NAME,
        PLACEHOLDER_CHILDREN_FIRST_NAME: FALLBACK_CHILDREN,
        PLACEHOLDER_CHILDREN_LAST_NAME: FALLBACK_CHILDREN,
        PLACEHOLDER_CHILDREN_CONTACT_NAME: FALLBACK_CHILDREN,
        PLACEHOLDER_HELPERS_FIRST_NAME: FALLBACK_HELPERS,
        PLACEHOLDER_HELPERS_LAST_NAME: FALLBACK_HELPERS,
        PLACEHOLDER_HELPERS_CONTACT_NAME: FALLBACK_HELPERS,
    }


def join_english_list(names: list[str]) -> str:
    """Join names as `A`, `A and B`, or `A, B and C`."""
    cleaned = [name.strip() for name in names if name.strip()]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} and {cleaned[1]}"
    return f"{', '.join(cleaned[:-1])} and {cleaned[-1]}"


def format_contact_display_name(first_name: str, last_name: str | None) -> str:
    """First + last name, trimmed; empty when both parts are blank."""
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    return " ".join(part for part in (first, last) if part)


def build_placeholders_from_parts(
    *,
    first_name: str,
    last_name: str | None,
    family_name: str | None,
    children: list[tuple[str, str | None]],
    helpers: list[tuple[str, str | None]],
) -> dict[str, str]:
    """Build the public placeholder map from already-loaded name parts."""
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    full = format_contact_display_name(first, last)
    family = (family_name or "").strip()
    values = fallback_form_contact_placeholders()
    values[PLACEHOLDER_CONTACT_FIRST_NAME] = first or FALLBACK_CONTACT_FIRST_NAME
    values[PLACEHOLDER_CONTACT_LAST_NAME] = last
    values[PLACEHOLDER_CONTACT_NAME] = full or FALLBACK_CONTACT_NAME
    values[PLACEHOLDER_FAMILY_NAME] = family or FALLBACK_FAMILY_NAME
    values.update(
        _group_placeholder_values(
            children,
            prefix="children",
            empty_fallback=FALLBACK_CHILDREN,
        )
    )
    values.update(
        _group_placeholder_values(
            helpers,
            prefix="helpers",
            empty_fallback=FALLBACK_HELPERS,
        )
    )
    return values


def build_form_contact_placeholders(
    *,
    session: Session,
    contact_id: UUID,
) -> dict[str, str] | None:
    """Return placeholders for one CRM contact, or None when the contact is missing."""
    contact = _load_contact_with_family(session, contact_id)
    if contact is None:
        return None
    family = _first_family(contact)
    children, helpers = _household_name_groups(family)
    family_name = family.family_name if family is not None else None
    return build_placeholders_from_parts(
        first_name=contact.first_name,
        last_name=contact.last_name,
        family_name=family_name,
        children=children,
        helpers=helpers,
    )


def _group_placeholder_values(
    people: list[tuple[str, str | None]],
    *,
    prefix: str,
    empty_fallback: str,
) -> dict[str, str]:
    if not people:
        return {
            f"{prefix}.firstName": empty_fallback,
            f"{prefix}.lastName": empty_fallback,
            f"{prefix}.contactName": empty_fallback,
        }
    first_names = join_english_list([name[0] for name in people])
    last_names = join_english_list([name[1] or "" for name in people])
    full_names = join_english_list(
        [format_contact_display_name(name[0], name[1]) for name in people]
    )
    return {
        f"{prefix}.firstName": first_names or empty_fallback,
        f"{prefix}.lastName": last_names,
        f"{prefix}.contactName": full_names or empty_fallback,
    }


def _load_contact_with_family(session: Session, contact_id: UUID) -> Contact | None:
    statement = (
        select(Contact)
        .where(Contact.id == contact_id)
        .options(
            selectinload(Contact.family_members)
            .selectinload(FamilyMember.family)
            .selectinload(Family.family_members)
            .selectinload(FamilyMember.contact)
        )
    )
    return session.execute(statement).scalar_one_or_none()


def _first_family(contact: Contact) -> Family | None:
    memberships = list(contact.family_members or [])
    if not memberships:
        return None
    return memberships[0].family


def _household_name_groups(
    family: Family | None,
) -> tuple[list[tuple[str, str | None]], list[tuple[str, str | None]]]:
    if family is None:
        return [], []
    children: list[tuple[str, str | None]] = []
    helpers: list[tuple[str, str | None]] = []
    members = sorted(
        family.family_members or [],
        key=lambda row: (
            (row.contact.first_name or "").lower() if row.contact else "",
            (row.contact.last_name or "").lower() if row.contact else "",
            str(row.contact_id),
        ),
    )
    for member in members:
        contact = member.contact
        if contact is None or contact.archived_at is not None:
            continue
        name = (contact.first_name or "", contact.last_name)
        if _is_child_member(member, contact):
            children.append(name)
        elif _is_helper_member(member, contact):
            helpers.append(name)
    return children, helpers


def _is_child_member(member: FamilyMember, contact: Contact) -> bool:
    if member.role in _CHILD_ROLES:
        return True
    return contact.contact_type in _CHILD_TYPES


def _is_helper_member(member: FamilyMember, contact: Contact) -> bool:
    if member.role in _HELPER_ROLES:
        return True
    return contact.contact_type in _HELPER_TYPES


def serialize_form_contact_context(
    *,
    form_slug: str,
    contact_id: UUID,
    placeholders: dict[str, str],
) -> dict[str, Any]:
    """Public JSON body for GET form contact-context."""
    return {
        "formSlug": form_slug,
        "contactId": str(contact_id),
        "placeholders": placeholders,
    }
