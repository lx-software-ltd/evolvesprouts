"""Public training poll answer persistence and live results (DynamoDB)."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping
from urllib.parse import parse_qs, urlparse

from app.api.admin_request import parse_body
from app.exceptions import ConflictError, RateLimitError, ValidationError
from app.services.poll_responses_store import (
    aggregate_poll_question_results,
    check_poll_write_rate_limit,
    get_poll_answer_item,
    get_poll_control_state,
    list_poll_answers_for_session,
    poll_answer_payload_unchanged,
    put_poll_control_state,
    upsert_poll_answer,
)
from app.utils import json_response, method_not_allowed, not_found
from app.utils.logging import get_logger
from app.utils.public_slug import PUBLIC_INSTANCE_SLUG_PATTERN
from app.api.public_polls_validation import (
    QUESTION_ID_PATTERN,
    require_aggregatable_question_type,
    require_session_id,
    validate_answer_against_published_options,
    validate_control_body,
    validate_put_body,
)

logger = get_logger(__name__)

_ANSWERS_SUFFIX = "/answers"
_CONTROL_SUFFIX = "/control"
_RESULTS_SUFFIX = "/results"
_QUESTIONS_SEGMENT = "/questions/"
_POLL_API_PREFIX = "/v1/polls/"
_WWW_POLL_API_PREFIX = "/www/v1/polls/"


def handle_public_polls_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Route poll API requests under /v1/polls/* and /www/v1/polls/*."""
    answers = _parse_poll_answers_path(path)
    if answers is not None:
        poll_slug, _suffix = answers
        if method == "PUT":
            return _handle_put_poll_answer(event, poll_slug=poll_slug)
        if method == "GET":
            return _handle_get_poll_session_answers(event, poll_slug=poll_slug)
        return method_not_allowed(event)

    results = _parse_poll_question_results_path(path)
    if results is not None:
        poll_slug, question_id = results
        if method == "GET":
            return _handle_get_poll_question_results(
                event,
                poll_slug=poll_slug,
                question_id=question_id,
            )
        return method_not_allowed(event)

    control = _parse_poll_control_path(path)
    if control is not None:
        poll_slug = control
        if method == "GET":
            return _handle_get_poll_control(event, poll_slug=poll_slug)
        if method == "PUT":
            return _handle_put_poll_control(event, poll_slug=poll_slug)
        return method_not_allowed(event)

    return not_found(event)


def _parse_poll_path_remainder(path: str) -> str | None:
    normalized = path.rstrip("/")
    if normalized.startswith(_WWW_POLL_API_PREFIX):
        return normalized[len(_WWW_POLL_API_PREFIX) :]
    if normalized.startswith(_POLL_API_PREFIX):
        return normalized[len(_POLL_API_PREFIX) :]
    return None


def _parse_poll_control_path(path: str) -> str | None:
    remainder = _parse_poll_path_remainder(path)
    if remainder is None or not remainder.endswith(_CONTROL_SUFFIX):
        return None
    poll_slug = remainder[: -len(_CONTROL_SUFFIX)].strip("/")
    if "/" in poll_slug or not poll_slug:
        return None
    if not PUBLIC_INSTANCE_SLUG_PATTERN.match(poll_slug):
        return None
    return poll_slug


def _parse_poll_answers_path(path: str) -> tuple[str, str] | None:
    remainder = _parse_poll_path_remainder(path)
    if remainder is None or not remainder.endswith(_ANSWERS_SUFFIX):
        return None
    poll_slug = remainder[: -len(_ANSWERS_SUFFIX)].strip("/")
    if "/" in poll_slug or not poll_slug:
        return None
    if not PUBLIC_INSTANCE_SLUG_PATTERN.match(poll_slug):
        return None
    return poll_slug, _ANSWERS_SUFFIX


def _parse_poll_question_results_path(path: str) -> tuple[str, str] | None:
    remainder = _parse_poll_path_remainder(path)
    if remainder is None or not remainder.endswith(_RESULTS_SUFFIX):
        return None
    without_suffix = remainder[: -len(_RESULTS_SUFFIX)]
    if _QUESTIONS_SEGMENT not in without_suffix:
        return None
    poll_slug, question_id = without_suffix.split(_QUESTIONS_SEGMENT, 1)
    poll_slug = poll_slug.strip("/")
    question_id = question_id.strip("/")
    if not poll_slug or not question_id or "/" in poll_slug or "/" in question_id:
        return None
    if not PUBLIC_INSTANCE_SLUG_PATTERN.match(poll_slug):
        return None
    if not QUESTION_ID_PATTERN.match(question_id):
        return None
    return poll_slug, question_id


