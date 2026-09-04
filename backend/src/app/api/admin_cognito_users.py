"""Admin Cognito user pool management (Audit → Users)."""

from __future__ import annotations

import os
import secrets
from collections.abc import Mapping
from typing import Any, NoReturn
from urllib.parse import unquote

from app.api.admin_request import (
    parse_body,
    parse_limit,
    query_param,
    require_admin_identity,
    route_has_prefix,
    split_route_parts,
)
from app.api.admin_users import _extract_cognito_attribute
from app.api.admin_validators import MAX_NAME_LENGTH, validate_email, validate_string_length
from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.services import aws_proxy
from app.services.aws_proxy import AwsProxyError
from app.utils import json_response, method_not_allowed, not_found
from app.utils.logging import get_logger, mask_email

logger = get_logger(__name__)

_DEFAULT_MANAGER_GROUP = "manager"
_COGNITO_PAGE_LIMIT = 60
_SELF_MUTATION_MESSAGE = "You cannot change, disable, or delete your own user"


def handle_admin_cognito_users_request(
    event: Mapping[str, Any],
    method: str,
    path: str,
) -> dict[str, Any]:
    """Handle /v1/admin/cognito-users routes."""
    parts = split_route_parts(path)
    if not route_has_prefix(parts, "admin", "cognito-users"):
        return not_found(event)
    identity = require_admin_identity(event)
    username = unquote(parts[2]).strip() if len(parts) == 3 else None
    if len(parts) > 3 or (username is not None and not username):
        return not_found(event)
    if method == "GET" and username is None:
        return _list_cognito_users(event)
    if method == "POST" and username is None:
        return _create_cognito_user(event)
    if method == "GET" and username is not None:
        return _get_cognito_user(event, username)
    if method == "PATCH" and username is not None:
        return _update_cognito_user(event, username, actor_sub=identity.user_sub)
    if method == "DELETE" and username is not None:
        return _delete_cognito_user(event, username, actor_sub=identity.user_sub)
    return method_not_allowed(event)


def _list_cognito_users(event: Mapping[str, Any]) -> dict[str, Any]:
    user_pool_id = _require_user_pool_id()
    limit = parse_limit(event)
    name_filter = (query_param(event, "name") or "").strip()
    email_filter = (query_param(event, "email") or "").strip().lower()
    pagination_token = query_param(event, "cursor")
    cognito_filter = _build_list_filter(name_filter, email_filter)
    apply_name_locally = bool(name_filter and email_filter)

    params: dict[str, Any] = {
        "UserPoolId": user_pool_id,
        "Limit": _COGNITO_PAGE_LIMIT if apply_name_locally else min(limit, _COGNITO_PAGE_LIMIT),
    }
    if cognito_filter:
        params["Filter"] = cognito_filter
    if pagination_token:
        params["PaginationToken"] = pagination_token

    response = _invoke("list_users", params)
    group_map = _staff_group_membership(user_pool_id)
    users: list[dict[str, Any]] = []
    for raw in response.get("Users", []):
        if not isinstance(raw, Mapping):
            continue
        row = _serialize_list_user(raw, group_map)
        if apply_name_locally and not _name_matches(row.get("name"), name_filter):
            continue
        users.append(row)
        if len(users) >= limit:
            break

    next_cursor = response.get("PaginationToken")
    if not isinstance(next_cursor, str) or not next_cursor:
        next_cursor = None
    return json_response(
        200,
        {"items": users, "next_cursor": next_cursor},
        event=event,
    )


def _create_cognito_user(event: Mapping[str, Any]) -> dict[str, Any]:
    user_pool_id = _require_user_pool_id()
    body = parse_body(event)
    email = validate_email(body.get("email"))
    if not email:
        raise ValidationError("email is required", field="email")
    name = validate_string_length(body.get("name"), "name", MAX_NAME_LENGTH)
    group = _parse_group(body.get("group"), required=False)
    attributes = [
        {"Name": "email", "Value": email},
        {"Name": "email_verified", "Value": "true"},
    ]
    if name:
        attributes.append({"Name": "name", "Value": name})
    try:
        _invoke(
            "admin_create_user",
            {
                "UserPoolId": user_pool_id,
                "Username": email,
                "TemporaryPassword": _temporary_password(),
                "MessageAction": "SUPPRESS",
                "UserAttributes": attributes,
            },
        )
    except AwsProxyError as exc:
        _raise_proxy_error(exc, username=email)
    if group:
        _add_to_group(user_pool_id, email, group)
    logger.info("Created Cognito user", extra={"user": mask_email(email)})
    return json_response(201, _load_user(user_pool_id, email), event=event)


def _get_cognito_user(event: Mapping[str, Any], username: str) -> dict[str, Any]:
    return json_response(200, _load_user(_require_user_pool_id(), username), event=event)


