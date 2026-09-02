"""Request body and answer validation for the public polls API."""

from __future__ import annotations

import re
from typing import Any
from collections.abc import Mapping

from app.api.validators import validate_email
from app.exceptions import ConflictError, ValidationError

_MAX_SELECTED_OPTION = 500


_MAX_FREE_TEXT = 4000


QUESTION_ID_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


_SESSION_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


_SELECT_TYPES = frozenset({"select"})


_MULTISELECT_TYPES = frozenset({"multiselect"})


_TRUEFALSE_TYPES = frozenset({"truefalse"})


_TEXT_TYPES = frozenset({"text"})


_EMAIL_TYPES = frozenset({"email"})


_AGGREGATABLE_TYPES = (
    _SELECT_TYPES | _MULTISELECT_TYPES | _TRUEFALSE_TYPES | _TEXT_TYPES | _EMAIL_TYPES
)


_MAX_SELECTED_OPTIONS = 20


def require_aggregatable_question_type(value: Any) -> str:
    if not isinstance(value, str):
        raise ValidationError("questionType query parameter is required")
    normalized = value.strip().lower()
    if normalized not in _AGGREGATABLE_TYPES:
        raise ValidationError(
            "questionType must be select, multiselect, truefalse, text, or email"
        )
    return normalized


def validate_control_body(body: Mapping[str, Any]) -> dict[str, Any]:
    raw = body.get("enabledQuestionIds")
    if raw is None:
        enabled: list[str] = []
    elif not isinstance(raw, list):
        raise ValidationError("enabledQuestionIds must be an array")
    else:
        enabled = []
        seen: set[str] = set()
        for value in raw:
            if not isinstance(value, str):
                raise ValidationError("enabledQuestionIds entries must be strings")
            normalized = value.strip()
            if not normalized:
                continue
            if not QUESTION_ID_PATTERN.match(normalized):
                raise ValidationError(
                    "enabledQuestionIds entries must be kebab-case identifiers"
                )
            if normalized in seen:
                continue
            seen.add(normalized)
            enabled.append(normalized)

    question_options = _validate_question_options_body(body.get("questionOptions"))
    payload: dict[str, Any] = {"enabled_question_ids": enabled}
    if question_options is not None:
        payload["question_options"] = question_options
    return payload


def _validate_question_options_body(
    raw: Any,
) -> dict[str, dict[str, Any]] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValidationError("questionOptions must be an object")
    parsed: dict[str, dict[str, Any]] = {}
    for question_id, entry in raw.items():
        if not isinstance(question_id, str):
            raise ValidationError("questionOptions keys must be strings")
        normalized_id = question_id.strip()
        if not normalized_id:
            continue
        if not QUESTION_ID_PATTERN.match(normalized_id):
            raise ValidationError("questionOptions keys must be kebab-case identifiers")
        if not isinstance(entry, dict):
            raise ValidationError("questionOptions entries must be objects")
        question_type = entry.get("type")
        if not isinstance(question_type, str):
            raise ValidationError("questionOptions.type is required")
        normalized_type = question_type.strip().lower()
        if normalized_type not in _AGGREGATABLE_TYPES:
            raise ValidationError(
                "questionOptions.type must be select, multiselect, truefalse, text, or email"
            )
        options_raw = entry.get("options")
        options: list[str] | None = None
        if options_raw is not None:
            if not isinstance(options_raw, list):
                raise ValidationError("questionOptions.options must be an array")
            options = []
            seen_options: set[str] = set()
            for value in options_raw:
                if not isinstance(value, str):
                    raise ValidationError(
                        "questionOptions.options must contain strings"
                    )
                option = value.strip()
                if not option:
                    raise ValidationError(
                        "questionOptions.options must not contain empty strings"
                    )
                if len(option) > _MAX_SELECTED_OPTION:
                    raise ValidationError(
                        f"questionOptions.options entries must be at most {_MAX_SELECTED_OPTION} characters"
                    )
                if option in seen_options:
                    continue
                seen_options.add(option)
                options.append(option)
            if normalized_type in _SELECT_TYPES and not options:
                raise ValidationError(
                    "questionOptions.options is required for select questions"
                )
            if normalized_type in _MULTISELECT_TYPES and not options:
                raise ValidationError(
                    "questionOptions.options is required for multiselect questions"
                )
        elif normalized_type in (_SELECT_TYPES | _MULTISELECT_TYPES):
            raise ValidationError(
                "questionOptions.options is required for select and multiselect questions"
            )
        parsed[normalized_id] = {
            "type": normalized_type,
            "options": options,
        }
    return parsed or None


