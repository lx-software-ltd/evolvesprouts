"""GET /v1/forms/{form_slug}/contact-context — display-only household names."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.admin_request import parse_uuid
from app.db.engine import get_engine
from app.exceptions import ValidationError
from app.services.form_contact_context import (
    build_form_contact_placeholders,
    serialize_form_contact_context,
)
from app.utils import CACHE_CONTROL_NO_STORE, json_response, not_found
from app.utils.logging import get_logger
from app.utils.parsers import collect_query_params, first_param

logger = get_logger(__name__)

_NO_STORE = {"Cache-Control": CACHE_CONTROL_NO_STORE}


def handle_form_contact_context_request(
    event: Mapping[str, Any],
    *,
    form_slug: str,
) -> dict[str, Any]:
    """Return placeholder strings for one CRM contact. Never caches at the edge."""
    try:
        contact_id = _require_contact_id(event)
    except ValidationError as exc:
        return json_response(
            exc.status_code,
            exc.to_dict(),
            headers=_NO_STORE,
            event=event,
        )

    with Session(get_engine()) as session:
        placeholders = build_form_contact_placeholders(
            session=session,
            contact_id=contact_id,
        )
    if placeholders is None:
        return not_found(event, headers=_NO_STORE)

    logger.info(
        "Resolved form contact placeholders",
        extra={"form_slug": form_slug},
    )
    return json_response(
        200,
        serialize_form_contact_context(
            form_slug=form_slug,
            contact_id=contact_id,
            placeholders=placeholders,
        ),
        headers=_NO_STORE,
        event=event,
    )


def _require_contact_id(event: Mapping[str, Any]) -> UUID:
    raw = _read_query_param(event, "contactId")
    if raw is None:
        raise ValidationError("contactId is required", field="contactId")
    if not isinstance(raw, str):
        raise ValidationError("contactId must be a UUID", field="contactId")
    normalized = raw.strip()
    if not normalized:
        raise ValidationError("contactId is required", field="contactId")
    try:
        return parse_uuid(normalized)
    except ValidationError as exc:
        raise ValidationError("contactId must be a UUID", field="contactId") from exc


def _read_query_param(event: Mapping[str, Any], name: str) -> Any:
    return first_param(collect_query_params(event), name)
