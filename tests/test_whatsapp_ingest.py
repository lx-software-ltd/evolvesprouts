"""Unit tests for WhatsApp webhook payload ingestion helpers."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.models.enums import FunnelStage, WhatsAppMessageDirection
from app.services import lead_funnel_automation as funnel
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
            return SimpleNamespace(id=lead_id, funnel_stage=FunnelStage.NEW)

        def get_by_id(self, _lead_id: object) -> None:
            return None

        def update(self, lead: object) -> object:
            return lead

        def add_event(self, **_k: object) -> SimpleNamespace:
            return SimpleNamespace()

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
    monkeypatch.setattr(funnel, "SalesLeadRepository", _FakeLeadRepo)

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
    lead_id = uuid4()
    added: list[object] = []
    stage_events: list[object] = []

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
            return SimpleNamespace(id=lead_id, funnel_stage=FunnelStage.NEW)

        def get_by_id(self, _lead_id: object) -> None:
            return None

        def update(self, lead: object) -> object:
            return lead

        def add_event(self, **kwargs: object) -> SimpleNamespace:
            stage_events.append(kwargs)
            return SimpleNamespace()

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> SimpleNamespace:
            return SimpleNamespace(scalar_one_or_none=lambda: None)

    monkeypatch.setattr(ingest, "WhatsAppConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "WhatsAppRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(funnel, "SalesLeadRepository", _FakeLeadRepo)

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
    assert counters["leads_created"] == 1
    assert any(
        getattr(item, "direction", None) is WhatsAppMessageDirection.OUTBOUND
        for item in added
    )
    assert stage_events[0]["to_stage"] is FunnelStage.CONTACTED


def test_ingest_history_chunk_does_not_create_leads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    added: list[object] = []

    class _FakeConversation:
        def __init__(self, **kwargs: object) -> None:
            self.id = uuid4()
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

        def find_open_by_contact(self, _cid: object) -> None:
            return None

        def create_with_event(self, *_a: object, **_k: object) -> SimpleNamespace:
            raise AssertionError("history ingest must not create leads")

    class _FakeSession:
        def add(self, obj: object) -> None:
            added.append(obj)

        def flush(self) -> None:
            return None

        def execute(self, *_a: object, **_k: object) -> SimpleNamespace:
            return SimpleNamespace(scalar_one_or_none=lambda: None)

    monkeypatch.setattr(ingest, "WhatsAppConversation", _FakeConversation)
    monkeypatch.setattr(ingest, "WhatsAppRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(funnel, "SalesLeadRepository", _FakeLeadRepo)

    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "field": "history",
                        "value": {
                            "history": [
                                {
                                    "threads": [
                                        {
                                            "id": "85294479843",
                                            "messages": [
                                                {
                                                    "from": "85294479843",
                                                    "id": "wamid.HIST",
                                                    "timestamp": "1710000000",
                                                    "type": "text",
                                                    "text": {"body": "Old hello"},
                                                }
                                            ],
                                        }
                                    ]
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
    assert counters["contacts_created"] == 1


def test_third_inbound_moves_existing_lead_to_engaged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = uuid4()
    lead_id = uuid4()
    contact_id = uuid4()
    stage_events: list[object] = []
    lead = SimpleNamespace(
        id=lead_id, funnel_stage=FunnelStage.CONTACTED, updated_at=None
    )

    class _FakeConversation:
        def __init__(self) -> None:
            self.id = conversation_id
            self.wa_id = "85294479843"
            self.profile_name = "Kitie"
            self.contact_id = contact_id
            self.lead_id = lead_id
            self.inbound_count = 2
            self.outbound_count = 1
            self.first_inbound_at = None
            self.last_message_at = None
            self.updated_at = None

    conversation = _FakeConversation()

    class _FakeRepo:
        def __init__(self, _session: object) -> None:
            pass

        def find_message_by_wa_message_id(self, _mid: str) -> None:
            return None

        def get_conversation_by_wa_id(self, _wa_id: str) -> _FakeConversation:
            return conversation

    class _FakeLeadRepo:
        def __init__(self, _session: object) -> None:
            pass

        def get_by_id(self, _lead_id: object) -> SimpleNamespace:
            return lead

        def update(self, updated: object) -> object:
            return updated

        def add_event(self, **kwargs: object) -> SimpleNamespace:
            stage_events.append(kwargs)
            return SimpleNamespace()

    class _FakeSession:
        def add(self, _obj: object) -> None:
            return None

        def flush(self) -> None:
            return None

    monkeypatch.setattr(ingest, "WhatsAppRepository", _FakeRepo)
    monkeypatch.setattr(ingest, "SalesLeadRepository", _FakeLeadRepo)
    monkeypatch.setattr(funnel, "SalesLeadRepository", _FakeLeadRepo)

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
                                    "id": "wamid.THIRD",
                                    "timestamp": "1710000003",
                                    "type": "text",
                                    "text": {"body": "Third inbound"},
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
    assert lead.funnel_stage is FunnelStage.ENGAGED
    assert stage_events[0]["to_stage"] is FunnelStage.ENGAGED
