"""Unit tests for WhatsApp webhook payload ingestion helpers."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.models.enums import WhatsAppMessageDirection
from app.services import whatsapp_ingest as ingest


def test_parse_wa_phone_hong_kong() -> None:
    region, national = ingest._parse_wa_phone("85294479843")
    assert region == "HK"
    assert national == "94479843"


def test_extract_body_text_and_interactive() -> None:
    assert (
        ingest._extract_body({"type": "text", "text": {"body": "How much?"}})
        == "How much?"
    )
    assert (
        ingest._extract_body(
            {
                "type": "interactive",
                "interactive": {"button_reply": {"title": "Enroll"}},
            }
        )
        == "Enroll"
    )
    assert ingest._extract_body({"type": "image", "image": {}}) is None


def test_ingest_stores_inbound_and_creates_lead(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    lead_id = uuid4()
    added: list[object] = []

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = conversation_id
            self.wa_id = kwargs.get("wa_id")
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

        def find_message_by_wa_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_wa_id(self, _wa_id: str) -> None:
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

        def execute(self, *_a: object, **_k: object) -> SimpleNamespace:
            return SimpleNamespace(scalar_one_or_none=lambda: None)

    monkeypatch.setattr(ingest, "WhatsAppConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "WhatsAppRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "SalesLeadRepository", _FakeLeadRepo)

    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "contacts": [
                                {
                                    "wa_id": "85294479843",
                                    "profile": {"name": "Kitie"},
                                }
                            ],
                            "messages": [
                                {
                                    "from": "85294479843",
                                    "id": "wamid.ABC",
                                    "timestamp": "1710000000",
                                    "type": "text",
                                    "text": {"body": "How much?"},
                                }
                            ],
                        },
                    }
                ]
            }
        ]
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["stored"] == 1
    assert counters["leads_created"] == 1
    assert any(
        getattr(item, "direction", None) is WhatsAppMessageDirection.INBOUND
        for item in added
    )


def test_ingest_skips_duplicate_message(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_wa_message_id(self, _mid: str) -> object:
            return object()

        def get_conversation_by_wa_id(self, _wa_id: str) -> None:
            return None

    monkeypatch.setattr(ingest, "WhatsAppRepository", _FakeRepo)
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messages": [
                                {
                                    "from": "85294479843",
                                    "id": "wamid.DUP",
                                    "timestamp": "1710000000",
                                    "type": "text",
                                    "text": {"body": "Hi"},
                                }
                            ]
                        },
                    }
                ]
            }
        ]
    }
    counters = ingest.ingest_webhook_payload(object(), payload)
    assert counters["duplicates"] == 1
    assert counters["stored"] == 0


def test_ingest_stores_coexistence_echo(monkeypatch: pytest.MonkeyPatch) -> None:
    conversation_id = uuid4()
    added: list[object] = []

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = conversation_id
            self.wa_id = kwargs.get("wa_id")
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

        def find_message_by_wa_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_wa_id(self, _wa_id: str) -> None:
            return None

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> SimpleNamespace:
            return SimpleNamespace(scalar_one_or_none=lambda: None)

    monkeypatch.setattr(ingest, "WhatsAppConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "WhatsAppRepository", _FakeRepo)

    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "field": "smb_message_echoes",
                        "value": {
                            "message_echoes": [
                                {
                                    "from": "85255550000",
                                    "to": "85294479843",
                                    "id": "wamid.ECHO",
                                    "timestamp": "1710000001",
                                    "type": "text",
                                    "text": {"body": "Thanks for writing"},
                                }
                            ]
                        },
                    }
                ]
            }
        ]
    }
    counters = ingest.ingest_webhook_payload(_FakeSession(), payload)
    assert counters["stored"] == 1
    assert counters["leads_created"] == 0
    assert any(
        getattr(item, "direction", None) is WhatsAppMessageDirection.OUTBOUND
        for item in added
    )
