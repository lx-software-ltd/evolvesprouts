"""Public GET /v1/calendar/availability (consultation + intro-call slot discovery)."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.db.engine import get_engine
from app.exceptions import ValidationError
from app.services.public_calendar_availability import (
    parse_availability_request,
    serialize_availability_response,
)
from app.utils import json_response, method_not_allowed, public_cacheable_json_response
from app.utils.public_http_cache import CACHE_CONTROL_NO_STORE


def handle_public_calendar_availability(
    event: Mapping[str, Any],
    method: str,
) -> dict[str, Any]:
    """Handle GET /v1/calendar/availability and /www/v1/calendar/availability."""
    if method != "GET":
        return method_not_allowed(
            event, headers={"Cache-Control": CACHE_CONTROL_NO_STORE}
        )

    try:
        spec, from_date, to_date = parse_availability_request(event)
    except ValidationError as exc:
        return json_response(
            exc.status_code,
            exc.to_dict(),
            headers={"Cache-Control": CACHE_CONTROL_NO_STORE},
            event=event,
        )

    now = datetime.now(tz=UTC)
    with Session(get_engine()) as session:
        slots = spec.compute(session, from_date, to_date, now)

    body = serialize_availability_response(
        spec=spec,
        from_date=from_date,
        to_date=to_date,
        slots=slots,
    )

    if spec.cache_policy == "no_store":
        return json_response(
            200,
            body,
            headers={"Cache-Control": CACHE_CONTROL_NO_STORE},
            event=event,
        )
    return public_cacheable_json_response(200, body, event=event)
