"""Admin form response management (DynamoDB training form answers)."""

from __future__ import annotations

import csv
import io
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from app.api.admin_request import require_admin_identity, split_route_parts
from app.exceptions import ValidationError
from app.services.form_responses_store import (
    clear_form_answers,
    list_form_answers,
    list_form_summaries,
)
from app.utils import json_response
from app.utils.logging import get_logger
from app.utils.public_slug import PUBLIC_INSTANCE_SLUG_PATTERN
from app.utils.responses import get_cors_headers, get_security_headers

logger = get_logger(__name__)


def handle_admin_forms_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/forms routes."""
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "forms":
        return json_response(404, {"error": "Not found"}, event=event)

    identity = require_admin_identity(event)

    if len(parts) == 2:
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _list_forms(event)

    form_slug = _parse_form_slug(parts[2])
    if len(parts) == 3:
        return json_response(404, {"error": "Not found"}, event=event)

    if len(parts) == 4 and parts[3] == "answers":
        if method == "GET":
            return _list_form_answers(event, form_slug=form_slug)
        if method == "DELETE":
            return _clear_form_answers(event, form_slug=form_slug)
        return json_response(405, {"error": "Method not allowed"}, event=event)

    if len(parts) == 5 and parts[3] == "answers" and parts[4] == "export":
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _export_form_answers(event, form_slug=form_slug)

    return json_response(404, {"error": "Not found"}, event=event)


def _parse_form_slug(value: str) -> str:
    normalized = value.strip()
    if not normalized or not PUBLIC_INSTANCE_SLUG_PATTERN.match(normalized):
        raise ValidationError("form slug must be a kebab-case identifier")
    return normalized


def _list_forms(event: Mapping[str, Any]) -> dict[str, Any]:
    items = list_form_summaries()
    return json_response(200, {"items": items}, event=event)


def _list_form_answers(
    event: Mapping[str, Any],
    *,
    form_slug: str,
) -> dict[str, Any]:
    items = list_form_answers(form_slug=form_slug)
    return json_response(200, {"items": items}, event=event)


def _clear_form_answers(
    event: Mapping[str, Any],
    *,
    form_slug: str,
) -> dict[str, Any]:
    deleted_count = clear_form_answers(form_slug=form_slug)
    logger.info(
        "Cleared form answers",
        extra={
            "form_slug": form_slug,
            "deleted_count": deleted_count,
        },
    )
    return json_response(
        200,
        {
            "formSlug": form_slug,
            "deletedCount": deleted_count,
        },
        event=event,
    )


def _export_form_answers(
    event: Mapping[str, Any],
    *,
    form_slug: str,
) -> dict[str, Any]:
    items = list_form_answers(form_slug=form_slug)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Form Slug",
            "Session ID",
            "Question ID",
            "Question Type",
            "Selected Option",
            "Selected Options",
            "Rating Value",
            "Boolean Answer",
            "Free Text",
            "Created At",
            "Updated At",
        ]
    )
    for item in items:
        selected_options = item.get("selectedOptions")
        if isinstance(selected_options, list):
            options_cell = "; ".join(
                option
                for option in selected_options
                if isinstance(option, str) and option.strip()
            )
        else:
            options_cell = ""
        rating_value = item.get("ratingValue")
        rating_cell = (
            str(int(rating_value))
            if isinstance(rating_value, (int, float))
            and not isinstance(rating_value, bool)
            else ""
        )
        boolean_answer = item.get("booleanAnswer")
        boolean_cell = (
            "true"
            if boolean_answer is True
            else "false"
            if boolean_answer is False
            else ""
        )
        writer.writerow(
            [
                item.get("formSlug") or form_slug,
                item.get("sessionId") or "",
                item.get("questionId") or "",
                item.get("questionType") or "",
                item.get("selectedOption") or "",
                options_cell,
                rating_cell,
                boolean_cell,
                item.get("freeText") or "",
                item.get("createdAt") or "",
                item.get("updatedAt") or "",
            ]
        )

    filename = f"form-{form_slug}-answers-{datetime.now(UTC).date().isoformat()}.csv"
    response_headers = {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": f'attachment; filename="{filename}"',
        **get_security_headers(),
        **get_cors_headers(event),
    }
    return {
        "statusCode": 200,
        "headers": response_headers,
        "body": output.getvalue(),
    }
