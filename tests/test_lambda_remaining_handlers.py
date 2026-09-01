from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock


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


def test_health_lambda_handler_delegates_to_api_module(
    api_gateway_event: Any,
    monkeypatch: Any,
) -> None:
    handler = _load_lambda_module("health/handler.py", "test_health_lambda_handler")
    expected = {"statusCode": 200, "body": json.dumps({"healthy": True})}
    monkeypatch.setattr(handler, "_handler", lambda event, _context: expected)

    response = handler.lambda_handler(
        api_gateway_event(method="GET", path="/health"),
        None,
    )

    assert response == expected


def test_admin_bootstrap_delete_skips_user_provisioning(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "admin_bootstrap/handler.py",
        "test_admin_bootstrap_delete",
    )
    sent: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(
        handler,
        "send_cfn_response",
        lambda _event, _context, status, data, physical_id, reason=None: sent.append(
            (status, {"data": data, "physical_id": physical_id, "reason": reason})
        ),
    )

    result = handler.lambda_handler({"RequestType": "Delete"}, None)

    assert result["Data"]["status"] == "skipped"
    assert sent[0][0] == "SUCCESS"


def test_admin_bootstrap_create_provisions_admin_user(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "admin_bootstrap/handler.py",
        "test_admin_bootstrap_create",
    )
    sent: list[str] = []
    client = MagicMock()

    monkeypatch.setattr(handler, "get_cognito_idp_client", lambda: client)
    monkeypatch.setattr(
        handler,
        "send_cfn_response",
        lambda _event, _context, status, _data, _physical_id, _reason=None: sent.append(
            status
        ),
    )

    event = {
        "RequestType": "Create",
        "ResourceProperties": {
            "UserPoolId": "ap-southeast-1_example",
            "Email": "Admin@Example.com",
            "TempPassword": "TempPass123!",
            "GroupName": "admin",
        },
    }

    result = handler.lambda_handler(event, None)

    assert result["Data"]["status"] == "ok"
    assert sent == ["SUCCESS"]
    client.admin_create_user.assert_called_once()
    client.admin_set_user_password.assert_called_once()
    client.admin_add_user_to_group.assert_called_once()


def test_admin_bootstrap_create_reports_failure_on_missing_property(
    monkeypatch: Any,
) -> None:
    handler = _load_lambda_module(
        "admin_bootstrap/handler.py",
        "test_admin_bootstrap_failure",
    )
    sent: list[str] = []
    monkeypatch.setattr(
        handler,
        "send_cfn_response",
        lambda _event, _context, status, _data, _physical_id, _reason=None: sent.append(
            status
        ),
    )

    result = handler.lambda_handler(
        {
            "RequestType": "Create",
            "ResourceProperties": {"UserPoolId": "pool"},
        },
        None,
    )

    assert result["Data"]["status"] == "failed"
    assert sent == ["FAILED"]


def test_api_key_rotation_returns_500_when_unconfigured(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "api_key_rotation/handler.py",
        "test_api_key_rotation_unconfigured",
    )
    monkeypatch.delenv("API_GATEWAY_REST_API_ID", raising=False)
    monkeypatch.delenv("API_GATEWAY_USAGE_PLAN_ID", raising=False)
    monkeypatch.delenv("API_KEY_SECRET_ARN", raising=False)

    response = handler.lambda_handler({}, None)

    assert response["statusCode"] == 500
    assert response["body"] == "Missing configuration"


def test_api_key_rotation_creates_and_stores_new_key(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "api_key_rotation/handler.py",
        "test_api_key_rotation_success",
    )
    monkeypatch.setenv("API_GATEWAY_REST_API_ID", "rest-api-id")
    monkeypatch.setenv("API_GATEWAY_USAGE_PLAN_ID", "usage-plan-id")
    monkeypatch.setenv("API_KEY_SECRET_ARN", "arn:aws:secretsmanager:secret")
    monkeypatch.setattr(handler, "_generate_api_key", lambda: "x" * 40)

    class _Paginator:
        def paginate(self, **_: Any) -> list[dict[str, Any]]:
            return [{"items": [{"id": "old-key-id", "name": "public-www-key-old"}]}]

    apigw_client = MagicMock()
    apigw_client.get_paginator.return_value = _Paginator()
    apigw_client.create_api_key.return_value = {"id": "new-key-id"}

    secrets_client = MagicMock()
    secrets_client.get_secret_value.return_value = {
        "SecretString": json.dumps(
            {"api_key_id": "old-key-id", "rotated_at": "2020-01-01T00:00:00+00:00"}
        )
    }

    def _get_client(service_name: str) -> MagicMock:
        if service_name == "apigateway":
            return apigw_client
        if service_name == "secretsmanager":
            return secrets_client
        raise AssertionError(f"Unexpected client: {service_name}")

    monkeypatch.setattr(handler, "get_client", _get_client)
    monkeypatch.setattr(handler, "run_with_retry", lambda func, **_: func())

    response = handler.lambda_handler({}, None)
    body = json.loads(response["body"])

    assert response["statusCode"] == 200
    assert body["new_key_id"] == "new-key-id"
    assert body["old_key_id"] == "old-key-id"
    apigw_client.create_usage_plan_key.assert_called_once()
    secrets_client.put_secret_value.assert_called_once()
    apigw_client.update_api_key.assert_called_once()
    apigw_client.delete_api_key.assert_called_once()


