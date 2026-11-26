from __future__ import annotations

import json

import pytest

from app.exceptions import ValidationError
from app.utils import CACHE_CONTROL_EDGE_CACHEABLE_GET
from app.utils.responses import json_response, validate_content_type


def test_validate_content_type_allows_bodyless_post() -> None:
    event = {
        "httpMethod": "POST",
        "headers": {},
        "body": "",
    }

    validate_content_type(event)


def test_validate_content_type_requires_header_for_post_with_body() -> None:
    event = {
        "httpMethod": "POST",
        "headers": {},
        "body": "{}",
    }

    with pytest.raises(
        ValidationError,
        match="Content-Type header is required for requests with a body",
    ):
        validate_content_type(event)


def test_json_response_strips_pragma_when_cache_control_is_edge_cacheable() -> None:
    response = json_response(
        200,
        {"ok": True},
        headers={"Cache-Control": CACHE_CONTROL_EDGE_CACHEABLE_GET},
        event={"headers": {}},
    )
    assert "Pragma" not in response["headers"]
    assert response["headers"]["Cache-Control"] == CACHE_CONTROL_EDGE_CACHEABLE_GET


def test_json_response_keeps_pragma_when_cache_control_is_no_store() -> None:
    response = json_response(
        404,
        {"error": "x"},
        headers={"Cache-Control": "no-store"},
        event={"headers": {}},
    )
    assert response["headers"].get("Pragma") == "no-cache"


def test_legacy_error_code_body_gains_problem_members() -> None:
    response = json_response(
        400,
        {"error": "Nope", "code": "legacy_code"},
        event={"requestContext": {"requestId": "req-legacy"}},
    )
    body = json.loads(response["body"])
    assert body["error"] == "Nope"
    assert body["detail"] == "Nope"
    assert body["code"] == "legacy_code"
    assert body["type"] == "about:blank"
    assert body["title"] == "Bad Request"
    assert body["request_id"] == "req-legacy"


def test_validate_content_type_rejects_non_json_content_type() -> None:
    event = {
        "httpMethod": "POST",
        "headers": {"Content-Type": "text/plain"},
        "body": "{}",
    }

    with pytest.raises(ValidationError, match="Content-Type must be application/json"):
        validate_content_type(event)
