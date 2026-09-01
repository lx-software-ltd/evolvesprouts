"""Unit tests for Messenger and Instagram webhook payload ingestion."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.models import Contact
from app.db.models.enums import MetaChannel, MetaMessageDirection
from app.services import meta_ingest as ingest
from app.utils.validators import (
    instagram_handle_from_profile_url,
    parse_instagram_username,
)


def _contact_repo(
    *,
    found: object | None = None,
    linked: object | None = None,
) -> type:
    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_by_instagram_handle(self, _handle: str) -> object | None:
            return found

        def get_by_id(self, _contact_id: object) -> object | None:
            return linked

    return _FakeContactRepo


def test_parse_timestamp_seconds_and_milliseconds() -> None:
    seconds = ingest._parse_timestamp("1710000000")
    millis = ingest._parse_timestamp("1710000000000")
    assert seconds is not None
    assert millis is not None
    assert seconds == millis


def test_extract_body_text_and_attachment_caption() -> None:
    assert ingest._extract_body({"text": "How much?"}) == "How much?"
    assert (
        ingest._extract_body(
            {"attachments": [{"type": "image", "payload": {"title": "Look at this"}}]}
        )
        == "Look at this"
    )
    assert ingest._extract_body({"attachments": [{"type": "audio"}]}) == "[audio]"


def test_ingest_skips_whatsapp_object() -> None:
    counters = ingest.ingest_webhook_payload(
        SimpleNamespace(),
        {"object": "whatsapp_business_account", "entry": [{}]},
    )
    assert counters["stored"] == 0
    assert counters["duplicates"] == 0
    assert counters["skipped"] == 0
    assert counters["leads_created"] == 0


def test_ingest_stores_inbound_instagram_and_creates_lead(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    lead_id = uuid4()
    added: list[object] = []

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = conversation_id
            self.channel = kwargs.get("channel")
            self.platform_user_id = kwargs.get("platform_user_id")
            self.page_id = kwargs.get("page_id")
            self.profile_name = kwargs.get("profile_name")
            self.contact_id = None
            self.lead_id = None
            self.inbound_count = 0
            self.outbound_count = 0
            self.first_inbound_at = None
            self.last_message_at = None
            self.updated_at = None

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_platform_user(self, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_open_by_contact(self, _contact_id: object) -> None:
            return None

        def create_with_event(self, *_a: object, **_k: object) -> SimpleNamespace:
            return SimpleNamespace(id=lead_id)

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            for obj in added:
                if getattr(obj, "id", "missing") is None:
                    setattr(obj, "id", uuid4())

    monkeypatch.setattr(ingest, "MetaConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(ingest, "ContactRepository", _contact_repo())

    payload = {
        "object": "instagram",
        "entry": [
            {
                "id": "17841400000000000",
                "messaging": [
                    {
                        "sender": {"id": "igsid-user-1", "username": "@Kitie.W"},
                        "recipient": {"id": "17841400000000000"},
                        "timestamp": 1710000000000,
                        "message": {"mid": "m_abc", "text": "How much?"},
                    }
                ],
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["stored"] == 1
    assert counters["leads_created"] == 1
    conversation = next(
        item
        for item in added
        if getattr(item, "platform_user_id", None) == "igsid-user-1"
    )
    assert conversation.channel is MetaChannel.INSTAGRAM
    assert conversation.profile_name == "@Kitie.W"
    contact = next(item for item in added if isinstance(item, Contact))
    assert contact.instagram_handle == "kitie.w"
    assert not contact.instagram_handle.startswith("@")
    assert any(
        getattr(item, "direction", None) is MetaMessageDirection.INBOUND
        for item in added
    )


def test_ingest_stores_messenger_echo_as_outbound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    added: list[object] = []

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = conversation_id
            self.channel = kwargs.get("channel")
            self.platform_user_id = kwargs.get("platform_user_id")
            self.page_id = kwargs.get("page_id")
            self.profile_name = kwargs.get("profile_name")
            self.contact_id = None
            self.lead_id = None
            self.inbound_count = 0
            self.outbound_count = 0
            self.first_inbound_at = None
            self.last_message_at = None
            self.updated_at = None

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_platform_user(self, **_k: object) -> None:
            return None

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            return None

    monkeypatch.setattr(ingest, "MetaConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)

    payload = {
        "object": "page",
        "entry": [
            {
                "id": "page-1",
                "messaging": [
                    {
                        "sender": {"id": "page-1"},
                        "recipient": {"id": "psid-user-1"},
                        "timestamp": 1710000000,
                        "message": {
                            "mid": "m_echo",
                            "text": "Thanks",
                            "is_echo": True,
                        },
                    }
                ],
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["stored"] == 1
    assert counters["leads_created"] == 0
    conversation = next(
        item
        for item in added
        if getattr(item, "platform_user_id", None) == "psid-user-1"
    )
    assert conversation.channel is MetaChannel.FACEBOOK
    assert any(
        getattr(item, "direction", None) is MetaMessageDirection.OUTBOUND
        for item in added
    )


def test_ingest_skips_duplicate_message(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> object:
            return object()

        def get_conversation_by_platform_user(self, **_k: object) -> None:
            return None

    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)
    payload = {
        "object": "page",
        "entry": [
            {
                "messaging": [
                    {
                        "sender": {"id": "psid-1"},
                        "recipient": {"id": "page-1"},
                        "timestamp": 1710000000,
                        "message": {"mid": "m_dup", "text": "Hi"},
                    }
                ]
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(SimpleNamespace(), payload)
    assert counters["duplicates"] == 1
    assert counters["stored"] == 0


def test_instagram_handle_from_profile_url() -> None:
    assert (
        instagram_handle_from_profile_url("https://www.instagram.com/evolvesprouts")
        == "evolvesprouts"
    )
    assert (
        instagram_handle_from_profile_url(
            "https://www.instagram.com/EvolveSprouts/?hl=en"
        )
        == "evolvesprouts"
    )
    assert instagram_handle_from_profile_url("@evolvesprouts") == "evolvesprouts"
    assert instagram_handle_from_profile_url("instagram.com/evolvesprouts") == (
        "evolvesprouts"
    )
    assert instagram_handle_from_profile_url("https://www.instagram.com/p/abc") is (
        None
    )
    assert instagram_handle_from_profile_url("") is None


def test_ingest_skips_own_instagram_handle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> None:
            raise AssertionError("own Instagram handle must not persist")

        def get_conversation_by_platform_user(self, **_k: object) -> None:
            raise AssertionError("own Instagram handle must not persist")

    monkeypatch.setenv(
        "NEXT_PUBLIC_INSTAGRAM_URL", "https://www.instagram.com/evolvesprouts"
    )
    monkeypatch.delenv("PUBLIC_WWW_INSTAGRAM_URL", raising=False)
    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)

    payload = {
        "object": "instagram",
        "entry": [
            {
                "id": "17841400000000000",
                "messaging": [
                    {
                        "sender": {"id": "igsid-self", "username": "EvolveSprouts"},
                        "recipient": {"id": "17841400000000000"},
                        "timestamp": 1710000000000,
                        "message": {"mid": "m_self", "text": "Note to self"},
                    }
                ],
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(SimpleNamespace(), payload)
    assert counters["skipped"] == 1
    assert counters["stored"] == 0
    assert counters["leads_created"] == 0


def test_ingest_keeps_customer_instagram_when_own_handle_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    added: list[object] = []

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = conversation_id
            self.channel = kwargs.get("channel")
            self.platform_user_id = kwargs.get("platform_user_id")
            self.page_id = kwargs.get("page_id")
            self.profile_name = kwargs.get("profile_name")
            self.contact_id = None
            self.lead_id = None
            self.inbound_count = 0
            self.outbound_count = 0
            self.first_inbound_at = None
            self.last_message_at = None
            self.updated_at = None

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_platform_user(self, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_open_by_contact(self, _contact_id: object) -> None:
            return None

        def create_with_event(self, *_a: object, **_k: object) -> SimpleNamespace:
            return SimpleNamespace(id=uuid4())

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            for obj in added:
                if getattr(obj, "id", "missing") is None:
                    setattr(obj, "id", uuid4())

    monkeypatch.setenv(
        "PUBLIC_WWW_INSTAGRAM_URL", "https://www.instagram.com/evolvesprouts"
    )
    monkeypatch.setattr(ingest, "MetaConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(ingest, "ContactRepository", _contact_repo())

    payload = {
        "object": "instagram",
        "entry": [
            {
                "id": "17841400000000000",
                "messaging": [
                    {
                        "sender": {"id": "igsid-user-1", "username": "kitie.w"},
                        "recipient": {"id": "17841400000000000"},
                        "timestamp": 1710000000000,
                        "message": {"mid": "m_customer", "text": "How much?"},
                    }
                ],
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["stored"] == 1
    conversation = next(
        item
        for item in added
        if getattr(item, "platform_user_id", None) == "igsid-user-1"
    )
    assert conversation.profile_name == "kitie.w"


def test_ingest_echo_does_not_use_business_handle_as_chat_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    added: list[object] = []

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = conversation_id
            self.channel = kwargs.get("channel")
            self.platform_user_id = kwargs.get("platform_user_id")
            self.page_id = kwargs.get("page_id")
            self.profile_name = kwargs.get("profile_name")
            self.contact_id = None
            self.lead_id = None
            self.inbound_count = 0
            self.outbound_count = 0
            self.first_inbound_at = None
            self.last_message_at = None
            self.updated_at = None

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_platform_user(self, **_k: object) -> None:
            return None

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            return None

    monkeypatch.setenv(
        "NEXT_PUBLIC_INSTAGRAM_URL", "https://www.instagram.com/evolvesprouts"
    )
    monkeypatch.setattr(ingest, "MetaConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)

    payload = {
        "object": "instagram",
        "entry": [
            {
                "id": "17841400000000000",
                "messaging": [
                    {
                        "sender": {
                            "id": "17841400000000000",
                            "username": "evolvesprouts",
                        },
                        "recipient": {"id": "igsid-user-1", "username": "kitie.w"},
                        "timestamp": 1710000000,
                        "message": {
                            "mid": "m_echo",
                            "text": "Thanks",
                            "is_echo": True,
                        },
                    }
                ],
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["stored"] == 1
    conversation = next(
        item
        for item in added
        if getattr(item, "platform_user_id", None) == "igsid-user-1"
    )
    assert conversation.profile_name == "kitie.w"


def test_contact_first_name_never_uses_last_four() -> None:
    conversation = SimpleNamespace(
        channel=MetaChannel.INSTAGRAM,
        profile_name=None,
        platform_user_id="1234567890",
    )
    assert ingest._contact_first_name(conversation) == "Instagram contact"
    named = SimpleNamespace(
        channel=MetaChannel.FACEBOOK,
        profile_name="Kitie",
        platform_user_id="1234567890",
    )
    assert ingest._contact_first_name(named) == "Kitie"


def test_parse_instagram_username_rejects_igsid_and_display_names() -> None:
    assert parse_instagram_username("@Kitie.W") == "kitie.w"
    assert parse_instagram_username("Feier Wang") is None
    assert (
        parse_instagram_username(
            "17841400000000000", platform_user_id="17841400000000000"
        )
        is None
    )
    assert parse_instagram_username("instagram user") is None
    assert parse_instagram_username("17841400000000001") is None


def test_ingest_reuses_contact_matching_instagram_handle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    existing_id = uuid4()
    lead_id = uuid4()
    added: list[object] = []
    existing = SimpleNamespace(id=existing_id, instagram_handle="kitie.w")

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = conversation_id
            self.channel = kwargs.get("channel")
            self.platform_user_id = kwargs.get("platform_user_id")
            self.page_id = kwargs.get("page_id")
            self.profile_name = kwargs.get("profile_name")
            self.contact_id = None
            self.lead_id = None
            self.inbound_count = 0
            self.outbound_count = 0
            self.first_inbound_at = None
            self.last_message_at = None
            self.updated_at = None

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_platform_user(self, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_open_by_contact(self, _contact_id: object) -> None:
            return None

        def create_with_event(self, *_a: object, **_k: object) -> SimpleNamespace:
            return SimpleNamespace(id=lead_id)

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            for obj in added:
                if getattr(obj, "id", "missing") is None:
                    setattr(obj, "id", uuid4())

    monkeypatch.setattr(ingest, "MetaConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(ingest, "ContactRepository", _contact_repo(found=existing))

    payload = {
        "object": "instagram",
        "entry": [
            {
                "id": "17841400000000000",
                "messaging": [
                    {
                        "sender": {"id": "igsid-user-2", "username": "kitie.w"},
                        "recipient": {"id": "17841400000000000"},
                        "timestamp": 1710000000000,
                        "message": {"mid": "m_reuse", "text": "Hi again"},
                    }
                ],
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["stored"] == 1
    assert counters["contacts_created"] == 0
    conversation = next(
        item
        for item in added
        if getattr(item, "platform_user_id", None) == "igsid-user-2"
    )
    assert conversation.contact_id == existing_id
    assert not any(isinstance(item, Contact) for item in added)


def test_ingest_reuses_archived_contact_matching_instagram_handle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    existing_id = uuid4()
    added: list[object] = []
    existing = SimpleNamespace(
        id=existing_id,
        instagram_handle="kitie.w",
        archived_at="2026-01-01T00:00:00+00:00",
    )

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = conversation_id
            self.channel = kwargs.get("channel")
            self.platform_user_id = kwargs.get("platform_user_id")
            self.page_id = kwargs.get("page_id")
            self.profile_name = kwargs.get("profile_name")
            self.contact_id = None
            self.lead_id = None
            self.inbound_count = 0
            self.outbound_count = 0
            self.first_inbound_at = None
            self.last_message_at = None
            self.updated_at = None

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_platform_user(self, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_open_by_contact(self, _contact_id: object) -> None:
            return None

        def create_with_event(self, *_a: object, **_k: object) -> SimpleNamespace:
            return SimpleNamespace(id=uuid4())

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            for obj in added:
                if getattr(obj, "id", "missing") is None:
                    setattr(obj, "id", uuid4())

    monkeypatch.setattr(ingest, "MetaConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(ingest, "ContactRepository", _contact_repo(found=existing))

    payload = {
        "object": "instagram",
        "entry": [
            {
                "id": "17841400000000000",
                "messaging": [
                    {
                        "sender": {"id": "igsid-archived", "username": "kitie.w"},
                        "recipient": {"id": "17841400000000000"},
                        "timestamp": 1710000000000,
                        "message": {"mid": "m_archived", "text": "Hi"},
                    }
                ],
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["contacts_created"] == 0
    conversation = next(
        item
        for item in added
        if getattr(item, "platform_user_id", None) == "igsid-archived"
    )
    assert conversation.contact_id == existing_id


def test_ingest_fills_instagram_handle_on_existing_contact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    contact_id = uuid4()
    linked = SimpleNamespace(id=contact_id, instagram_handle=None)
    existing_conversation = SimpleNamespace(
        id=conversation_id,
        channel=MetaChannel.INSTAGRAM,
        platform_user_id="igsid-user-3",
        page_id="17841400000000000",
        profile_name="kitie.w",
        contact_id=contact_id,
        lead_id=uuid4(),
        inbound_count=1,
        outbound_count=0,
        first_inbound_at=None,
        last_message_at=None,
        updated_at=None,
    )

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_platform_user(self, **_k: object) -> object:
            return existing_conversation

    class _FakeSession:
        def add(self, obj: object) -> None:
            return None

        def flush(self) -> None:
            return None

    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "ContactRepository", _contact_repo(linked=linked))

    payload = {
        "object": "instagram",
        "entry": [
            {
                "id": "17841400000000000",
                "messaging": [
                    {
                        "sender": {"id": "igsid-user-3", "username": "kitie.w"},
                        "recipient": {"id": "17841400000000000"},
                        "timestamp": 1710000001000,
                        "message": {"mid": "m_fill", "text": "Hello"},
                    }
                ],
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["stored"] == 1
    assert linked.instagram_handle == "kitie.w"


def test_ingest_facebook_contact_has_no_instagram_handle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    lead_id = uuid4()
    added: list[object] = []

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = conversation_id
            self.channel = kwargs.get("channel")
            self.platform_user_id = kwargs.get("platform_user_id")
            self.page_id = kwargs.get("page_id")
            self.profile_name = kwargs.get("profile_name")
            self.contact_id = None
            self.lead_id = None
            self.inbound_count = 0
            self.outbound_count = 0
            self.first_inbound_at = None
            self.last_message_at = None
            self.updated_at = None

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_platform_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_platform_user(self, **_k: object) -> None:
            return None

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_open_by_contact(self, _contact_id: object) -> None:
            return None

        def create_with_event(self, *_a: object, **_k: object) -> SimpleNamespace:
            return SimpleNamespace(id=lead_id)

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            for obj in added:
                if getattr(obj, "id", "missing") is None:
                    setattr(obj, "id", uuid4())

    monkeypatch.setattr(ingest, "MetaConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "MetaRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "SalesLeadRepository", _FakeLeadRepo)

    payload = {
        "object": "page",
        "entry": [
            {
                "id": "page-1",
                "messaging": [
                    {
                        "sender": {"id": "psid-user-2", "name": "Jane Doe"},
                        "recipient": {"id": "page-1"},
                        "timestamp": 1710000000,
                        "message": {"mid": "m_fb", "text": "Hi"},
                    }
                ],
            }
        ],
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["stored"] == 1
    contact = next(item for item in added if isinstance(item, Contact))
    assert contact.instagram_handle is None
    assert contact.source.value == "facebook"


def test_find_or_create_reuses_contact_after_unique_handle_race(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import IntegrityError

    existing = SimpleNamespace(id=uuid4(), instagram_handle="kitie.w")
    lookups = {"count": 0}

    class _FakeContactRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_by_instagram_handle(self, _handle: str) -> object | None:
            lookups["count"] += 1
            if lookups["count"] == 1:
                return None
            return existing

    class _Nested:
        def __enter__(self) -> object:
            return self

        def __exit__(self, *_a: object) -> bool:
            return False

    class _FakeSession:
        def add(self, obj: object) -> None:
            self.added = obj

        def begin_nested(self) -> _Nested:
            return _Nested()

        def flush(self) -> None:
            raise IntegrityError("INSERT", {}, Exception("unique"))

        def expunge(self, obj: object) -> None:
            self.expunged = obj

    monkeypatch.setattr(ingest, "ContactRepository", _FakeContactRepo)
    session = _FakeSession()
    contact, created = ingest._find_or_create_contact(
        session,  # type: ignore[arg-type]
        conversation=SimpleNamespace(
            channel=MetaChannel.INSTAGRAM,
            profile_name="kitie.w",
        ),
        instagram_handle="kitie.w",
    )
    assert created is False
    assert contact is existing
    assert lookups["count"] == 2
    assert getattr(session, "expunged", None) is not None