def test_ses_template_manager_delete_skips_template_removal(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "ses_template_manager/handler.py",
        "test_ses_template_manager_delete",
    )
    sent: list[str] = []
    monkeypatch.setattr(
        handler,
        "send_cfn_response",
        lambda _event, _context, status, _data, _physical_id, _reason=None: sent.append(
            status
        ),
    )

    result = handler.lambda_handler({"RequestType": "Delete"}, None)

    assert "templates" in result["Data"]
    assert sent == ["SUCCESS"]


def test_ses_template_manager_create_upserts_templates(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "ses_template_manager/handler.py",
        "test_ses_template_manager_create",
    )
    sent: list[str] = []
    client = MagicMock()
    client.create_template.side_effect = [
        {"ResponseMetadata": {"HTTPStatusCode": 200}},
        handler.ClientError(
            {"Error": {"Code": "AlreadyExists", "Message": "exists"}},
            "CreateTemplate",
        ),
    ]

    monkeypatch.setattr(handler, "get_ses_client", lambda: client)
    monkeypatch.setattr(
        handler,
        "send_cfn_response",
        lambda _event, _context, status, _data, _physical_id, _reason=None: sent.append(
            status
        ),
    )
    monkeypatch.setattr(
        handler,
        "contact_templates",
        lambda: [
            {
                "TemplateName": "contact-one",
                "SubjectPart": "Subject",
                "HtmlPart": "<p>Hi</p>",
                "TextPart": "Hi",
            }
        ],
    )
    monkeypatch.setattr(handler, "media_templates", lambda: [])
    monkeypatch.setattr(handler, "booking_templates", lambda: [])
    monkeypatch.setattr(handler, "intro_call_templates", lambda: [])
    monkeypatch.setattr(handler, "invoice_templates", lambda: [])

    result = handler.lambda_handler({"RequestType": "Create"}, None)

    assert result["Data"]["templates"] == "contact-one"
    assert sent == ["SUCCESS"]
    client.create_template.assert_called_once()
    client.update_template.assert_not_called()


def test_ses_template_manager_create_updates_existing_template(
    monkeypatch: Any,
) -> None:
    handler = _load_lambda_module(
        "ses_template_manager/handler.py",
        "test_ses_template_manager_update",
    )
    client = MagicMock()
    client.create_template.side_effect = handler.ClientError(
        {"Error": {"Code": "AlreadyExists", "Message": "exists"}},
        "CreateTemplate",
    )

    monkeypatch.setattr(handler, "get_ses_client", lambda: client)
    monkeypatch.setattr(
        handler,
        "send_cfn_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        handler,
        "contact_templates",
        lambda: [
            {
                "TemplateName": "contact-one",
                "SubjectPart": "Subject",
                "HtmlPart": "<p>Hi</p>",
                "TextPart": "Hi",
            }
        ],
    )
    monkeypatch.setattr(handler, "media_templates", lambda: [])
    monkeypatch.setattr(handler, "booking_templates", lambda: [])
    monkeypatch.setattr(handler, "intro_call_templates", lambda: [])
    monkeypatch.setattr(handler, "invoice_templates", lambda: [])

    handler.lambda_handler({"RequestType": "Update"}, None)

    client.update_template.assert_called_once()


def test_pre_signup_auto_confirms_user() -> None:
    handler = _load_lambda_module(
        "auth/pre_signup/handler.py",
        "test_pre_signup_handler",
    )
    event = {
        "request": {"userAttributes": {"email": "user@example.com"}},
        "response": {},
    }

    result = handler.lambda_handler(event, None)

    assert result["response"]["autoConfirmUser"] is True
    assert result["response"]["autoVerifyEmail"] is True


def test_post_authentication_skips_when_identifiers_missing() -> None:
    handler = _load_lambda_module(
        "auth/post_authentication/handler.py",
        "test_post_authentication_missing_ids",
    )
    event = {"request": {"userAttributes": {"email": "user@example.com"}}}

    result = handler.lambda_handler(event, None)

    assert result is event


