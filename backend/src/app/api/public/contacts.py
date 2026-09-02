"""Token-authenticated public CRM contacts API.

``user`` tokens may GET only. ``admin`` tokens may create, update, and delete.
Payloads match the admin contact contract, including email, phone, and date of
birth. Notes, services, and Mailchimp sync jobs are not exposed here.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_contacts_mutations import (
    create_contact,
    update_contact,
)
from app.api.admin_contacts_delete import delete_contact
from app.api.admin_contacts_related import related_flags_for_contacts
from app.api.admin_entities_helpers import (
    parse_active_filter,
    parse_contact_type_filter,
    parse_limit,
)
from app.api.admin_entities_serializers import serialize_contact_summary
from app.api.admin_request import encode_cursor, parse_cursor, parse_uuid, query_param
from app.api.admin_validators import validate_string_length
from app.api.shared_request import route_has_prefix, split_route_parts
from app.api.public.token_auth import require_api_token
from app.db.engine import get_engine
from app.db.repositories import ContactRepository
from app.exceptions import NotFoundError
from app.services.completion_certificate_common import (
    contact_ids_with_issued_certificates,
)
from app.utils import json_response, method_not_allowed, not_found
from app.utils.logging import get_logger

logger = get_logger(__name__)

_DEFAULT_LIMIT = 25


def handle_public_contacts_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/public/contacts routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "public", "contacts"):
        return not_found(event)

    token = require_api_token(event, method)
    actor_sub = f"api-key:{token.api_key_id}"

    if len(parts) == 2:
        if method == "GET":
            return _list_contacts(event)
        if method == "POST":
            return create_contact(event, actor_sub=actor_sub)
        return method_not_allowed(event)

    if len(parts) != 3:
        return not_found(event)

    contact_id = parse_uuid(parts[2])
    if method == "GET":
        return _get_contact(event, contact_id=contact_id)
    if method == "PATCH":
        return update_contact(event, contact_id=contact_id, actor_sub=actor_sub)
    if method == "DELETE":
        return delete_contact(event, contact_id=contact_id, actor_sub=actor_sub)
    return method_not_allowed(event)


def _list_contacts(event: Mapping[str, Any]) -> dict[str, Any]:
    limit = parse_limit(event, default=_DEFAULT_LIMIT)
    cursor = parse_cursor(query_param(event, "cursor"))
    query = validate_string_length(
        query_param(event, "query"),
        "query",
        max_length=255,
        required=False,
    )
    active = parse_active_filter(query_param(event, "active"))
    contact_type = parse_contact_type_filter(query_param(event, "contact_type"))

    logger.info("Listing public CRM contacts")

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