def _handle_get_poll_question_results(
    event: Mapping[str, Any],
    *,
    poll_slug: str,
    question_id: str,
) -> dict[str, Any]:
    try:
        question_type = require_aggregatable_question_type(
            _read_query_param(event, "questionType"),
        )
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    result = aggregate_poll_question_results(
        poll_slug=poll_slug,
        question_id=question_id,
        question_type=question_type,
    )
    return json_response(200, result, event=event)


def _read_query_param(event: Mapping[str, Any], name: str) -> Any:
    query = event.get("queryStringParameters")
    if isinstance(query, Mapping) and name in query:
        return query.get(name)
    raw_path = event.get("rawPath") or event.get("path") or ""
    if not isinstance(raw_path, str) or "?" not in raw_path:
        return None
    parsed = urlparse(raw_path)
    values = parse_qs(parsed.query).get(name)
    if not values:
        return None
    return values[0]


def _handle_get_poll_control(
    event: Mapping[str, Any],
    *,
    poll_slug: str,
) -> dict[str, Any]:
    result = get_poll_control_state(poll_slug=poll_slug)
    return json_response(200, result, event=event)


def _handle_put_poll_control(
    event: Mapping[str, Any],
    *,
    poll_slug: str,
) -> dict[str, Any]:
    try:
        body = parse_body(event)
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    try:
        control_payload = validate_control_body(body)
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    result = put_poll_control_state(
        poll_slug=poll_slug,
        enabled_question_ids=control_payload["enabled_question_ids"],
        question_options=control_payload.get("question_options"),
    )
    logger.info(
        "Updated poll control state",
        extra={
            "poll_slug": poll_slug,
            "enabled_count": len(control_payload["enabled_question_ids"]),
        },
    )
    return json_response(200, result, event=event)


def _handle_get_poll_session_answers(
    event: Mapping[str, Any],
    *,
    poll_slug: str,
) -> dict[str, Any]:
    try:
        session_id = require_session_id(_read_query_param(event, "sessionId"))
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    items = list_poll_answers_for_session(
        poll_slug=poll_slug,
        session_id=session_id,
    )
    return json_response(
        200,
        {
            "pollSlug": poll_slug,
            "sessionId": session_id,
            "answers": items,
        },
        event=event,
    )


def _handle_put_poll_answer(
    event: Mapping[str, Any],
    *,
    poll_slug: str,
) -> dict[str, Any]:
    try:
        body = parse_body(event)
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    try:
        normalized = validate_put_body(body, poll_slug=poll_slug)
    except ValidationError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    control = get_poll_control_state(poll_slug=poll_slug)
    enabled_raw = control.get("enabledQuestionIds")
    enabled_ids = enabled_raw if isinstance(enabled_raw, list) else []
    question_id = normalized["question_id"]
    if not enabled_ids:
        error = ConflictError("poll_not_accepting_answers")
        return json_response(error.status_code, error.to_dict(), event=event)
    if question_id not in enabled_ids:
        error = ConflictError("question_not_open")
        return json_response(error.status_code, error.to_dict(), event=event)

    try:
        validate_answer_against_published_options(
            normalized=normalized,
            control=control,
        )
    except ConflictError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    existing_answer = get_poll_answer_item(
        poll_slug=poll_slug,
        session_id=normalized["session_id"],
        question_id=normalized["question_id"],
    )
    if (
        existing_answer is not None
        and isinstance(existing_answer.get("updatedAt"), str)
        and poll_answer_payload_unchanged(
            existing_answer,
            question_type=normalized["question_type"],
            selected_option=normalized.get("selected_option"),
            selected_options=normalized.get("selected_options"),
            boolean_answer=normalized.get("boolean_answer"),
            free_text=normalized.get("free_text"),
        )
    ):
        return json_response(
            200,
            {
                "pollSlug": poll_slug,
                "sessionId": normalized["session_id"],
                "questionId": normalized["question_id"],
                "updatedAt": existing_answer["updatedAt"],
            },
            event=event,
        )

    try:
        check_poll_write_rate_limit(
            poll_slug=poll_slug,
            session_id=normalized["session_id"],
        )
    except RateLimitError as exc:
        return json_response(exc.status_code, exc.to_dict(), event=event)

    result = upsert_poll_answer(**normalized, existing_item=existing_answer)
    logger.info(
        "Persisted poll answer",
        extra={
            "poll_slug": poll_slug,
            "question_id": normalized["question_id"],
        },
    )
    return json_response(
        200,
        {
            "pollSlug": result["pollSlug"],
            "sessionId": result["sessionId"],
            "questionId": result["questionId"],
            "updatedAt": result["updatedAt"],
        },
        event=event,
    )
