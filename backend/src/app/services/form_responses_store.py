"""DynamoDB persistence for training-site form answers (shared poll-responses table)."""

from __future__ import annotations

import os
from collections import Counter
from datetime import UTC, datetime
from collections.abc import Mapping
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from app.exceptions import AppError
from app.utils.logging import get_logger

logger = get_logger(__name__)

_TABLE_ENV = "POLL_RESPONSES_TABLE_NAME"
_PK_PREFIX = "FORM#"
_SK_PREFIX = "SESSION#"
_SK_QUESTION_SEP = "#Q#"

_dynamodb = None
_table = None


def _table_name() -> str:
    name = os.environ.get(_TABLE_ENV, "").strip()
    if not name:
        raise AppError(
            "Form responses table is not configured",
            status_code=500,
        )
    return name


def _get_table():
    global _dynamodb, _table
    if _table is None:
        _dynamodb = boto3.resource("dynamodb")
        _table = _dynamodb.Table(_table_name())
    return _table


def _partition_key(*, form_slug: str) -> str:
    return f"{_PK_PREFIX}{form_slug}"


def _sort_key(*, session_id: str, question_id: str) -> str:
    return f"{_SK_PREFIX}{session_id}{_SK_QUESTION_SEP}{question_id}"


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def upsert_form_answer(
    *,
    form_slug: str,
    session_id: str,
    question_id: str,
    question_type: str,
    selected_option: str | None = None,
    selected_options: list[str] | None = None,
    boolean_answer: bool | None = None,
    rating_value: int | None = None,
    free_text: str | None = None,
    contact_id: str | None = None,
) -> dict[str, Any]:
    """Persist one question answer; overwrites prior value for the same session/question."""
    table = _get_table()
    key = {
        "pk": _partition_key(form_slug=form_slug),
        "sk": _sort_key(session_id=session_id, question_id=question_id),
    }
    now = _now_iso()
    item: dict[str, Any] = {
        **key,
        "formSlug": form_slug,
        "sessionId": session_id,
        "questionId": question_id,
        "questionType": question_type,
        "updatedAt": now,
    }
    if selected_option is not None:
        item["selectedOption"] = selected_option
    if selected_options is not None:
        item["selectedOptions"] = selected_options
    if boolean_answer is not None:
        item["booleanAnswer"] = boolean_answer
    if rating_value is not None:
        item["ratingValue"] = rating_value
    if free_text is not None:
        item["freeText"] = free_text

    try:
        existing = table.get_item(Key=key).get("Item")
        if existing and existing.get("createdAt"):
            item["createdAt"] = existing["createdAt"]
        else:
            item["createdAt"] = now
        resolved_contact_id = _resolve_stored_contact_id(
            incoming=contact_id,
            existing=existing,
        )
        if resolved_contact_id:
            item["contactId"] = resolved_contact_id
        table.put_item(Item=item)
    except ClientError:
        logger.exception(
            "Failed to persist form answer",
            extra={
                "form_slug": form_slug,
                "question_id": question_id,
            },
        )
        raise AppError(
            "Failed to persist form answer",
            status_code=500,
        ) from None

    return {
        "formSlug": form_slug,
        "sessionId": session_id,
        "questionId": question_id,
        "updatedAt": now,
    }


def list_form_summaries() -> list[dict[str, Any]]:
    """Return distinct form slugs with answer row counts from DynamoDB."""
    table = _get_table()
    slug_counts: Counter[str] = Counter()
    scan_kwargs: dict[str, Any] = {
        "FilterExpression": Attr("pk").begins_with(_PK_PREFIX),
        "ProjectionExpression": "pk, formSlug, sk",
    }
    try:
        while True:
            response = table.scan(**scan_kwargs)
            for item in response.get("Items", []):
                sk = item.get("sk")
                if not isinstance(sk, str) or not sk.startswith(_SK_PREFIX):
                    continue
                slug = _extract_form_slug_from_item(item)
                if slug:
                    slug_counts[slug] += 1
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            scan_kwargs["ExclusiveStartKey"] = last_key
    except ClientError:
        logger.exception("Failed to scan form responses table")
        raise AppError(
            "Failed to list form responses",
            status_code=500,
        ) from None

    return [
        {"formSlug": slug, "answerCount": count}
        for slug, count in sorted(slug_counts.items())
    ]


