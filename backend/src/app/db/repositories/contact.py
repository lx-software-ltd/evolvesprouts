"""Repository for CRM contacts."""

from __future__ import annotations

from uuid import UUID

import phonenumbers
from phonenumbers.phonenumberutil import NumberParseException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db.models.note import Note
from app.db.models.contact import Contact
from app.db.models.family import Family, FamilyMember
from app.db.models.location import Location
from app.db.models.organization import Organization, OrganizationMember
from app.db.models.tag import ContactTag
from app.db.models.enums import (
    ContactSource,
    ContactType,
    MailchimpSyncStatus,
    RelationshipType,
)
from app.db.repositories.base import BaseRepository

_SOURCE_PRIORITY: dict[ContactSource, int] = {
    ContactSource.FREE_GUIDE: 10,
    ContactSource.NEWSLETTER: 20,
    ContactSource.INSTAGRAM: 30,
    ContactSource.FACEBOOK: 32,
    ContactSource.WHATSAPP: 35,
    ContactSource.RESERVATION: 40,
    ContactSource.CONTACT_FORM: 50,
    ContactSource.REFERRAL: 60,
    ContactSource.LINKEDIN: 65,
    ContactSource.EVENT: 70,
    ContactSource.PHONE_CALL: 80,
    ContactSource.PUBLIC_WEBSITE: 90,
    ContactSource.MANUAL: 100,
}


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.split()).strip()
    return normalized or None


def _should_replace_first_name(existing: str, incoming: str) -> bool:
    existing_normalized = _normalize_text(existing) or ""
    incoming_normalized = _normalize_text(incoming) or ""
    if not incoming_normalized:
        return False
    if not existing_normalized:
        return True
    return len(incoming_normalized) > len(existing_normalized)


def _should_replace_source(existing: ContactSource, incoming: ContactSource) -> bool:
    return _SOURCE_PRIORITY[incoming] >= _SOURCE_PRIORITY[existing]


def _phone_search_predicates(query: str) -> list:
    """Build OR conditions for phone search (region + national columns)."""
    from app.db.repositories.organization import _escape_like_pattern
    from app.utils.phone import (
        default_phone_region,
        strip_phone_search_term,
        try_parse_international_digit_string,
    )

    normalized = strip_phone_search_term(query)
    if not normalized:
        return []

    preds: list = []

    if normalized.startswith("+"):
        body = normalized[1:]
        if not body.isdigit():
            return []
        intl = try_parse_international_digit_string(body)
        if intl is not None:
            r, nsn = intl
            escaped_nsn = _escape_like_pattern(nsn)
            prefix_pat = f"{escaped_nsn}%"
            sub_pat = f"%{escaped_nsn}%"
            preds.append(
                and_(
                    Contact.phone_region == r,
                    or_(
                        Contact.phone_national_number.ilike(prefix_pat, escape="\\"),
                        Contact.phone_national_number.ilike(sub_pat, escape="\\"),
                    ),
                )
            )
        escaped_body = _escape_like_pattern(body)
        preds.append(
            Contact.phone_national_number.ilike(f"%{escaped_body}%", escape="\\"),
        )
        return preds

    digits_only = "".join(ch for ch in normalized if ch.isdigit())
    if len(digits_only) >= 8:
        intl = try_parse_international_digit_string(digits_only)
        if intl is not None:
            r, nsn = intl
            preds.append(
                and_(
                    Contact.phone_region == r,
                    Contact.phone_national_number == nsn,
                )
            )
        try:
            parsed = phonenumbers.parse(normalized, default_phone_region())
        except NumberParseException:
            parsed = None
        if parsed is not None and phonenumbers.is_valid_number(parsed):
            r = phonenumbers.region_code_for_number(parsed) or default_phone_region()
            if r == "ZZ":
                r = default_phone_region()
            nsn = phonenumbers.national_significant_number(parsed)
            preds.append(
                and_(
                    Contact.phone_region == r,
                    Contact.phone_national_number == nsn,
                )
            )

    escaped = _escape_like_pattern(digits_only if digits_only else normalized)
    preds.append(
        Contact.phone_national_number.ilike(f"%{escaped}%", escape="\\"),
    )
    return preds


