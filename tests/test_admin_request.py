from __future__ import annotations

import base64

import pytest

from app.api.admin_request import parse_body, parse_limit, require_admin_identity
from app.exceptions import AuthorizationError, ValidationError


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
