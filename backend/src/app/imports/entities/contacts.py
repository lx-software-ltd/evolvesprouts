"""Contacts entity: legacy ``person`` rows → ``contacts`` + membership rows."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from typing import Any
from typing import ClassVar
from uuid import UUID

from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy import exists
from sqlalchemy.orm import Session

from app.db.models import Contact
from app.db.models import FamilyMember
from app.db.models import OrganizationMember
from app.db.models.enums import ContactSource
from app.db.models.enums import ContactType
from app.db.models.enums import FamilyRole
from app.db.models.enums import MailchimpSyncStatus
from app.db.models.enums import OrganizationRole
from app.db.models.enums import RelationshipType
from app.imports.base import ImportStats
from app.imports.base import ImporterContext
from app.imports.base import preview_line
from app.imports.base import preview_line_email
from app.imports.entities._legacy_family_common import LegacyPersonRow
from app.imports.entities._legacy_family_common import parse_legacy_country_dial_codes
from app.imports.entities._legacy_family_common import parse_legacy_person_rows
from app.imports.registry import register
from app.imports import refs
from app.utils.logging import get_logger
from app.utils.validators import instagram_handle_for_storage

logger = get_logger(__name__)


def _clean_name_part(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if s in {"", "?", "."}:
        return None
    return s


def _map_contact_type(kind: str | None) -> ContactType:
    k = (kind or "").strip().lower()
    if k == "parent":
        return ContactType.PARENT
    if k == "child":
        return ContactType.CHILD
    if k == "helper":
        return ContactType.HELPER
    if k == "partner":
        return ContactType.PROFESSIONAL
    if k:
        logger.warning(
            "Unknown legacy person.kind=%r; mapping contact_type to other",
            k,
        )
    return ContactType.OTHER


def _map_contact_source(referral_source: str | None) -> ContactSource:
    if referral_source is None:
        return ContactSource.MANUAL
    m = {
        "instagram": ContactSource.INSTAGRAM,
        "whatsapp": ContactSource.WHATSAPP,
        "email": ContactSource.NEWSLETTER,
        "mouth_to_mouth": ContactSource.REFERRAL,
        "person": ContactSource.REFERRAL,
    }
    return m.get(referral_source, ContactSource.MANUAL)


def _family_role(kind: str | None) -> FamilyRole:
    k = (kind or "").strip().lower()
    if k == "parent":
        return FamilyRole.PARENT
    if k == "child":
        return FamilyRole.CHILD
    if k == "helper":
        return FamilyRole.HELPER
    return FamilyRole.OTHER


def _org_role(kind: str | None) -> OrganizationRole:
    k = (kind or "").strip().lower()
    if k == "partner":
        return OrganizationRole.PARTNER
    return OrganizationRole.MEMBER


def _split_phone(
    raw_phone: str | None,
    dial_by_id: dict[int, str],
    country_id: int | None,
) -> tuple[str | None, str | None]:
    """Resolve legacy dial id → region, parse national digits for ``contacts`` columns."""
    import phonenumbers
    from phonenumbers.phonenumberutil import NumberParseException

    if raw_phone is None:
        return None, None
    p = str(raw_phone).strip()
    if not p:
        return None, None

    region_from_dial: str | None = None
    if country_id is not None and country_id in dial_by_id:
        dial_raw = str(dial_by_id[country_id]).strip().lstrip("+")
        try:
            cc = int(dial_raw)
        except ValueError:
            cc = None
        if cc is not None:
            region_from_dial = phonenumbers.region_code_for_country_code(cc)

    try_order: list[str | None] = []
    if region_from_dial:
        try_order.append(region_from_dial)
    try_order.append(None)
    if region_from_dial != "HK":
        try_order.append("HK")

    for region in try_order:
        try:
            parsed = phonenumbers.parse(p, region)
        except NumberParseException:
            continue
        if not phonenumbers.is_possible_number(parsed):
            continue
        r = phonenumbers.region_code_for_number(parsed)
        if not r or r == "ZZ":
            r = region_from_dial or "HK"
        return r, phonenumbers.national_significant_number(parsed)
    return None, None


def _source_detail(occupation: str | None, company: str | None) -> str | None:
    occ = (occupation or "").strip()
    comp = (company or "").strip()
    if occ and comp:
        return f"{occ} @ {comp}"
    if occ:
        return occ
    if comp:
        return comp
    return None


def _membership_exists(
    session: Session,
    *,
    contact_id: UUID,
    parent_uuid: UUID,
    org_mode: bool,
) -> bool:
    if org_mode:
        q = select(
            exists().where(
                OrganizationMember.contact_id == contact_id,
                OrganizationMember.organization_id == parent_uuid,
            ),
        )
    else:
        q = select(
            exists().where(
                FamilyMember.contact_id == contact_id,
                FamilyMember.family_id == parent_uuid,
            ),
        )
    return bool(session.execute(q).scalar())


def _title_trim(occupation: str | None, max_len: int = 150) -> str | None:
    if occupation is None:
        return None
    s = str(occupation).strip()
    if not s:
        return None
    return s[:max_len]


class ContactsImporter:
    """Import legacy ``person`` rows into ``contacts``."""

    ENTITY: ClassVar[str] = "contacts"
    #: ``organizations`` is optional (tenant may have zero imported orgs); refs still loaded when present.
    DEPENDS_ON: ClassVar[tuple[str, ...]] = ("families", "organizations")
    PII: ClassVar[bool] = True
    PREVIEW_MAX_ROWS: ClassVar[int] = 50

    def parse(self, sql_text: str) -> Sequence[LegacyPersonRow]:
        return parse_legacy_person_rows(sql_text)

    def resolve_context(self, session: Session, *, dry_run: bool) -> ImporterContext:
        del dry_run
        email_map: dict[str, UUID] = {}
        q_em = select(func.lower(Contact.email), Contact.id).where(
            Contact.email.is_not(None)
        )
        for em, cid in session.execute(q_em).all():
            if em:
                email_map[str(em)] = cid if isinstance(cid, UUID) else UUID(str(cid))
        insta_map: dict[str, UUID] = {}
        q_in = select(func.lower(Contact.instagram_handle), Contact.id).where(
            Contact.instagram_handle.is_not(None)
        )
        for ih, cid in session.execute(q_in).all():
            if ih:
                insta_map[str(ih)] = cid if isinstance(cid, UUID) else UUID(str(cid))
        return ImporterContext(
            email_to_contact_id=email_map,
            instagram_to_contact_id=insta_map,
        )

    def _row_detail(
        self,
        ctx: ImporterContext,
        p: LegacyPersonRow,
        *,
        contact_id: UUID | None,
        dry_run: bool,
        membership_tables: list[dict[str, Any]],
        contact_id_for_membership: str | None,
    ) -> dict[str, Any]:
        fn = _clean_name_part(p.first_name) or ""
        ln = _clean_name_part(p.last_name)
        meta: dict[str, Any] = {
            "legacy_person_id": p.legacy_id,
            "legacy_family_id": p.family_id,
            "referral_person_id": p.referral_person_id,
        }
        k = (p.kind or "").strip().lower()
        rel = RelationshipType.PARTNER if k == "partner" else RelationshipType.PROSPECT
        cvals: dict[str, Any] = {
            "email": preview_line_email(self, p.email or "") if p.email else None,
            "instagram_handle": preview_line(self, p.instagram_id or "")
            if p.instagram_id
            else None,
            "first_name": preview_line(self, fn),
            "last_name": preview_line(self, ln) if ln else None,
            "contact_type": _map_contact_type(p.kind).value,
            "relationship_type": rel.value,
            "source": _map_contact_source(p.referral_source).value,
            "source_detail": preview_line(
                self, _source_detail(p.occupation, p.company) or ""
            )
            if _source_detail(p.occupation, p.company)
            else None,
            "source_metadata": meta,
            "mailchimp_status": (
                MailchimpSyncStatus.PENDING.value
                if (p.is_newsletter_subscribed == 1)
                else MailchimpSyncStatus.UNSUBSCRIBED.value
            ),
            "location_id": None,
        }
        tables: list[dict[str, Any]] = [
            {
                "table": "contacts",
                "columns": list(cvals.keys()),
                "values": cvals,
            },
        ]
        cid_disp = contact_id_for_membership or "…"
        for mt in membership_tables:
            mv = dict(mt["values"])
            if "contact_id" in mv:
                mv["contact_id"] = cid_disp
            tables.append({**mt, "values": mv})
        tables.append(
            {
                "table": "legacy_import_refs",
                "columns": ["entity", "legacy_key", "new_id"],
                "values": {
                    "entity": self.ENTITY,
                    "legacy_key": str(p.legacy_id),
                    "new_id": None
                    if dry_run or contact_id is None
                    else str(contact_id),
                },
            },
        )
        return {
            "legacy_source": {"table": "person", "primary_key": {"id": p.legacy_id}},
            "target": {"tables": tables},
            "dry_run": dry_run,
        }

    def apply(
        self,
        session: Session,
        rows: Sequence[Any],
        ctx: ImporterContext,
        *,
        dry_run: bool,
    ) -> ImportStats:
        stats = ImportStats(entity=self.ENTITY, dry_run=dry_run)
        fam_refs = ctx.refs_by_entity.get("families", {})
        org_refs = ctx.refs_by_entity.get("organizations", {})
        skipped_membership_no_parent_ref = 0
        dial_by_id = (
            parse_legacy_country_dial_codes(ctx.source_sql_text)
            if ctx.source_sql_text
            else {}
        )
        email_map = dict(ctx.email_to_contact_id)
        insta_map = dict(ctx.instagram_to_contact_id)

        for p in rows:
            if not isinstance(p, LegacyPersonRow):
                continue
            if str(p.legacy_id) in ctx.skip_legacy_keys:
                stats.skipped_excluded_key += 1
                continue
            if p.deleted_at is not None:
                stats.skipped_deleted += 1
                continue

            if str(p.legacy_id) in ctx.existing_import_keys:
                stats.skipped_duplicate += 1
                continue

            email_key = str(p.email).strip().lower() if p.email else None
            insta_key = (
                instagram_handle_for_storage(str(p.instagram_id))
                if p.instagram_id
                else None
            )

            reuse_id: UUID | None = None
            if email_key:
                reuse_id = email_map.get(email_key)
            if reuse_id is None and insta_key:
                reuse_id = insta_map.get(insta_key)

            fid = p.family_id
            fam_key = str(fid) if fid is not None else None
            parent_uuid: UUID | None = None
            org_mode = False
            if fam_key is not None:
                parent_uuid = fam_refs.get(fam_key)
                if parent_uuid is None:
                    parent_uuid = org_refs.get(fam_key)
                    org_mode = parent_uuid is not None
            wants_membership = fam_key is not None and parent_uuid is not None

            if reuse_id is not None:
                if dry_run:
                    if len(stats.preview) < self.PREVIEW_MAX_ROWS:
                        msg = (
                            f"Would map legacy person {p.legacy_id} to existing contact "
                            f"(dedupe)"
                        )
                        if wants_membership:
                            msg += f"; add membership to parent {fam_key}"
                        else:
                            msg += "; no family/org membership (parent not in refs)"
                        stats.preview.append(msg)
                    if len(stats.row_details) < self.PREVIEW_MAX_ROWS:
                        mtables: list[dict[str, Any]] = []
                        if wants_membership:
                            if org_mode:
                                mtables.append(
                                    {
                                        "table": "organization_members",
                                        "columns": [
                                            "organization_id",
                                            "contact_id",
                                            "role",
                                            "title",
                                        ],
                                        "values": {
                                            "organization_id": str(parent_uuid),
                                            "contact_id": "…",
                                            "role": _org_role(p.kind).value,
                                            "title": _title_trim(p.occupation),
                                        },
                                    },
                                )
                            else:
                                mtables.append(
                                    {
                                        "table": "family_members",
                                        "columns": ["family_id", "contact_id", "role"],
                                        "values": {
                                            "family_id": str(parent_uuid),
                                            "contact_id": "…",
                                            "role": _family_role(p.kind).value,
                                        },
                                    },
                                )
                        stats.row_details.append(
                            self._row_detail(
                                ctx,
                                p,
                                contact_id=reuse_id,
                                dry_run=True,
                                membership_tables=mtables,
                                contact_id_for_membership=str(reuse_id),
                            ),
                        )
                    stats.reused_existing_contact += 1
                    continue
                refs.record_mapping(session, self.ENTITY, str(p.legacy_id), reuse_id)
                if wants_membership:
                    if parent_uuid is None:
                        raise RuntimeError(
                            "contacts importer: wants_membership but parent_uuid is None"
                        )
                    membership_parent: UUID = parent_uuid
                    if not _membership_exists(
                        session,
                        contact_id=reuse_id,
                        parent_uuid=membership_parent,
                        org_mode=org_mode,
                    ):
                        if org_mode:
                            session.add(
                                OrganizationMember(
                                    organization_id=membership_parent,
                                    contact_id=reuse_id,
                                    role=_org_role(p.kind),
                                    is_primary_contact=False,
                                    title=_title_trim(p.occupation),
                                ),
                            )
                        else:
                            session.add(
                                FamilyMember(
                                    family_id=membership_parent,
                                    contact_id=reuse_id,
                                    role=_family_role(p.kind),
                                ),
                            )
                elif fam_key is not None and parent_uuid is None:
                    skipped_membership_no_parent_ref += 1
                stats.reused_existing_contact += 1
                continue

            fn = _clean_name_part(p.first_name) or "Unknown"
            ln = _clean_name_part(p.last_name)
            email_norm = str(p.email).strip().lower() if p.email else None
            email_store = email_norm if email_norm else None
            insta_store = (
                instagram_handle_for_storage(str(p.instagram_id))
                if p.instagram_id
                else None
            )

            kind_l = (p.kind or "").strip().lower()
            rel = (
                RelationshipType.PARTNER
                if kind_l == "partner"
                else RelationshipType.PROSPECT
            )

            phone_region, phone_national = _split_phone(
                p.phone, dial_by_id, p.phone_country_code_id
            )
            src = _map_contact_source(p.referral_source)
            mc_status = (
                MailchimpSyncStatus.PENDING
                if p.is_newsletter_subscribed == 1
                else MailchimpSyncStatus.UNSUBSCRIBED
            )
            meta: dict[str, Any] = {
                "legacy_person_id": p.legacy_id,
                "legacy_family_id": p.family_id,
                "referral_person_id": p.referral_person_id,
            }

            membership_tables: list[dict[str, Any]] = []
            if wants_membership:
                if org_mode:
                    membership_tables.append(
                        {
                            "table": "organization_members",
                            "columns": [
                                "organization_id",
                                "contact_id",
                                "role",
                                "title",
                            ],
                            "values": {
                                "organization_id": str(parent_uuid),
                                "contact_id": "…",
                                "role": _org_role(p.kind).value,
                                "title": _title_trim(p.occupation),
                            },
                        },
                    )
                else:
                    membership_tables.append(
                        {
                            "table": "family_members",
                            "columns": ["family_id", "contact_id", "role"],
                            "values": {
                                "family_id": str(parent_uuid),
                                "contact_id": "…",
                                "role": _family_role(p.kind).value,
                            },
                        },
                    )
            elif fam_key is not None:
                skipped_membership_no_parent_ref += 1

            if dry_run:
                if len(stats.preview) < self.PREVIEW_MAX_ROWS:
                    stats.preview.append(self.format_preview(p, None))
                if len(stats.row_details) < self.PREVIEW_MAX_ROWS:
                    stats.row_details.append(
                        self._row_detail(
                            ctx,
                            p,
                            contact_id=None,
                            dry_run=True,
                            membership_tables=membership_tables,
                            contact_id_for_membership=None,
                        ),
                    )
                stats.inserted += 1
                continue

            contact = Contact(
                email=email_store,
                instagram_handle=insta_store,
                first_name=fn,
                last_name=ln,
                phone_region=phone_region,
                phone_national_number=phone_national,
                contact_type=_map_contact_type(p.kind),
                relationship_type=rel,
                date_of_birth=p.date_of_birth,
                location_id=None,
                source=src,
                source_detail=_source_detail(p.occupation, p.company),
                source_metadata=meta,
                mailchimp_status=mc_status,
            )
            session.add(contact)
            session.flush()
            cid = contact.id
            contact_uuid = cid if isinstance(cid, UUID) else UUID(str(cid))

            if wants_membership:
                if org_mode:
                    session.add(
                        OrganizationMember(
                            organization_id=parent_uuid,
                            contact_id=contact_uuid,
                            role=_org_role(p.kind),
                            is_primary_contact=False,
                            title=_title_trim(p.occupation),
                        ),
                    )
                else:
                    session.add(
                        FamilyMember(
                            family_id=parent_uuid,
                            contact_id=contact_uuid,
                            role=_family_role(p.kind),
                        ),
                    )

            refs.record_mapping(session, self.ENTITY, str(p.legacy_id), contact_uuid)
            if email_key:
                email_map[email_key] = contact_uuid
            if insta_key:
                insta_map[insta_key] = contact_uuid

            if len(stats.row_details) < self.PREVIEW_MAX_ROWS:
                stats.row_details.append(
                    self._row_detail(
                        ctx,
                        p,
                        contact_id=contact_uuid,
                        dry_run=False,
                        membership_tables=membership_tables,
                        contact_id_for_membership=str(contact_uuid),
                    ),
                )
            stats.inserted += 1

        if not dry_run:
            session.commit()

        stats.diagnostics = {
            "dependency_ref_count_families": len(fam_refs),
            "dependency_ref_count_organizations": len(org_refs),
            "skipped_membership_no_parent_ref": skipped_membership_no_parent_ref,
        }

        return stats

    def format_preview(self, row: Any, mapped_id: UUID | None) -> str:
        if not isinstance(row, LegacyPersonRow):
            return ""
        fn = _clean_name_part(row.first_name) or ""
        return (
            "Would insert: "
            f"name={preview_line(self, fn)!r} | "
            f"legacy_id={row.legacy_id}"
        )


def apply_contacts(
    session: Session,
    people: Sequence[LegacyPersonRow],
    *,
    dry_run: bool,
    sql_text: str,
    skip_legacy_keys: frozenset[str] | None = None,
) -> ImportStats:
    importer = ContactsImporter()
    base = importer.resolve_context(session, dry_run=dry_run)
    sk = skip_legacy_keys or frozenset()
    from app.imports import refs as refs_mod

    existing = refs_mod.load_legacy_keys(session, importer.ENTITY)
    ctx = replace(
        base,
        skip_legacy_keys=base.skip_legacy_keys | sk,
        source_sql_text=sql_text,
        refs_by_entity={"families": {}, "organizations": {}},
        existing_import_keys=base.existing_import_keys | existing,
    )
    return importer.apply(session, people, ctx, dry_run=dry_run)


register(ContactsImporter())
