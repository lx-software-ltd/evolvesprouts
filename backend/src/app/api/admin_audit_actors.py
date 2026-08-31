"""Resolve audit-log actors (Cognito email or API key name)."""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping, Sequence
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.api_key import ApiKey
from app.exceptions import ValidationError
from app.services import aws_proxy
from app.services.aws_proxy import AwsProxyError

API_KEY_USER_ID_PREFIX = "api-key:"
_MAX_API_KEY_NAME_FILTER = 200


def is_api_key_user_id(user_id: str) -> bool:
    """Return True when ``user_id`` is an API-token actor."""
    return user_id.startswith(API_KEY_USER_ID_PREFIX)


def parse_api_key_id(user_id: str) -> UUID | None:
    """Parse ``api-key:<uuid>``; return None when the suffix is not a UUID."""
    if not is_api_key_user_id(user_id):
        return None
    raw = user_id[len(API_KEY_USER_ID_PREFIX) :]
    try:
        return UUID(raw)
    except ValueError:
        return None


def api_key_actor_user_id(key_id: UUID) -> str:
    """Build the ``audit_log.user_id`` value for an API token."""
    return f"{API_KEY_USER_ID_PREFIX}{key_id}"


def validate_actor_filter(raw: str) -> str:
    """Validate the ``email`` query value (Cognito email or API key name)."""
    value = raw.strip()
    if not value:
        raise ValidationError("email is required when provided", field="email")
    if '"' in value or "\\" in value:
        raise ValidationError("email contains invalid characters", field="email")
    if "@" in value:
        if len(value) > 254:
            raise ValidationError("invalid email", field="email")
        return value
    if len(value) > _MAX_API_KEY_NAME_FILTER:
        raise ValidationError("invalid email", field="email")
    return value


def cognito_sub_for_email(email: str, *, user_pool_id: str) -> str | None:
    """Resolve a Cognito email to a single ``sub``, or None when unmatched."""
    try:
        response = aws_proxy.invoke(
            "cognito-idp",
            "list_users",
            {
                "UserPoolId": user_pool_id,
                "Filter": f'email = "{email}"',
                "Limit": 1,
            },
        )
    except AwsProxyError:
        raise ValidationError("user lookup failed", field="email") from None

    users = response.get("Users") or []
    if len(users) == 0:
        return None
    if len(users) > 1:
        raise ValidationError("multiple users matched email", field="email")
    attrs = users[0].get("Attributes", [])
    sub = _cognito_attr(attrs, "sub")
    if not sub:
        raise ValidationError("user lookup failed", field="email")
    return sub


def cognito_emails_for_subs(
    subs: Sequence[str],
    *,
    user_pool_id: str,
    cache: dict[str, str] | None = None,
) -> dict[str, str]:
    """Best-effort map Cognito sub -> email for display (empty on failure)."""
    if not subs:
        return {}
    out: dict[str, str] = {}
    email_cache = cache if cache is not None else {}
    for sub in subs:
        if not sub or '"' in sub or is_api_key_user_id(sub):
            continue
        if sub in email_cache:
            out[sub] = email_cache[sub]
            continue
        try:
            response = aws_proxy.invoke(
                "cognito-idp",
                "list_users",
                {
                    "UserPoolId": user_pool_id,
                    "Filter": f'sub = "{sub}"',
                    "Limit": 1,
                },
            )
        except AwsProxyError:
            continue
        users = response.get("Users") or []
        if len(users) != 1:
            continue
        email = _cognito_attr(users[0].get("Attributes", []), "email")
        if email:
            email_cache[sub] = email
            out[sub] = email
    return out


def api_key_user_id_for_name(session: Session, name: str) -> str | None:
    """Resolve an API key display name to ``api-key:<id>``."""
    rows = (
        session.execute(
            select(ApiKey.id).where(func.lower(ApiKey.name) == name.lower())
        )
        .scalars()
        .all()
    )
    if len(rows) == 0:
        return None
    if len(rows) > 1:
        raise ValidationError("multiple API keys matched name", field="email")
    return api_key_actor_user_id(rows[0])


def api_key_names_for_user_ids(
    session: Session, user_ids: Sequence[str]
) -> dict[str, str]:
    """Map ``api-key:<id>`` actors to the stored API key ``name``."""
    id_to_user_id: dict[UUID, str] = {}
    for user_id in user_ids:
        if not user_id:
            continue
        parsed = parse_api_key_id(user_id)
        if parsed is None:
            continue
        id_to_user_id[parsed] = user_id
    if not id_to_user_id:
        return {}
    rows = session.execute(
        select(ApiKey.id, ApiKey.name).where(ApiKey.id.in_(tuple(id_to_user_id)))
    ).all()
    return {id_to_user_id[row.id]: row.name for row in rows}


def actor_labels_for_user_ids(
    session: Session,
    user_ids: Sequence[str],
    *,
    user_pool_id: str | None,
    cache: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build ``user_email`` display values for Cognito and API-key actors."""
    distinct = [user_id for user_id in dict.fromkeys(user_ids) if user_id]
    if not distinct:
        return {}
    labels: dict[str, str] = {}
    if user_pool_id:
        labels.update(
            cognito_emails_for_subs(distinct, user_pool_id=user_pool_id, cache=cache)
        )
    labels.update(api_key_names_for_user_ids(session, distinct))
    for user_id in distinct:
        if is_api_key_user_id(user_id) and user_id not in labels:
            labels[user_id] = user_id
    return labels


def _cognito_attr(attributes: Any, key: str) -> str | None:
    if not isinstance(attributes, list):
        return None
    for item in attributes:
        if not isinstance(item, Mapping):
            continue
        if item.get("Name") != key:
            continue
        value = item.get("Value")
        if isinstance(value, str):
            return value
    return None
