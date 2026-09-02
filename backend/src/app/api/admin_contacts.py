"""Admin CRM contacts API."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_contact_notes import (
    create_contact_note,
    delete_contact_note,
    list_contact_notes,
    update_contact_note,
)
from app.api.admin_entity_services import list_contact_services
from app.api.admin_contacts_mailchimp_sync import (
    get_mailchimp_sync_summary,
    run_mailchimp_orphan_cleanup,
    run_mailchimp_sync_batch,
)
from app.api.admin_contacts_mutations import (
    create_contact,
    update_contact,
)
from app.api.admin_contacts_delete import delete_contact
from app.api.admin_contacts_related import related_flags_for_contacts
from app.api.admin_entities_helpers import (
    list_all_tags_for_picker,
    parse_active_filter,
    parse_contact_type_filter,
    parse_limit,
    serialize_tag_ref,
)
from app.api.admin_entities_serializers import (
    serialize_contact_picker_row,
    serialize_contact_summary,
)
from app.api.admin_request import (
    encode_cursor,
    parse_cursor,
    parse_uuid,
    query_param,
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)
from app.api.admin_services_payload_utils import parse_optional_uuid
from app.api.admin_validators import validate_string_length
from app.db.engine import get_engine
from app.db.repositories import ContactRepository
from app.services.completion_certificate_common import (
    contact_ids_with_issued_certificates,
)
from app.exceptions import NotFoundError, ValidationError
from app.utils import json_response, method_not_allowed, not_found
from app.utils.logging import get_logger

logger = get_logger(__name__)


def handle_admin_contacts_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/contacts and /v1/admin/contacts/tags."""
    logger.info(
        "Handling admin CRM contacts route",
        extra={"method": method, "path": path},
    )
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "admin", "contacts"):
        return not_found(event)

    identity = require_admin_identity(event)

    if len(parts) == 3 and parts[2] == "tags":
        if method == "GET":
            return _list_contact_tags(event)
        return method_not_allowed(event)

    if len(parts) == 3 and parts[2] == "search":
        if method == "GET":
            return _search_contacts_for_picker(event)
        return method_not_allowed(event)

    if len(parts) == 2:
        if method == "GET":
            return _list_contacts(event)
        if method == "POST":
            return _create_contact(event, actor_sub=identity.user_sub)
        return method_not_allowed(event)

    if len(parts) == 3 and parts[2] == "mailchimp-sync-run":
        if method == "POST":
            return run_mailchimp_sync_batch(event, actor_sub=identity.user_sub)
        return method_not_allowed(event)

    if len(parts) == 3 and parts[2] == "mailchimp-sync-orphans":
        if method == "POST":
            return run_mailchimp_orphan_cleanup(event, actor_sub=identity.user_sub)
        return method_not_allowed(event)

    if len(parts) == 3 and parts[2] == "mailchimp-sync-status":
        if method == "GET":
            return get_mailchimp_sync_summary(event)
        return method_not_allowed(event)

    contact_id = parse_uuid(parts[2])
    if len(parts) == 3:
        if method == "GET":
            return _get_contact(event, contact_id=contact_id)
        if method == "PATCH":
            return _update_contact(
                event, contact_id=contact_id, actor_sub=identity.user_sub
            )
        if method == "DELETE":
            return delete_contact(
                event, contact_id=contact_id, actor_sub=identity.user_sub
            )
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "notes":
        if method == "GET":
            return list_contact_notes(
                event, contact_id=contact_id, actor_sub=identity.user_sub
            )
        if method == "POST":
            return create_contact_note(
                event, contact_id=contact_id, actor_sub=identity.user_sub
            )
        return method_not_allowed(event)

    if len(parts) == 4 and parts[3] == "services":
        if method == "GET":
            return list_contact_services(event, contact_id=contact_id)
        return method_not_allowed(event)

    if len(parts) == 5 and parts[3] == "notes":
        note_id = parse_uuid(parts[4])
        if method == "PATCH":
            return update_contact_note(
                event,
                contact_id=contact_id,
                note_id=note_id,
                actor_sub=identity.user_sub,
            )
        if method == "DELETE":
            return delete_contact_note(
                event,
                contact_id=contact_id,
                note_id=note_id,
                actor_sub=identity.user_sub,
            )
        return method_not_allowed(event)

    return not_found(event)


