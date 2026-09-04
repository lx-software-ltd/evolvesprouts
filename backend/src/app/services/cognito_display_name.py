"""Resolve a Cognito user's display name for insight copy."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

from app.db.audit import SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID
from app.services import aws_proxy
from app.services.aws_proxy import AwsProxyError
from app.services.sales_assignment import read_sales_settings_values
from app.utils.logging import get_logger

logger = get_logger(__name__)

SCHEDULED_DISPLAY_NAME = "scheduled"


def display_name_from_cognito_attributes(attributes: Any) -> str | None:
    """Prefer ``name``, then ``given_name``, then the email local-part."""
    name = _attr(attributes, "name")
    if name:
        return name
    given = _attr(attributes, "given_name")
    if given:
        return given
    email = _attr(attributes, "email")
    if email and "@" in email:
        local = email.split("@", 1)[0].strip()
        return local or None
    return email


def cognito_display_name_for_sub(sub: str | None) -> str | None:
    """Best-effort Cognito display name for one ``sub``."""
    trimmed = (sub or "").strip()
    if not trimmed:
        return None
    user_pool_id = os.getenv("COGNITO_USER_POOL_ID", "").strip()
    if not user_pool_id or '"' in trimmed:
        return None
    try:
        response = aws_proxy.invoke(
            "cognito-idp",
            "list_users",
            {
                "UserPoolId": user_pool_id,
                "Filter": f'sub = "{trimmed}"',
                "Limit": 1,
            },
        )
    except AwsProxyError:
        logger.info("Cognito display-name lookup failed", extra={"has_sub": True})
        return None
    users = response.get("Users") or []
    if len(users) != 1:
        return None
    return display_name_from_cognito_attributes(users[0].get("Attributes", []))


def resolve_insight_generated_by_name(session: Any, *, actor_sub: str | None) -> str:
    """Name used in the insight prompt and card.

    Scheduled runs use Sales config ``default_assigned_to`` (the default
    assignee). Manual runs use the logged-in Cognito user. Falls back to
    ``scheduled`` when no name can be resolved.
    """
    trimmed = (actor_sub or "").strip()
    if trimmed == SALES_DAILY_PLAN_SCHEDULE_AUDIT_USER_ID:
        default_sub, _notify = read_sales_settings_values(session)
        name = cognito_display_name_for_sub(default_sub)
        return name or SCHEDULED_DISPLAY_NAME
    name = cognito_display_name_for_sub(trimmed)
    return name or SCHEDULED_DISPLAY_NAME


def _attr(attributes: Any, key: str) -> str | None:
    if not isinstance(attributes, list):
        return None
    for item in attributes:
        if not isinstance(item, Mapping):
            continue
        if item.get("Name") != key:
            continue
        value = item.get("Value")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None
