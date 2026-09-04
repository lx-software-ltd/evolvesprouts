from __future__ import annotations

import json
from typing import Any

import pytest

from app.api import admin_cognito_users
from app.services.aws_proxy import AwsProxyError


def _attrs(**values: str) -> list[dict[str, str]]:
    return [{"Name": key, "Value": value} for key, value in values.items()]


def _list_user(
    username: str,
    *,
    sub: str,
    email: str,
    name: str = "",
    status: str = "CONFIRMED",
    enabled: bool = True,
) -> dict[str, Any]:
    attributes = {"sub": sub, "email": email, "email_verified": "true"}
    if name:
        attributes["name"] = name
    return {
        "Username": username,
        "Attributes": _attrs(**attributes),
        "UserStatus": status,
        "Enabled": enabled,
        "UserCreateDate": "2026-01-01T00:00:00+00:00",
        "UserLastModifiedDate": "2026-01-02T00:00:00+00:00",
    }


def _admin_user(
    username: str, *, sub: str, email: str, name: str = "Ada"
) -> dict[str, Any]:
    return {
        "Username": username,
        "UserAttributes": _attrs(
            sub=sub,
            email=email,
            name=name,
            email_verified="true",
        ),
        "UserStatus": "CONFIRMED",
        "Enabled": True,
        "UserCreateDate": "2026-01-01T00:00:00+00:00",
        "UserLastModifiedDate": "2026-01-02T00:00:00+00:00",
    }


@pytest.fixture
def cognito_env(monkeypatch: Any) -> None:
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "pool-1")
    monkeypatch.setenv("ADMIN_GROUP", "admin")
    monkeypatch.setenv("INSTRUCTOR_GROUP", "instructor")


def test_handle_rejects_unknown_path(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    response = admin_cognito_users.handle_admin_cognito_users_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/users",
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/users",
    )
    assert response["statusCode"] == 404