def _search_contacts_for_picker(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event)
    raw_query = validate_string_length(
        query_param(event, "query"),
        "query",
        max_length=255,
        required=True,
    )
    if raw_query is None:
        raise ValidationError("query is required", field="query")
    query = raw_query.strip()
    if len(query) < 2:
        raise ValidationError("query must be at least 2 characters", field="query")
    exclude_id = parse_optional_uuid(
        query_param(event, "exclude_contact_id"), "exclude_contact_id"
    )

    with Session(get_engine()) as session:
        repository = ContactRepository(session)
        rows = repository.search_for_admin_picker(
            limit=limit,
            query=query,
            active=True,
        )
        if exclude_id is not None:
            rows = [r for r in rows if r.id != exclude_id]
        return json_response(
            200,
            {"items": [serialize_contact_picker_row(r) for r in rows]},
            event=event,
        )


def _list_contact_tags(event: Mapping[str, Any]) -> dict[str, Any]:
    with Session(get_engine()) as session:
        tags = list_all_tags_for_picker(session)
        return json_response(
            200,
            {"items": [serialize_tag_ref(t) for t in tags]},
            event=event,
        )


def _list_contacts(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event)
    cursor = parse_cursor(query_param(event, "cursor"))
    query = validate_string_length(
        query_param(event, "query"),
        "query",
        max_length=255,
        required=False,
    )
    active = parse_active_filter(query_param(event, "active"))
    contact_type = parse_contact_type_filter(query_param(event, "contact_type"))

    with Session(get_engine()) as session:
        repository = ContactRepository(session)
        rows = repository.list_for_admin(
            limit=limit + 1,
            cursor=cursor,
            query=query,
            active=active,
            contact_type=contact_type,
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        next_cursor = (
            encode_cursor(page_rows[-1].id) if has_more and page_rows else None
        )
        total_count = repository.count_for_admin(
            query=query, active=active, contact_type=contact_type
        )
        note_counts = repository.count_standalone_notes_for_contacts(
            [r.id for r in page_rows]
        )
        cert_contact_ids = contact_ids_with_issued_certificates(
            session, [r.id for r in page_rows]
        )
        related_flags = related_flags_for_contacts(session, [r.id for r in page_rows])
        return json_response(
            200,
            {
                "items": [
                    serialize_contact_summary(
                        r,
                        standalone_note_count=note_counts.get(r.id, 0),
                        has_completion_certificate=r.id in cert_contact_ids,
                        **related_flags[r.id].as_serializer_kwargs(),
                    )
                    for r in page_rows
                ],
                "next_cursor": next_cursor,
                "total_count": total_count,
            },
            event=event,
        )


def _get_contact(event: Mapping[str, Any], *, contact_id: UUID) -> dict[str, Any]:
    with Session(get_engine()) as session:
        repository = ContactRepository(session)
        contact = repository.get_by_id_for_admin(contact_id)
        if contact is None:
            raise NotFoundError("Contact", str(contact_id))
        note_counts = repository.count_standalone_notes_for_contacts([contact.id])
        cert_ids = contact_ids_with_issued_certificates(session, [contact.id])
        related_flags = related_flags_for_contacts(session, [contact.id])
        return json_response(
            200,
            {
                "contact": serialize_contact_summary(
                    contact,
                    standalone_note_count=note_counts.get(contact.id, 0),
                    has_completion_certificate=contact.id in cert_ids,
                    **related_flags[contact.id].as_serializer_kwargs(),
                )
            },
            event=event,
        )


def _create_contact(event: Mapping[str, Any], *, actor_sub: str) -> dict[str, Any]:
    return create_contact(event, actor_sub=actor_sub)


def _update_contact(
    event: Mapping[str, Any],
    *,
    contact_id: UUID,
    actor_sub: str,
) -> dict[str, Any]:
    return update_contact(event, contact_id=contact_id, actor_sub=actor_sub)