def test_post_authentication_updates_last_auth_time(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "auth/post_authentication/handler.py",
        "test_post_authentication_success",
    )
    client = MagicMock()
    monkeypatch.setattr(handler, "get_cognito_idp_client", lambda: client)
    monkeypatch.setattr(handler.time, "time", lambda: 1_700_000_000.0)

    event = {
        "userPoolId": "ap-southeast-1_example",
        "userName": "user@example.com",
        "request": {"userAttributes": {"email": "user@example.com"}},
    }

    result = handler.lambda_handler(event, None)

    assert result is event
    client.admin_update_user_attributes.assert_called_once_with(
        UserPoolId="ap-southeast-1_example",
        Username="user@example.com",
        UserAttributes=[{"Name": "custom:last_auth_time", "Value": "1700000000"}],
    )


def test_define_auth_challenge_issues_tokens_after_success(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "auth/define_auth_challenge/handler.py",
        "test_define_auth_challenge_success",
    )
    monkeypatch.setenv("MAX_CHALLENGE_ATTEMPTS", "3")
    event = {
        "request": {
            "userAttributes": {"email": "user@example.com"},
            "session": [
                {"challengeName": "CUSTOM_CHALLENGE", "challengeResult": True},
            ],
        },
        "response": {},
    }

    result = handler.lambda_handler(event, None)

    assert result["response"]["issueTokens"] is True
    assert result["response"]["failAuthentication"] is False


def test_define_auth_challenge_fails_after_max_attempts(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "auth/define_auth_challenge/handler.py",
        "test_define_auth_challenge_max_attempts",
    )
    monkeypatch.setenv("MAX_CHALLENGE_ATTEMPTS", "2")
    event = {
        "request": {
            "userAttributes": {"email": "user@example.com"},
            "session": [
                {"challengeName": "CUSTOM_CHALLENGE", "challengeResult": False},
                {"challengeName": "CUSTOM_CHALLENGE", "challengeResult": False},
            ],
        },
        "response": {},
    }

    result = handler.lambda_handler(event, None)

    assert result["response"]["issueTokens"] is False
    assert result["response"]["failAuthentication"] is True


def test_define_auth_challenge_requests_custom_challenge_for_new_session(
    monkeypatch: Any,
) -> None:
    handler = _load_lambda_module(
        "auth/define_auth_challenge/handler.py",
        "test_define_auth_challenge_new_session",
    )
    monkeypatch.setenv("MAX_CHALLENGE_ATTEMPTS", "3")
    event = {
        "request": {"userAttributes": {"email": "user@example.com"}, "session": []},
        "response": {},
    }

    result = handler.lambda_handler(event, None)

    assert result["response"]["challengeName"] == "CUSTOM_CHALLENGE"
    assert result["response"]["issueTokens"] is False
    assert result["response"]["failAuthentication"] is False


def test_create_auth_challenge_ignores_non_custom_challenge() -> None:
    handler = _load_lambda_module(
        "auth/create_auth_challenge/handler.py",
        "test_create_auth_challenge_skip",
    )
    event = {
        "request": {"challengeName": "SRP_A"},
        "response": {},
    }

    result = handler.lambda_handler(event, None)

    assert result["response"] == {}


def test_create_auth_challenge_sets_private_answer(monkeypatch: Any) -> None:
    handler = _load_lambda_module(
        "auth/create_auth_challenge/handler.py",
        "test_create_auth_challenge_custom",
    )
    monkeypatch.setattr(
        handler,
        "build_challenge",
        lambda: {"code": "123456"},
    )
    monkeypatch.setattr(handler, "send_sign_in_email", lambda _email, _code: None)

    event = {
        "request": {
            "challengeName": "CUSTOM_CHALLENGE",
            "userAttributes": {"email": "user@example.com"},
        },
        "response": {},
    }

    result = handler.lambda_handler(event, None)

    assert result["response"]["publicChallengeParameters"] == {
        "email": "user@example.com",
    }
    assert result["response"]["privateChallengeParameters"] == {"answer": "123456"}
    assert result["response"]["challengeMetadata"] == "EMAIL_OTP"


def test_verify_auth_challenge_marks_correct_answer() -> None:
    handler = _load_lambda_module(
        "auth/verify_auth_challenge/handler.py",
        "test_verify_auth_challenge_correct",
    )
    event = {
        "request": {
            "userAttributes": {"email": "user@example.com"},
            "privateChallengeParameters": {"answer": "123456"},
            "challengeAnswer": "123456",
        },
        "response": {},
    }

    result = handler.lambda_handler(event, None)

    assert result["response"]["answerCorrect"] is True


def test_verify_auth_challenge_marks_incorrect_answer() -> None:
    handler = _load_lambda_module(
        "auth/verify_auth_challenge/handler.py",
        "test_verify_auth_challenge_incorrect",
    )
    event = {
        "request": {
            "userAttributes": {"email": "user@example.com"},
            "privateChallengeParameters": {"answer": "123456"},
            "challengeAnswer": "000000",
        },
        "response": {},
    }

    result = handler.lambda_handler(event, None)

    assert result["response"]["answerCorrect"] is False