def test_handle_rejects_non_get_on_collection(
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    response = admin_cognito_users.handle_admin_cognito_users_request(
        api_gateway_event(
            method="PUT",
            path="/v1/admin/cognito-users",
            authorizer_context=admin_identity,
        ),
        "PUT",
        "/v1/admin/cognito-users",
    )
    assert response["statusCode"] == 405


def test_list_maps_users_and_staff_groups(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    cognito_env: None,
) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    def fake_invoke(
        _service: str, action: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        calls.append((action, params))
        if action == "list_users":
            return {
                "Users": [
                    _list_user(
                        "ada@example.com",
                        sub="sub-ada",
                        email="ada@example.com",
                        name="Ada",
                    ),
                    _list_user(
                        "pat@example.com", sub="sub-pat", email="pat@example.com"
                    ),
                ]
            }
        if action == "list_users_in_group":
            group = params["GroupName"]
            if group == "admin":
                return {"Users": [{"Username": "ada@example.com"}]}
            return {"Users": []}
        raise AssertionError(action)

    monkeypatch.setattr(admin_cognito_users.aws_proxy, "invoke", fake_invoke)

    response = admin_cognito_users.handle_admin_cognito_users_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/cognito-users",
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/cognito-users",
    )
    assert response["statusCode"] == 200
    payload = json.loads(response["body"])
    assert payload["next_cursor"] is None
    assert [row["username"] for row in payload["items"]] == [
        "ada@example.com",
        "pat@example.com",
    ]
    assert payload["items"][0]["groups"] == ["admin"]
    assert payload["items"][1]["groups"] == []
    assert payload["items"][0]["name"] == "Ada"
    assert any(
        action == "list_users" and "Filter" not in params for action, params in calls
    )


def test_list_uses_email_filter(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    cognito_env: None,
) -> None:
    seen: list[dict[str, Any]] = []

    def fake_invoke(
        _service: str, action: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        if action == "list_users":
            seen.append(params)
            return {"Users": []}
        if action == "list_users_in_group":
            return {"Users": []}
        raise AssertionError(action)

    monkeypatch.setattr(admin_cognito_users.aws_proxy, "invoke", fake_invoke)

    response = admin_cognito_users.handle_admin_cognito_users_request(
        api_gateway_event(
            method="GET",
            path="/v1/admin/cognito-users",
            query_params={"email": "ada@example.com", "name": "Ada"},
            authorizer_context=admin_identity,
        ),
        "GET",
        "/v1/admin/cognito-users",
    )
    assert response["statusCode"] == 200
    assert seen[0]["Filter"] == 'email = "ada@example.com"'


def test_create_user_adds_group(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    cognito_env: None,
) -> None:
    actions: list[str] = []

    def fake_invoke(
        _service: str, action: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        actions.append(action)
        if action == "admin_create_user":
            assert params["Username"] == "ada@example.com"
            assert params["MessageAction"] == "SUPPRESS"
            assert params["TemporaryPassword"].endswith("Aa1!")
            return {}
        if action == "admin_add_user_to_group":
            assert params["GroupName"] == "manager"
            return {}
        if action == "admin_get_user":
            return _admin_user(
                "ada@example.com", sub="sub-ada", email="ada@example.com"
            )
        if action == "admin_list_groups_for_user":
            return {"Groups": [{"GroupName": "manager"}]}
        raise AssertionError(action)

    monkeypatch.setattr(admin_cognito_users.aws_proxy, "invoke", fake_invoke)

    response = admin_cognito_users.handle_admin_cognito_users_request(
        api_gateway_event(
            method="POST",
            path="/v1/admin/cognito-users",
            body=json.dumps(
                {"email": "Ada@example.com", "name": "Ada", "group": "manager"}
            ),
            authorizer_context=admin_identity,
        ),
        "POST",
        "/v1/admin/cognito-users",
    )
    assert response["statusCode"] == 201
    payload = json.loads(response["body"])
    assert payload["username"] == "ada@example.com"
    assert payload["groups"] == ["manager"]
    assert actions[:2] == ["admin_create_user", "admin_add_user_to_group"]


def test_create_duplicate_email_returns_409(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    cognito_env: None,
) -> None:
    def fake_invoke(
        _service: str, action: str, _params: dict[str, Any]
    ) -> dict[str, Any]:
        if action == "admin_create_user":
            raise AwsProxyError("UsernameExistsException", "exists")
        raise AssertionError(action)

    monkeypatch.setattr(admin_cognito_users.aws_proxy, "invoke", fake_invoke)

    with pytest.raises(admin_cognito_users.ConflictError) as exc:
        admin_cognito_users.handle_admin_cognito_users_request(
            api_gateway_event(
                method="POST",
                path="/v1/admin/cognito-users",
                body=json.dumps({"email": "ada@example.com"}),
                authorizer_context=admin_identity,
            ),
            "POST",
            "/v1/admin/cognito-users",
        )
    assert exc.value.status_code == 409
    assert exc.value.to_dict()["field"] == "email"


def test_patch_updates_attributes_and_group(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    cognito_env: None,
) -> None:
    actions: list[tuple[str, dict[str, Any]]] = []

    def fake_invoke(
        _service: str, action: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        actions.append((action, params))
        if action == "admin_get_user":
            return _admin_user(
                "ada@example.com", sub="sub-ada", email="ada@example.com"
            )
        if action == "admin_list_groups_for_user":
            if any(name == "admin_add_user_to_group" for name, _ in actions):
                return {"Groups": [{"GroupName": "instructor"}]}
            return {"Groups": [{"GroupName": "admin"}]}
        if action in {
            "admin_update_user_attributes",
            "admin_remove_user_from_group",
            "admin_add_user_to_group",
        }:
            return {}
        raise AssertionError(action)

    monkeypatch.setattr(admin_cognito_users.aws_proxy, "invoke", fake_invoke)

    response = admin_cognito_users.handle_admin_cognito_users_request(
        api_gateway_event(
            method="PATCH",
            path="/v1/admin/cognito-users/ada@example.com",
            body=json.dumps({"name": "Ada Lovelace", "group": "instructor"}),
            authorizer_context=admin_identity,
        ),
        "PATCH",
        "/v1/admin/cognito-users/ada@example.com",
    )
    assert response["statusCode"] == 200
    invoked = [action for action, _ in actions]
    assert "admin_update_user_attributes" in invoked
    assert "admin_remove_user_from_group" in invoked
    assert "admin_add_user_to_group" in invoked


def test_cannot_disable_self(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    cognito_env: None,
) -> None:
    def fake_invoke(
        _service: str, action: str, _params: dict[str, Any]
    ) -> dict[str, Any]:
        if action == "admin_get_user":
            return _admin_user(
                "admin@example.com",
                sub=admin_identity["userSub"],
                email="admin@example.com",
            )
        if action == "admin_list_groups_for_user":
            return {"Groups": [{"GroupName": "admin"}]}
        raise AssertionError(action)

    monkeypatch.setattr(admin_cognito_users.aws_proxy, "invoke", fake_invoke)

    with pytest.raises(admin_cognito_users.ValidationError, match="your own user"):
        admin_cognito_users.handle_admin_cognito_users_request(
            api_gateway_event(
                method="PATCH",
                path="/v1/admin/cognito-users/admin@example.com",
                body=json.dumps({"enabled": False}),
                authorizer_context=admin_identity,
            ),
            "PATCH",
            "/v1/admin/cognito-users/admin@example.com",
        )


def test_cannot_delete_self(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    cognito_env: None,
) -> None:
    def fake_invoke(
        _service: str, action: str, _params: dict[str, Any]
    ) -> dict[str, Any]:
        if action == "admin_get_user":
            return _admin_user(
                "admin@example.com",
                sub=admin_identity["userSub"],
                email="admin@example.com",
            )
        if action == "admin_list_groups_for_user":
            return {"Groups": [{"GroupName": "admin"}]}
        raise AssertionError(action)

    monkeypatch.setattr(admin_cognito_users.aws_proxy, "invoke", fake_invoke)

    with pytest.raises(admin_cognito_users.ValidationError, match="your own user"):
        admin_cognito_users.handle_admin_cognito_users_request(
            api_gateway_event(
                method="DELETE",
                path="/v1/admin/cognito-users/admin@example.com",
                authorizer_context=admin_identity,
            ),
            "DELETE",
            "/v1/admin/cognito-users/admin@example.com",
        )


def test_delete_user(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    cognito_env: None,
) -> None:
    def fake_invoke(
        _service: str, action: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        if action == "admin_get_user":
            return _admin_user(
                "ada@example.com", sub="sub-ada", email="ada@example.com"
            )
        if action == "admin_list_groups_for_user":
            return {"Groups": []}
        if action == "admin_delete_user":
            assert params["Username"] == "ada@example.com"
            return {}
        raise AssertionError(action)

    monkeypatch.setattr(admin_cognito_users.aws_proxy, "invoke", fake_invoke)

    response = admin_cognito_users.handle_admin_cognito_users_request(
        api_gateway_event(
            method="DELETE",
            path="/v1/admin/cognito-users/ada@example.com",
            authorizer_context=admin_identity,
        ),
        "DELETE",
        "/v1/admin/cognito-users/ada@example.com",
    )
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {
        "deleted": True,
        "username": "ada@example.com",
    }


def test_get_missing_user(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
    cognito_env: None,
) -> None:
    def fake_invoke(
        _service: str, action: str, _params: dict[str, Any]
    ) -> dict[str, Any]:
        if action == "admin_get_user":
            raise AwsProxyError("UserNotFoundException", "missing")
        raise AssertionError(action)

    monkeypatch.setattr(admin_cognito_users.aws_proxy, "invoke", fake_invoke)

    with pytest.raises(admin_cognito_users.NotFoundError):
        admin_cognito_users.handle_admin_cognito_users_request(
            api_gateway_event(
                method="GET",
                path="/v1/admin/cognito-users/missing",
                authorizer_context=admin_identity,
            ),
            "GET",
            "/v1/admin/cognito-users/missing",
        )
