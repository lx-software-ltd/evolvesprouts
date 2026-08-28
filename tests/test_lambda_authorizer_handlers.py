from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

from app.auth import authorizer_utils


def _load_lambda_module(relative_path: str, module_name: str) -> Any:
    module_path = (
        Path(__file__).resolve().parents[1] / "backend" / "lambda" / relative_path
    )
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module at {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cognito_group_authorizer_allows_matching_group(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "authorizers/cognito_group/handler.py",
        "test_cognito_group_authorizer",
    )
    monkeypatch.setenv("ALLOWED_GROUPS", "admin,manager")

    class _Claims:
        sub = "user-sub"
        email = "admin@example.com"
        groups = ["admin"]
        raw_claims = {"custom:organization_ids": "org-1"}

    monkeypatch.setattr(
        authorizer_utils,
        "decode_and_verify_token",
        lambda _token: _Claims(),
    )

    event = {
        "headers": {"Authorization": "Bearer valid.jwt"},
        "methodArn": "arn:aws:execute-api:ap-southeast-1:123456789012:api/prod/GET/path",
    }
    response = handler.lambda_handler(event, None)

    assert response["policyDocument"]["Statement"][0]["Effect"] == "Allow"
    assert response["context"]["userSub"] == "user-sub"


def test_cognito_user_authorizer_denies_missing_token() -> None:
    handler = _load_lambda_module(
        "authorizers/cognito_user/handler.py",
        "test_cognito_user_authorizer",
    )
    response = handler.lambda_handler({"headers": {}, "methodArn": "arn:example"}, None)

    assert response["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert response["context"]["reason"] == "missing_token"


def test_api_token_authorizer_denies_missing_header() -> None:
    handler = _load_lambda_module(
        "authorizers/api_token/handler.py",
        "test_api_token_authorizer",
    )
    response = handler.lambda_handler({"headers": {}, "methodArn": "arn:example"}, None)

    assert response["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert response["context"]["reason"] == "missing_key"


def test_device_attestation_authorizer_denies_when_unconfigured_fail_closed(
    monkeypatch: Any,
) -> None:
    handler = _load_lambda_module(
        "authorizers/device_attestation/handler.py",
        "test_device_attestation_authorizer",
    )
    monkeypatch.setenv("ATTESTATION_FAIL_CLOSED", "true")
    monkeypatch.setattr(handler, "is_attestation_enabled", lambda: False)

    response = handler.lambda_handler({"headers": {}, "methodArn": "arn:example"}, None)

    assert response["policyDocument"]["Statement"][0]["Effect"] == "Deny"
    assert response["context"]["reason"] == "attestation_not_configured"