def validate_answer_against_published_options(
    *,
    normalized: Mapping[str, Any],
    control: Mapping[str, Any],
) -> None:
    raw_options = control.get("questionOptions")
    if not isinstance(raw_options, dict) or not raw_options:
        return

    question_id = str(normalized.get("question_id") or "")
    published = raw_options.get(question_id)
    if not isinstance(published, dict):
        return

    question_type = normalized.get("question_type")
    if question_type in _SELECT_TYPES:
        allowed = published.get("options")
        if not isinstance(allowed, list) or not allowed:
            return
        selected = normalized.get("selected_option")
        if not isinstance(selected, str) or selected not in allowed:
            raise ConflictError("option_not_allowed")
        return

    if question_type in _MULTISELECT_TYPES:
        allowed = published.get("options")
        if not isinstance(allowed, list) or not allowed:
            return
        allowed_set = set(allowed)
        selected_options = normalized.get("selected_options")
        if not isinstance(selected_options, list):
            return
        for option in selected_options:
            if option not in allowed_set:
                raise ConflictError("option_not_allowed")


def validate_put_body(
    body: Mapping[str, Any],
    *,
    poll_slug: str,
) -> dict[str, Any]:
    session_id = require_session_id(body.get("sessionId"))
    question_id = _require_question_id(body.get("questionId"))
    question_type = _require_question_type(body.get("questionType"))

    body_poll_slug = body.get("pollSlug")
    if body_poll_slug is not None:
        if not isinstance(body_poll_slug, str):
            raise ValidationError("pollSlug must be a string")
        normalized_body_slug = body_poll_slug.strip()
        if normalized_body_slug != poll_slug:
            raise ValidationError("pollSlug does not match URL")

    base = {
        "poll_slug": poll_slug,
        "session_id": session_id,
        "question_id": question_id,
        "question_type": question_type,
    }

    if question_type in _SELECT_TYPES:
        selected_option = _require_non_empty_string(
            body.get("selectedOption"),
            field="selectedOption",
        )
        if len(selected_option) > _MAX_SELECTED_OPTION:
            raise ValidationError(
                f"selectedOption must be at most {_MAX_SELECTED_OPTION} characters"
            )
        return {
            **base,
            "selected_option": selected_option,
            "selected_options": None,
            "boolean_answer": None,
            "free_text": None,
        }

    if question_type in _MULTISELECT_TYPES:
        selected_options = _require_selected_options(body.get("selectedOptions"))
        return {
            **base,
            "selected_option": None,
            "selected_options": selected_options,
            "boolean_answer": None,
            "free_text": None,
        }

    if question_type in _TRUEFALSE_TYPES:
        boolean_answer = _require_boolean(body.get("booleanAnswer"))
        return {
            **base,
            "selected_option": None,
            "selected_options": None,
            "boolean_answer": boolean_answer,
            "free_text": None,
        }

    free_text = _require_non_empty_string(body.get("freeText"), field="freeText")
    if len(free_text) > _MAX_FREE_TEXT:
        raise ValidationError(f"freeText must be at most {_MAX_FREE_TEXT} characters")

    if question_type in _EMAIL_TYPES:
        validated_email = validate_email(free_text)
        if not validated_email:
            raise ValidationError("freeText must be a valid email address")
        free_text = validated_email

    return {
        **base,
        "selected_option": None,
        "selected_options": None,
        "boolean_answer": None,
        "free_text": free_text,
    }


def _require_selected_options(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise ValidationError("selectedOptions is required")
    if not value:
        raise ValidationError("selectedOptions must contain at least one option")
    if len(value) > _MAX_SELECTED_OPTIONS:
        raise ValidationError(
            f"selectedOptions must contain at most {_MAX_SELECTED_OPTIONS} options"
        )
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in value:
        if not isinstance(raw, str):
            raise ValidationError("selectedOptions must contain strings")
        option = raw.strip()
        if not option:
            raise ValidationError("selectedOptions must not contain empty strings")
        if len(option) > _MAX_SELECTED_OPTION:
            raise ValidationError(
                f"each selectedOptions entry must be at most {_MAX_SELECTED_OPTION} characters"
            )
        if option in seen:
            continue
        seen.add(option)
        normalized.append(option)
    if not normalized:
        raise ValidationError("selectedOptions must contain at least one option")
    return normalized


def require_session_id(value: Any) -> str:
    if not isinstance(value, str):
        raise ValidationError("sessionId is required")
    normalized = value.strip()
    if not _SESSION_ID_PATTERN.match(normalized):
        raise ValidationError("sessionId must be a UUID")
    return normalized.lower()


def _require_question_id(value: Any) -> str:
    if not isinstance(value, str):
        raise ValidationError("questionId is required")
    normalized = value.strip()
    if not QUESTION_ID_PATTERN.match(normalized):
        raise ValidationError("questionId must be a kebab-case identifier")
    return normalized


def _require_question_type(value: Any) -> str:
    if not isinstance(value, str):
        raise ValidationError("questionType is required")
    normalized = value.strip().lower()
    allowed = (
        _SELECT_TYPES
        | _MULTISELECT_TYPES
        | _TRUEFALSE_TYPES
        | _TEXT_TYPES
        | _EMAIL_TYPES
    )
    if normalized not in allowed:
        raise ValidationError(
            "questionType must be select, multiselect, truefalse, text, or email"
        )
    return normalized


def _require_boolean(value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValidationError("booleanAnswer must be a boolean")
    return value


def _require_non_empty_string(value: Any, *, field: str) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{field} is required")
    normalized = value.strip()
    if not normalized:
        raise ValidationError(f"{field} is required")
    return normalized
