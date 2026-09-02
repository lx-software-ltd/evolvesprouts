from __future__ import annotations

import base64

import pytest

from app.api.admin_request import (
    encode_tuple_cursor,
    paginate_after_key,
    parse_body,
    parse_limit,
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)
from app.exceptions import AuthorizationError, ValidationError


def test_split_route_parts_drops_version_prefix_and_trailing_slash() -> None:
    assert split_route_parts("/v1/admin/locations/") == ["admin", "locations"]
    assert split_route_parts("admin/tags") == ["admin", "tags"]


def test_route_has_prefix_matches_leading_segments_only() -> None:
    parts = split_route_parts("/v1/admin/services/abc/instances")
    assert route_has_prefix(parts, "admin", "services")
    assert route_has_prefix(parts, "admin")
    assert not route_has_prefix(parts, "admin", "tags")
    assert not route_has_prefix(["admin"], "admin", "services")


def test_parse_body_rejects_invalid_base64_payload() -> None:
    event = {
        "body": "%%%not-base64%%%",
        "isBase64Encoded": True,
    }

    with pytest.raises(ValidationError, match="Request body is not valid base64"):
        parse_body(event)


def test_parse_body_rejects_invalid_json_payload() -> None:
    event = {
        "body": "{invalid-json",
        "isBase64Encoded": False,
    }

    with pytest.raises(ValidationError, match="Request body must be valid JSON"):
        parse_body(event)


def test_parse_body_decodes_base64_json_payload() -> None:
    payload = base64.b64encode(b'{"title":"Guide"}').decode("utf-8")
    event = {
        "body": payload,
        "isBase64Encoded": True,
    }

    assert parse_body(event) == {"title": "Guide"}


def test_require_admin_identity_raises_when_user_sub_missing() -> None:
    with pytest.raises(AuthorizationError, match="Authenticated user is required"):
        require_admin_identity({"requestContext": {"authorizer": {}}})


def test_require_admin_identity_returns_identity_when_present() -> None:
    identity = require_admin_identity(
        {"requestContext": {"authorizer": {"userSub": "sub-1", "groups": "admin"}}}
    )
    assert identity.user_sub == "sub-1"
    assert identity.is_admin_or_manager is True


def test_parse_limit_defaults_to_standard_admin_page_size() -> None:
    assert parse_limit({"queryStringParameters": {}}) == 25


def test_parse_limit_rejects_values_above_standard_max() -> None:
    with pytest.raises(ValidationError, match="limit must be between 1 and 100"):
        parse_limit({"queryStringParameters": {"limit": "101"}})


def test_paginate_after_key_returns_next_cursor_and_resumes() -> None:
    items = [
        {"updatedAt": "2026-01-03", "sessionId": "s-3", "questionId": "q"},
        {"updatedAt": "2026-01-02", "sessionId": "s-2", "questionId": "q"},
        {"updatedAt": "2026-01-01", "sessionId": "s-1", "questionId": "q"},
    ]
    key_fields = ("updatedAt", "sessionId", "questionId")
    first_page, cursor = paginate_after_key(
        items, limit=2, cursor=None, key_fields=key_fields
    )
    assert [row["sessionId"] for row in first_page] == ["s-3", "s-2"]
    assert cursor is not None
    second_page, next_cursor = paginate_after_key(
        items, limit=2, cursor=cursor, key_fields=key_fields
    )
    assert [row["sessionId"] for row in second_page] == ["s-1"]
    assert next_cursor is None


def test_paginate_after_key_rejects_unknown_cursor() -> None:
    with pytest.raises(ValidationError, match="Invalid cursor"):
        paginate_after_key(
            [{"updatedAt": "2026-01-01", "sessionId": "s-1", "questionId": "q"}],
            limit=25,
            cursor=encode_tuple_cursor(
                {"updatedAt": "missing", "sessionId": "s", "questionId": "q"}
            ),
            key_fields=("updatedAt", "sessionId", "questionId"),
        )