def list_form_answers(*, form_slug: str) -> list[dict[str, Any]]:
    """Return all answer rows for one form, sorted by updated time descending."""
    table = _get_table()
    try:
        items = _query_form_items(table=table, form_slug=form_slug)
    except ClientError:
        logger.exception(
            "Failed to query form answers",
            extra={"form_slug": form_slug},
        )
        raise AppError(
            "Failed to list form answers",
            status_code=500,
        ) from None

    serialized = [serialize_form_answer_item(item) for item in items]
    serialized.sort(
        key=lambda row: (
            str(row.get("updatedAt") or ""),
            str(row.get("sessionId") or ""),
            str(row.get("questionId") or ""),
        ),
        reverse=True,
    )
    return serialized


def serialize_form_answer_item(item: Mapping[str, Any]) -> dict[str, Any]:
    """Map a DynamoDB form answer item to an admin API payload."""
    row: dict[str, Any] = {
        "formSlug": item.get("formSlug"),
        "sessionId": item.get("sessionId"),
        "questionId": item.get("questionId"),
        "questionType": item.get("questionType"),
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }
    selected_option = item.get("selectedOption")
    if isinstance(selected_option, str):
        row["selectedOption"] = selected_option
    selected_options = item.get("selectedOptions")
    if isinstance(selected_options, list):
        row["selectedOptions"] = [
            option
            for option in selected_options
            if isinstance(option, str) and option.strip()
        ]
    boolean_answer = item.get("booleanAnswer")
    if isinstance(boolean_answer, bool):
        row["booleanAnswer"] = boolean_answer
    rating_value = item.get("ratingValue")
    if isinstance(rating_value, (int, float)) and not isinstance(rating_value, bool):
        row["ratingValue"] = int(rating_value)
    free_text = item.get("freeText")
    if isinstance(free_text, str):
        row["freeText"] = free_text
    contact_id = item.get("contactId")
    if isinstance(contact_id, str) and contact_id.strip():
        row["contactId"] = contact_id.strip()
    return row


def clear_form_answers(*, form_slug: str) -> int:
    """Delete all answer rows for one form. Returns the number of rows removed."""
    table = _get_table()
    try:
        items = _query_form_items(table=table, form_slug=form_slug)
    except ClientError:
        logger.exception(
            "Failed to query form answers for clear",
            extra={"form_slug": form_slug},
        )
        raise AppError(
            "Failed to clear form answers",
            status_code=500,
        ) from None

    if not items:
        return 0

    try:
        with table.batch_writer() as batch:
            for item in items:
                batch.delete_item(
                    Key={
                        "pk": item["pk"],
                        "sk": item["sk"],
                    }
                )
    except ClientError:
        logger.exception(
            "Failed to delete form answers",
            extra={"form_slug": form_slug},
        )
        raise AppError(
            "Failed to clear form answers",
            status_code=500,
        ) from None

    return len(items)


def _resolve_stored_contact_id(
    *,
    incoming: str | None,
    existing: Mapping[str, Any] | None,
) -> str | None:
    if isinstance(incoming, str) and incoming.strip():
        return incoming.strip()
    if not existing:
        return None
    prior = existing.get("contactId")
    if isinstance(prior, str) and prior.strip():
        return prior.strip()
    return None


def _extract_form_slug_from_item(item: Mapping[str, Any]) -> str | None:
    form_slug = item.get("formSlug")
    if isinstance(form_slug, str):
        normalized = form_slug.strip()
        if normalized:
            return normalized
    pk = item.get("pk")
    if isinstance(pk, str) and pk.startswith(_PK_PREFIX):
        normalized = pk[len(_PK_PREFIX) :].strip()
        return normalized or None
    return None


def _query_form_items(*, table: Any, form_slug: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    query_kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq(_partition_key(form_slug=form_slug)),
    }
    while True:
        response = table.query(**query_kwargs)
        for item in response.get("Items", []):
            sk = item.get("sk")
            if isinstance(sk, str) and sk.startswith(_SK_PREFIX):
                items.append(item)
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        query_kwargs["ExclusiveStartKey"] = last_key
    return items


def reset_table_for_tests() -> None:
    """Clear cached table handle (unit tests only)."""
    global _dynamodb, _table
    _dynamodb = None
    _table = None


def configure_table_for_tests(table: Any) -> None:
    """Inject a mock table (unit tests only)."""
    global _table
    _table = table