def _update_cognito_user(
    event: Mapping[str, Any],
    username: str,
    *,
    actor_sub: str,
) -> dict[str, Any]:
    user_pool_id = _require_user_pool_id()
    body = parse_body(event)
    current = _load_user(user_pool_id, username)
    if "email" in body:
        email = validate_email(body.get("email"))
        if not email:
            raise ValidationError("email is required", field="email")
        _update_attributes(
            user_pool_id,
            username,
            [
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
        )
    if "name" in body:
        name = validate_string_length(body.get("name"), "name", MAX_NAME_LENGTH)
        if name:
            _update_attributes(
                user_pool_id,
                username,
                [{"Name": "name", "Value": name}],
            )
    if "group" in body:
        next_group = _parse_group(body.get("group"), required=False)
        _reject_self_lockout(current, actor_sub, next_group=next_group)
        _replace_staff_groups(user_pool_id, username, current.get("groups") or [], next_group)
    if "enabled" in body:
        enabled = body.get("enabled")
        if not isinstance(enabled, bool):
            raise ValidationError("enabled must be a boolean", field="enabled")
        if enabled is False:
            _reject_self_mutation(current, actor_sub)
        _invoke(
            "admin_enable_user" if enabled else "admin_disable_user",
            {"UserPoolId": user_pool_id, "Username": username},
        )
    return json_response(200, _load_user(user_pool_id, username), event=event)


def _delete_cognito_user(
    event: Mapping[str, Any],
    username: str,
    *,
    actor_sub: str,
) -> dict[str, Any]:
    user_pool_id = _require_user_pool_id()
    current = _load_user(user_pool_id, username)
    _reject_self_mutation(current, actor_sub)
    _invoke("admin_delete_user", {"UserPoolId": user_pool_id, "Username": username})
    logger.info("Deleted Cognito user", extra={"user": mask_email(current.get("email") or username)})
    return json_response(200, {"deleted": True, "username": username}, event=event)


def _load_user(user_pool_id: str, username: str) -> dict[str, Any]:
    try:
        raw = _invoke("admin_get_user", {"UserPoolId": user_pool_id, "Username": username})
    except AwsProxyError as exc:
        _raise_proxy_error(exc, username=username)
    groups: list[str] = []
    try:
        group_response = _invoke(
            "admin_list_groups_for_user",
            {"UserPoolId": user_pool_id, "Username": username},
        )
    except AwsProxyError as exc:
        _raise_proxy_error(exc, username=username)
    staff = set(_staff_groups())
    for item in group_response.get("Groups", []):
        if not isinstance(item, Mapping):
            continue
        name = item.get("GroupName")
        if isinstance(name, str) and name in staff:
            groups.append(name)
    return _serialize_admin_user(raw, groups)


def _serialize_list_user(raw: Mapping[str, Any], group_map: Mapping[str, list[str]]) -> dict[str, Any]:
    username = raw.get("Username")
    username_value = username if isinstance(username, str) else ""
    attributes = raw.get("Attributes")
    return _serialize_user(
        username=username_value,
        attributes=attributes,
        enabled=raw.get("Enabled"),
        status=raw.get("UserStatus"),
        created_at=raw.get("UserCreateDate"),
        updated_at=raw.get("UserLastModifiedDate"),
        groups=list(group_map.get(username_value, [])),
    )


def _serialize_admin_user(raw: Mapping[str, Any], groups: list[str]) -> dict[str, Any]:
    username = raw.get("Username")
    return _serialize_user(
        username=username if isinstance(username, str) else "",
        attributes=raw.get("UserAttributes"),
        enabled=raw.get("Enabled"),
        status=raw.get("UserStatus"),
        created_at=raw.get("UserCreateDate"),
        updated_at=raw.get("UserLastModifiedDate"),
        groups=groups,
    )


def _serialize_user(
    *,
    username: str,
    attributes: Any,
    enabled: Any,
    status: Any,
    created_at: Any,
    updated_at: Any,
    groups: list[str],
) -> dict[str, Any]:
    sub = _extract_cognito_attribute(attributes, "sub") or ""
    return {
        "username": username,
        "sub": sub,
        "email": _extract_cognito_attribute(attributes, "email"),
        "name": _extract_cognito_attribute(attributes, "name"),
        "email_verified": _extract_cognito_attribute(attributes, "email_verified") == "true",
        "enabled": enabled is not False,
        "status": status if isinstance(status, str) else "UNKNOWN",
        "groups": groups,
        "created_at": _as_iso(created_at),
        "updated_at": _as_iso(updated_at),
        "last_auth_time": _extract_cognito_attribute(attributes, "custom:last_auth_time"),
    }


def _staff_group_membership(user_pool_id: str) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for group_name in _staff_groups():
        next_token: str | None = None
        while True:
            params: dict[str, Any] = {
                "UserPoolId": user_pool_id,
                "GroupName": group_name,
                "Limit": _COGNITO_PAGE_LIMIT,
            }
            if next_token:
                params["NextToken"] = next_token
            try:
                response = _invoke("list_users_in_group", params)
            except AwsProxyError as exc:
                if exc.code == "ResourceNotFoundException":
                    break
                raise
            for user in response.get("Users", []):
                if not isinstance(user, Mapping):
                    continue
                username = user.get("Username")
                if isinstance(username, str) and username:
                    mapping.setdefault(username, []).append(group_name)
            token = response.get("NextToken")
            next_token = token if isinstance(token, str) and token else None
            if not next_token:
                break
    return mapping


def _replace_staff_groups(
    user_pool_id: str,
    username: str,
    current_groups: list[Any],
    next_group: str | None,
) -> None:
    current = {group for group in current_groups if isinstance(group, str)}
    desired = {next_group} if next_group else set()
    for group_name in current - desired:
        _invoke(
            "admin_remove_user_from_group",
            {"UserPoolId": user_pool_id, "Username": username, "GroupName": group_name},
        )
    for group_name in desired - current:
        _add_to_group(user_pool_id, username, group_name)


def _add_to_group(user_pool_id: str, username: str, group_name: str) -> None:
    try:
        _invoke(
            "admin_add_user_to_group",
            {"UserPoolId": user_pool_id, "Username": username, "GroupName": group_name},
        )
    except AwsProxyError as exc:
        _raise_proxy_error(exc, username=username)


def _update_attributes(user_pool_id: str, username: str, attributes: list[dict[str, str]]) -> None:
    try:
        _invoke(
            "admin_update_user_attributes",
            {
                "UserPoolId": user_pool_id,
                "Username": username,
                "UserAttributes": attributes,
            },
        )
    except AwsProxyError as exc:
        _raise_proxy_error(exc, username=username)


def _build_list_filter(name_filter: str, email_filter: str) -> str | None:
    if email_filter:
        operator = "=" if "@" in email_filter else "^="
        return f"email {operator} {_quote_filter(email_filter)}"
    if name_filter:
        return f"name ^= {_quote_filter(name_filter)}"
    return None


def _quote_filter(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _name_matches(name: Any, needle: str) -> bool:
    if not isinstance(name, str):
        return False
    return needle.casefold() in name.casefold()


def _parse_group(value: Any, *, required: bool) -> str | None:
    if value is None:
        if required:
            raise ValidationError("group is required", field="group")
        return None
    if not isinstance(value, str):
        raise ValidationError("group must be a string", field="group")
    group_name = value.strip()
    if not group_name:
        if required:
            raise ValidationError("group is required", field="group")
        return None
    allowed = _staff_groups()
    if group_name not in allowed:
        raise ValidationError(
            f"group must be one of: {', '.join(allowed)}",
            field="group",
        )
    return group_name


def _staff_groups() -> tuple[str, ...]:
    admin = os.getenv("ADMIN_GROUP", "admin").strip() or "admin"
    manager = os.getenv("MANAGER_GROUP", _DEFAULT_MANAGER_GROUP).strip() or _DEFAULT_MANAGER_GROUP
    instructor = os.getenv("INSTRUCTOR_GROUP", "instructor").strip() or "instructor"
    return (admin, manager, instructor)


def _require_user_pool_id() -> str:
    user_pool_id = os.getenv("COGNITO_USER_POOL_ID")
    if not user_pool_id:
        raise ValidationError(
            "COGNITO_USER_POOL_ID is not configured",
            field="COGNITO_USER_POOL_ID",
        )
    return user_pool_id


def _reject_self_mutation(user: Mapping[str, Any], actor_sub: str) -> None:
    if user.get("sub") and user.get("sub") == actor_sub:
        raise ValidationError(_SELF_MUTATION_MESSAGE)


def _reject_self_lockout(
    user: Mapping[str, Any],
    actor_sub: str,
    *,
    next_group: str | None,
) -> None:
    if next_group is not None:
        return
    if user.get("sub") and user.get("sub") == actor_sub:
        raise ValidationError(_SELF_MUTATION_MESSAGE)


def _temporary_password() -> str:
    return f"{secrets.token_urlsafe(18)}Aa1!"


def _as_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value or None
    return str(value)


def _invoke(action: str, params: dict[str, Any]) -> dict[str, Any]:
    return aws_proxy.invoke("cognito-idp", action, params)


def _raise_proxy_error(exc: AwsProxyError, *, username: str) -> NoReturn:
    if exc.code == "UsernameExistsException":
        raise ConflictError("A user with this email already exists", field="email") from exc
    if exc.code == "AliasExistsException":
        raise ConflictError("A user with this email already exists", field="email") from exc
    if exc.code == "UserNotFoundException":
        raise NotFoundError("Cognito user", username) from exc
    logger.warning("Cognito proxy error", extra={"code": exc.code})
    raise ValidationError("Cognito request failed") from exc
