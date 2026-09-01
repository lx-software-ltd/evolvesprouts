"""Unit tests for messaging webhook funnel-stage automation."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from app.db.models.enums import FunnelStage, LeadEventType
from app.services.lead_funnel_automation import maybe_advance_lead_funnel


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
