"""Admin poll response management (DynamoDB training poll answers)."""

from __future__ import annotations

import csv
import io
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from app.api.admin_request import (
    paginate_after_key,
    parse_limit,
    query_param,
    require_admin_identity,
    split_route_parts,
)
from app.exceptions import ValidationError
from app.services.poll_responses_store import (
    clear_poll_answers,
    list_poll_answers,
    list_poll_summaries,
)
from app.utils import json_response
from app.utils.logging import get_logger
from app.utils.public_slug import PUBLIC_INSTANCE_SLUG_PATTERN
from app.utils.responses import get_cors_headers, get_security_headers

logger = get_logger(__name__)

_ANSWER_CURSOR_FIELDS = ("updatedAt", "sessionId", "questionId")


def handle_admin_polls_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/polls routes."""
    parts = split_route_parts(path)
    if len(parts) < 2 or parts[0] != "admin" or parts[1] != "polls":
        return json_response(404, {"error": "Not found"}, event=event)

    require_admin_identity(event)

    if len(parts) == 2:
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _list_polls(event)

    poll_slug = _parse_poll_slug(parts[2])
    if len(parts) == 3:
        return json_response(404, {"error": "Not found"}, event=event)

    if len(parts) == 4 and parts[3] == "answers":
        if method == "GET":
            return _list_poll_answers(event, poll_slug=poll_slug)
        if method == "DELETE":
            return _clear_poll_answers(event, poll_slug=poll_slug)
        return json_response(405, {"error": "Method not allowed"}, event=event)

    if len(parts) == 5 and parts[3] == "answers" and parts[4] == "export":
        if method != "GET":
            return json_response(405, {"error": "Method not allowed"}, event=event)
        return _export_poll_answers(event, poll_slug=poll_slug)

    return json_response(404, {"error": "Not found"}, event=event)


def _parse_poll_slug(value: str) -> str:
    normalized = value.strip()
    if not normalized or not PUBLIC_INSTANCE_SLUG_PATTERN.match(normalized):
        raise ValidationError("poll slug must be a kebab-case identifier")
    return normalized


def _list_polls(event: Mapping[str, Any]) -> dict[str, Any]:
    items = list_poll_summaries()
    return json_response(200, {"items": items}, event=event)


def _list_poll_answers(
    event: Mapping[str, Any],
    *,
    poll_slug: str,
) -> dict[str, Any]:
    items = list_poll_answers(poll_slug=poll_slug)
    page, next_cursor = paginate_after_key(
        items,
        limit=parse_limit(event),
        cursor=query_param(event, "cursor"),
        key_fields=_ANSWER_CURSOR_FIELDS,
    )
    return json_response(
        200,
        {"items": page, "next_cursor": next_cursor},
        event=event,
    )


def _clear_poll_answers(
    event: Mapping[str, Any],
    *,
    poll_slug: str,
) -> dict[str, Any]:
    deleted_count = clear_poll_answers(poll_slug=poll_slug)
    logger.info(
        "Cleared poll answers",
        extra={
            "poll_slug": poll_slug,
            "deleted_count": deleted_count,
        },
    )
    return json_response(
        200,
        {
            "pollSlug": poll_slug,
            "deletedCount": deleted_count,
        },
        event=event,
    )


def _export_poll_answers(
    event: Mapping[str, Any],
    *,
    poll_slug: str,
) -> dict[str, Any]:
    items = list_poll_answers(poll_slug=poll_slug)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Poll Slug",
            "Session ID",
            "Question ID",
            "Question Type",
            "Selected Option",
            "Selected Options",
            "Boolean Answer",
            "Free Text",
            "Created At",
            "Updated At",
        ]
    )
    for item in items:
        writer.writerow(
            [
                item.get("pollSlug") or poll_slug,
                item.get("sessionId") or "",
                item.get("questionId") or "",
                item.get("questionType") or "",
                item.get("selectedOption") or "",
                _format_multiselect_options_csv(item),
                _format_boolean_csv(item.get("booleanAnswer")),
                item.get("freeText") or "",
                item.get("createdAt") or "",
                item.get("updatedAt") or "",
            ]
        )

    filename = f"poll-{poll_slug}-answers-{datetime.now(UTC).date().isoformat()}.csv"
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


def _format_multiselect_options_csv(item: Mapping[str, Any]) -> str:
    selected_options = item.get("selectedOptions")
    if isinstance(selected_options, list):
        labels = [
            str(value).strip()
            for value in selected_options
            if isinstance(value, str) and str(value).strip()
        ]
        if labels:
            return "; ".join(labels)
    return ""


def _format_boolean_csv(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return ""