class ContactRepository(BaseRepository[Contact]):
    """Repository for CRM contact lookup and upsert operations."""

    def __init__(self, session: Session):
        super().__init__(session, Contact)

    def find_by_email(self, email: str) -> Contact | None:
        """Case-insensitive lookup by email address."""
        normalized_email = _normalize_email(email)
        statement = select(Contact).where(func.lower(Contact.email) == normalized_email)
        return self._session.execute(statement).scalar_one_or_none()

    def upsert_by_email(
        self,
        email: str,
        *,
        first_name: str,
        source: ContactSource,
        source_detail: str | None = None,
        contact_type: ContactType = ContactType.PARENT,
        relationship_type: RelationshipType = RelationshipType.PROSPECT,
    ) -> tuple[Contact, bool]:
        """Insert or update a contact by case-insensitive email key."""
        normalized_email = _normalize_email(email)
        if not normalized_email:
            raise ValueError("email is required")

        normalized_first_name = _normalize_text(first_name)
        if not normalized_first_name:
            raise ValueError("first_name is required")

        normalized_source_detail = _normalize_text(source_detail)
        existing_contact = self.find_by_email(normalized_email)
        if existing_contact is None:
            contact = Contact(
                email=normalized_email,
                first_name=normalized_first_name,
                contact_type=contact_type,
                relationship_type=relationship_type,
                source=source,
                source_detail=normalized_source_detail,
            )
            created_contact = self.create(contact)
            return created_contact, True

        should_update = False
        if _should_replace_first_name(
            existing_contact.first_name, normalized_first_name
        ):
            existing_contact.first_name = normalized_first_name
            should_update = True

        if _should_replace_source(existing_contact.source, source):
            if existing_contact.source != source:
                existing_contact.source = source
                should_update = True
            if (
                normalized_source_detail
                and existing_contact.source_detail != normalized_source_detail
            ):
                if not (
                    existing_contact.source == source == ContactSource.RESERVATION
                    and existing_contact.source_detail
                    and normalized_source_detail
                ):
                    existing_contact.source_detail = normalized_source_detail
                    should_update = True
        elif (
            normalized_source_detail
            and existing_contact.source == source
            and not existing_contact.source_detail
        ):
            existing_contact.source_detail = normalized_source_detail
            should_update = True

        if should_update:
            updated_contact = self.update(existing_contact)
            return updated_contact, False

        return existing_contact, False

    def list_for_admin(
        self,
        *,
        limit: int,
        cursor: UUID | None = None,
        query: str | None = None,
        active: bool | None = None,
        contact_type: ContactType | None = None,
    ) -> list[Contact]:
        """List contacts with optional text search and active (non-archived) filter."""
        from app.db.repositories.organization import _escape_like_pattern

        statement = select(Contact).options(
            selectinload(Contact.contact_tags).selectinload(ContactTag.tag),
            selectinload(Contact.family_members)
            .selectinload(FamilyMember.family)
            .selectinload(Family.location)
            .selectinload(Location.area),
            selectinload(Contact.organization_members)
            .selectinload(OrganizationMember.organization)
            .selectinload(Organization.location)
            .selectinload(Location.area),
            selectinload(Contact.location).selectinload(Location.area),
        )
        if cursor is not None:
            cursor_created_at = (
                select(Contact.created_at).where(Contact.id == cursor).scalar_subquery()
            )
            statement = statement.where(
                or_(
                    Contact.created_at < cursor_created_at,
                    and_(
                        Contact.created_at == cursor_created_at,
                        Contact.id < cursor,
                    ),
                )
            )
        if query:
            escaped = _escape_like_pattern(query.strip())
            pattern = f"%{escaped}%"
            phone_preds = _phone_search_predicates(query.strip())
            text_preds = [
                Contact.first_name.ilike(pattern, escape="\\"),
                Contact.last_name.ilike(pattern, escape="\\"),
                Contact.email.ilike(pattern, escape="\\"),
                Contact.instagram_handle.ilike(pattern, escape="\\"),
            ]
            if phone_preds:
                statement = statement.where(or_(*text_preds, *phone_preds))
            else:
                statement = statement.where(or_(*text_preds))
        if active is True:
            statement = statement.where(Contact.archived_at.is_(None))
        if active is False:
            statement = statement.where(Contact.archived_at.is_not(None))
        if contact_type is not None:
            statement = statement.where(Contact.contact_type == contact_type)
        statement = statement.order_by(
            Contact.created_at.desc(),
            Contact.id.desc(),
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    def search_for_admin_picker(
        self,
        *,
        limit: int,
        query: str,
        active: bool | None = True,
    ) -> list[Contact]:
        """Lightweight contact search for admin pickers (label fields only)."""
        from app.db.repositories.organization import _escape_like_pattern

        statement = select(Contact)
        escaped = _escape_like_pattern(query.strip())
        pattern = f"%{escaped}%"
        phone_preds = _phone_search_predicates(query.strip())
        text_preds = [
            Contact.first_name.ilike(pattern, escape="\\"),
            Contact.last_name.ilike(pattern, escape="\\"),
            Contact.email.ilike(pattern, escape="\\"),
            Contact.instagram_handle.ilike(pattern, escape="\\"),
        ]
        if phone_preds:
            statement = statement.where(or_(*text_preds, *phone_preds))
        else:
            statement = statement.where(or_(*text_preds))
        if active is True:
            statement = statement.where(Contact.archived_at.is_(None))
        if active is False:
            statement = statement.where(Contact.archived_at.is_not(None))
        statement = statement.order_by(
            func.lower(Contact.first_name),
            func.lower(Contact.last_name),
            Contact.id,
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    def count_for_admin(
        self,
        *,
        query: str | None = None,
        active: bool | None = None,
        contact_type: ContactType | None = None,
    ) -> int:
        from app.db.repositories.organization import _escape_like_pattern

        statement = select(func.count(Contact.id))
        if query:
            escaped = _escape_like_pattern(query.strip())
            pattern = f"%{escaped}%"
            phone_preds = _phone_search_predicates(query.strip())
            text_preds = [
                Contact.first_name.ilike(pattern, escape="\\"),
                Contact.last_name.ilike(pattern, escape="\\"),
                Contact.email.ilike(pattern, escape="\\"),
                Contact.instagram_handle.ilike(pattern, escape="\\"),
            ]
            if phone_preds:
                statement = statement.where(or_(*text_preds, *phone_preds))
            else:
                statement = statement.where(or_(*text_preds))
        if active is True:
            statement = statement.where(Contact.archived_at.is_(None))
        if active is False:
            statement = statement.where(Contact.archived_at.is_not(None))
        if contact_type is not None:
            statement = statement.where(Contact.contact_type == contact_type)
        count = self._session.execute(statement).scalar_one_or_none()
        return int(count or 0)

    def list_for_mailchimp_sync(
        self,
        *,
        limit: int,
        cursor: UUID | None,
        statuses: list[MailchimpSyncStatus],
    ) -> list[Contact]:
        """Contacts eligible for Mailchimp upsert batch (oldest first, stable cursor)."""
        statement = select(Contact).where(
            Contact.archived_at.is_(None),
            Contact.email.is_not(None),
            Contact.mailchimp_status.in_(statuses),
        )
        if cursor is not None:
            cursor_created_at = (
                select(Contact.created_at).where(Contact.id == cursor).scalar_subquery()
            )
            statement = statement.where(
                or_(
                    Contact.created_at > cursor_created_at,
                    and_(
                        Contact.created_at == cursor_created_at,
                        Contact.id > cursor,
                    ),
                )
            )
        statement = statement.order_by(
            Contact.created_at.asc(),
            Contact.id.asc(),
        ).limit(limit)
        return list(self._session.execute(statement).scalars().all())

    def count_by_mailchimp_status(self) -> dict[MailchimpSyncStatus, int]:
        """Single aggregate: rows per ``MailchimpSyncStatus``."""
        statement = select(Contact.mailchimp_status, func.count(Contact.id)).group_by(
            Contact.mailchimp_status
        )
        rows = self._session.execute(statement).all()
        counts: dict[MailchimpSyncStatus, int] = {s: 0 for s in MailchimpSyncStatus}
        for status, raw_count in rows:
            key: MailchimpSyncStatus | None = None
            if isinstance(status, MailchimpSyncStatus):
                key = status
            elif isinstance(status, str):
                try:
                    key = MailchimpSyncStatus(status.lower())
                except ValueError:
                    continue
            if key is not None:
                counts[key] = int(raw_count)
        return counts

    def count_archived_with_mailchimp_record(self) -> int:
        statement = select(func.count(Contact.id)).where(
            Contact.archived_at.is_not(None),
            Contact.mailchimp_subscriber_id.is_not(None),
        )
        value = self._session.execute(statement).scalar_one_or_none()
        return int(value or 0)

    def get_by_id_for_admin(self, contact_id: UUID) -> Contact | None:
        statement = (
            select(Contact)
            .where(Contact.id == contact_id)
            .options(
                selectinload(Contact.contact_tags).selectinload(ContactTag.tag),
                selectinload(Contact.family_members)
                .selectinload(FamilyMember.family)
                .selectinload(Family.location)
                .selectinload(Location.area),
                selectinload(Contact.organization_members)
                .selectinload(OrganizationMember.organization)
                .selectinload(Organization.location)
                .selectinload(Location.area),
                selectinload(Contact.location).selectinload(Location.area),
            )
        )
        return self._session.execute(statement).scalar_one_or_none()

    def count_standalone_notes_for_contacts(
        self, contact_ids: list[UUID]
    ) -> dict[UUID, int]:
        """Count CRM notes per contact that are not tied to a sales lead."""
        if not contact_ids:
            return {}
        statement = (
            select(Note.contact_id, func.count(Note.id))
            .where(
                Note.contact_id.in_(contact_ids),
                Note.lead_id.is_(None),
            )
            .group_by(Note.contact_id)
        )
        rows = self._session.execute(statement).all()
        return {row[0]: int(row[1]) for row in rows}
