"""Tests for admin contact merge API payload parsing and dispatch."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.api import admin_contacts
from app.api.admin_contacts_merge import parse_merge_contacts_payload
from app.api.admin_request import RequestIdentity
from app.exceptions import ValidationError
from app.services.contact_merge import merge_contacts


def _build_admin_identity(admin_identity: dict[str, str]) -> RequestIdentity:
    return RequestIdentity(
        user_sub=admin_identity.get("userSub"),
        groups=set(admin_identity.get("groups", "").split(",")),
        organization_ids=set(admin_identity.get("organizationIds", "").split(",")),
    )


def test_parse_merge_contacts_payload_requires_two_ids() -> None:
    with pytest.raises(ValidationError, match="contact_ids"):
        parse_merge_contacts_payload(
            {"contact_ids": [str(uuid4())], "keeper_contact_id": str(uuid4())}
        )


def test_parse_merge_contacts_payload_requires_keeper() -> None:
    first = str(uuid4())
    second = str(uuid4())
    with pytest.raises(ValidationError, match="keeper_contact_id"):
        parse_merge_contacts_payload({"contact_ids": [first, second]})


def test_merge_contacts_requires_two_ids() -> None:
    keeper_id = uuid4()
    with pytest.raises(ValidationError, match="At least two contact_ids"):
        merge_contacts(
            MagicMock(),
            contact_ids=[keeper_id],
            keeper_contact_id=keeper_id,
            actor_sub="admin-sub",
        )


def test_merge_contacts_requires_keeper_in_ids() -> None:
    first = uuid4()
    second = uuid4()
    with pytest.raises(ValidationError, match="keeper_contact_id"):
        merge_contacts(
            MagicMock(),
            contact_ids=[first, second],
            keeper_contact_id=uuid4(),
            actor_sub="admin-sub",
        )


def test_parse_merge_contacts_payload_parses_uuids() -> None:
    first = uuid4()
    second = uuid4()
    payload = parse_merge_contacts_payload(
        {
            "contact_ids": [str(first), str(second)],
            "keeper_contact_id": str(first),
        }
    )
    assert payload["contact_ids"] == [first, second]
    assert payload["keeper_contact_id"] == first


def test_handle_admin_contacts_dispatches_merge(
    monkeypatch: Any,
    api_gateway_event: Any,
    admin_identity: dict[str, str],
) -> None:
    marker = {"statusCode": 200, "body": "{}"}
    monkeypatch.setattr(
        admin_contacts,
        "require_admin_identity",
        lambda _: _build_admin_identity(admin_identity),
    )
    monkeypatch.setattr(
        admin_contacts,
        "merge_contacts_request",
        lambda *_args, **_kwargs: marker,
    )

    response = admin_contacts.handle_admin_contacts_request(
        api_gateway_event(method="POST", path="/v1/admin/contacts/merge"),
        "POST",
        "/v1/admin/contacts/merge",
    )

    assert response is marker
