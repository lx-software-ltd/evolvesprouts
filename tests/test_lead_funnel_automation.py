"""Unit tests for messaging webhook funnel-stage automation."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from app.db.models.enums import FunnelStage, LeadEventType, LeadType
from app.services.lead_funnel_automation import (
    ensure_contact_lead,
    link_conversation_lead_and_advance,
    maybe_advance_lead_funnel,
    reopen_closed_lead,
)


class _FakeLeadRepo:
    def __init__(self, _session: object) -> None:
        self.events: list[object] = []

    def get_by_id(self, lead_id: object) -> None:
        return None

    def update(self, lead: object) -> object:
        return lead

    def add_event(self, **kwargs: object) -> SimpleNamespace:
        self.events.append(kwargs)
        return SimpleNamespace()


def test_first_outbound_moves_new_lead_to_contacted(monkeypatch) -> None:
    repo = _FakeLeadRepo(object())
    monkeypatch.setattr(
        "app.services.lead_funnel_automation.SalesLeadRepository",
        lambda _session: repo,
    )
    lead = SimpleNamespace(id=uuid4(), funnel_stage=FunnelStage.NEW, updated_at=None)

    result = maybe_advance_lead_funnel(
        object(),
        lead=lead,
        is_outbound=True,
        inbound_count=0,
        outbound_count=1,
    )

    assert result is FunnelStage.CONTACTED
    assert lead.funnel_stage is FunnelStage.CONTACTED
    assert repo.events[0]["event_type"] is LeadEventType.STAGE_CHANGED
    assert repo.events[0]["from_stage"] is FunnelStage.NEW
    assert repo.events[0]["to_stage"] is FunnelStage.CONTACTED


def test_third_inbound_moves_contacted_lead_to_engaged(monkeypatch) -> None:
    repo = _FakeLeadRepo(object())
    monkeypatch.setattr(
        "app.services.lead_funnel_automation.SalesLeadRepository",
        lambda _session: repo,
    )
    lead = SimpleNamespace(
        id=uuid4(), funnel_stage=FunnelStage.CONTACTED, updated_at=None
    )

    result = maybe_advance_lead_funnel(
        object(),
        lead=lead,
        is_outbound=False,
        inbound_count=3,
        outbound_count=1,
    )

    assert result is FunnelStage.ENGAGED
    assert lead.funnel_stage is FunnelStage.ENGAGED
    assert repo.events[0]["to_stage"] is FunnelStage.ENGAGED


def test_does_not_move_qualified_or_later_leads(monkeypatch) -> None:
    repo = _FakeLeadRepo(object())
    monkeypatch.setattr(
        "app.services.lead_funnel_automation.SalesLeadRepository",
        lambda _session: repo,
    )
    lead = SimpleNamespace(
        id=uuid4(), funnel_stage=FunnelStage.QUALIFIED, updated_at=None
    )

    result = maybe_advance_lead_funnel(
        object(),
        lead=lead,
        is_outbound=True,
        inbound_count=5,
        outbound_count=1,
    )

    assert result is None
    assert lead.funnel_stage is FunnelStage.QUALIFIED
    assert repo.events == []


def test_second_outbound_does_not_change_contacted_lead(monkeypatch) -> None:
    repo = _FakeLeadRepo(object())
    monkeypatch.setattr(
        "app.services.lead_funnel_automation.SalesLeadRepository",
        lambda _session: repo,
    )
    lead = SimpleNamespace(
        id=uuid4(), funnel_stage=FunnelStage.CONTACTED, updated_at=None
    )

    result = maybe_advance_lead_funnel(
        object(),
        lead=lead,
        is_outbound=True,
        inbound_count=1,
        outbound_count=2,
    )

    assert result is None
    assert lead.funnel_stage is FunnelStage.CONTACTED


def test_link_creates_lead_with_default_assignee(monkeypatch) -> None:
    created: list[object] = []
    assignment_events: list[object] = []
    notifications: list[object] = []
    lead_id = uuid4()

    class _CreateRepo(_FakeLeadRepo):
        def find_open_by_contact(self, _contact_id: object) -> None:
            return None

        def create_with_event(
            self, lead: object, *_a: object, **_k: object
        ) -> SimpleNamespace:
            created.append(lead)
            return SimpleNamespace(
                id=lead_id,
                assigned_to=getattr(lead, "assigned_to", None),
                funnel_stage=FunnelStage.NEW,
            )

    repo = _CreateRepo(object())
    monkeypatch.setattr(
        "app.services.lead_funnel_automation.SalesLeadRepository",
        lambda _session: repo,
    )
    monkeypatch.setattr(
        "app.services.lead_funnel_automation.resolve_create_assignee",
        lambda _session: "user-default",
    )
    monkeypatch.setattr(
        "app.services.lead_funnel_automation.record_new_lead_assignment_event",
        lambda *_a, **kwargs: assignment_events.append(kwargs),
    )
    monkeypatch.setattr(
        "app.services.lead_funnel_automation.notify_lead_assignee",
        lambda *_a, **kwargs: notifications.append(kwargs),
    )

    conversation = SimpleNamespace(
        id=uuid4(),
        contact_id=uuid4(),
        lead_id=None,
        inbound_count=0,
        outbound_count=0,
    )
    counters = {"leads_created": 0}
    link_conversation_lead_and_advance(
        object(),
        conversation=conversation,
        channel="whatsapp",
        counters=counters,
        create_leads=True,
        is_outbound=False,
    )

    assert counters["leads_created"] == 1
    assert getattr(created[0], "assigned_to", None) == "user-default"
    assert assignment_events[0]["assigned_to"] == "user-default"
    assert notifications[0]["previous"] is None
    assert conversation.lead_id == lead_id


def test_ensure_reuses_open_lead_and_records_action(monkeypatch) -> None:
    events: list[object] = []
    existing = SimpleNamespace(
        id=uuid4(),
        lead_type=LeadType.FREE_GUIDE,
        funnel_stage=FunnelStage.CONTACTED,
        asset_id=None,
        updated_at=None,
    )

    class _Repo(_FakeLeadRepo):
        def find_reusable_by_contact(self, _contact_id: object) -> SimpleNamespace:
            return existing

        def add_event(self, **kwargs: object) -> SimpleNamespace:
            events.append(kwargs)
            return SimpleNamespace()

    monkeypatch.setattr(
        "app.services.lead_funnel_automation.SalesLeadRepository",
        lambda _session: _Repo(object()),
    )

    lead, created = ensure_contact_lead(
        object(),
        contact_id=uuid4(),
        lead_type=LeadType.PROGRAM_ENROLLMENT,
        metadata={"signup_intent": "contact_inquiry"},
    )

    assert created is False
    assert lead is existing
    assert existing.lead_type is LeadType.PROGRAM_ENROLLMENT
    assert events[0]["event_type"] is LeadEventType.ACTION_RECORDED


def test_ensure_reopens_converted_lead(monkeypatch) -> None:
    events: list[object] = []
    existing = SimpleNamespace(
        id=uuid4(),
        lead_type=LeadType.OTHER,
        funnel_stage=FunnelStage.CONVERTED,
        converted_at="2026-01-01T00:00:00Z",
        lost_at=None,
        lost_reason=None,
        asset_id=None,
        updated_at=None,
    )

    class _Repo(_FakeLeadRepo):
        def find_reusable_by_contact(self, _contact_id: object) -> SimpleNamespace:
            return existing

        def add_event(self, **kwargs: object) -> SimpleNamespace:
            events.append(kwargs)
            return SimpleNamespace()

    monkeypatch.setattr(
        "app.services.lead_funnel_automation.SalesLeadRepository",
        lambda _session: _Repo(object()),
    )

    lead, created = ensure_contact_lead(
        object(),
        contact_id=uuid4(),
        lead_type=LeadType.CONSULTATION,
        metadata={"channel": "whatsapp"},
    )

    assert created is False
    assert lead is existing
    assert existing.funnel_stage is FunnelStage.NEW
    assert existing.converted_at is None
    assert [event["event_type"] for event in events] == [
        LeadEventType.STAGE_CHANGED,
        LeadEventType.ACTION_RECORDED,
    ]
    assert events[0]["to_stage"] is FunnelStage.NEW


def test_reopen_closed_lead_ignores_open_stage() -> None:
    repo = _FakeLeadRepo(object())
    lead = SimpleNamespace(
        id=uuid4(),
        funnel_stage=FunnelStage.ENGAGED,
        converted_at=None,
        lost_at=None,
        lost_reason=None,
        updated_at=None,
    )
    assert reopen_closed_lead(repo, lead) is False
    assert lead.funnel_stage is FunnelStage.ENGAGED
