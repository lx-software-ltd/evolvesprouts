"""Tests for converting leads when an invoice becomes fully paid."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from app.db.models.enums import FunnelStage, LeadEventType
from app.services.lead_invoice_convert import (
    INVOICE_PAID_ACTOR,
    _contact_ids_for_invoice,
    convert_leads_for_paid_invoice,
)


class _FakeRepository:
    def __init__(self, leads: dict[object, SimpleNamespace]) -> None:
        self.leads = leads
        self.updated: list[SimpleNamespace] = []
        self.events: list[dict[str, object]] = []

    def find_reusable_by_contact(self, contact_id: object) -> SimpleNamespace | None:
        return self.leads.get(contact_id)

    def update(self, lead: SimpleNamespace) -> None:
        self.updated.append(lead)

    def add_event(self, **kwargs: object) -> None:
        self.events.append(kwargs)


def _lead(*, stage: FunnelStage) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        funnel_stage=stage,
        converted_at=None,
        lost_at=None if stage != FunnelStage.LOST else "lost",
        lost_reason="other" if stage == FunnelStage.LOST else None,
        updated_at=None,
    )


def test_convert_open_and_lost_leads_skips_converted(monkeypatch: object) -> None:
    open_contact = uuid4()
    lost_contact = uuid4()
    converted_contact = uuid4()
    open_lead = _lead(stage=FunnelStage.ENGAGED)
    lost_lead = _lead(stage=FunnelStage.LOST)
    converted_lead = _lead(stage=FunnelStage.CONVERTED)
    repo = _FakeRepository(
        {
            open_contact: open_lead,
            lost_contact: lost_lead,
            converted_contact: converted_lead,
        }
    )
    monkeypatch.setattr(
        "app.services.lead_invoice_convert.SalesLeadRepository",
        lambda _session: repo,
    )
    invoice = SimpleNamespace(
        id=uuid4(),
        bill_to_contact_id=open_contact,
        bill_to_family_id=None,
        bill_to_organization_id=None,
        lines=[SimpleNamespace(enrollment_id=None)],
    )
    monkeypatch.setattr(
        "app.services.lead_invoice_convert._contact_ids_for_invoice",
        lambda _session, _invoice: [open_contact, lost_contact, converted_contact],
    )

    converted_ids = convert_leads_for_paid_invoice(SimpleNamespace(), invoice)  # type: ignore[arg-type]

    assert set(converted_ids) == {open_lead.id, lost_lead.id}
    assert open_lead.funnel_stage == FunnelStage.CONVERTED
    assert lost_lead.funnel_stage == FunnelStage.CONVERTED
    assert lost_lead.lost_at is None
    assert lost_lead.lost_reason is None
    assert converted_lead.funnel_stage == FunnelStage.CONVERTED
    assert [event["event_type"] for event in repo.events] == [
        LeadEventType.STAGE_CHANGED,
        LeadEventType.STAGE_CHANGED,
    ]
    assert all(event["created_by"] == INVOICE_PAID_ACTOR for event in repo.events)
    assert all(event["to_stage"] == FunnelStage.CONVERTED for event in repo.events)


def test_convert_skips_when_no_lead(monkeypatch: object) -> None:
    contact_id = uuid4()
    repo = _FakeRepository({})
    monkeypatch.setattr(
        "app.services.lead_invoice_convert.SalesLeadRepository",
        lambda _session: repo,
    )
    monkeypatch.setattr(
        "app.services.lead_invoice_convert._contact_ids_for_invoice",
        lambda _session, _invoice: [contact_id],
    )
    invoice = SimpleNamespace(id=uuid4())
    assert convert_leads_for_paid_invoice(SimpleNamespace(), invoice) == []  # type: ignore[arg-type]
    assert repo.events == []


def test_contact_ids_include_primary_and_enrollment_contacts() -> None:
    family_id = uuid4()
    primary_id = uuid4()
    enrollment_contact_id = uuid4()
    enrollment_id = uuid4()
    invoice = SimpleNamespace(
        id=uuid4(),
        bill_to_contact_id=None,
        bill_to_family_id=family_id,
        bill_to_organization_id=None,
        lines=[SimpleNamespace(enrollment_id=enrollment_id)],
    )

    class _Session:
        def __init__(self) -> None:
            self.calls = 0

        def scalars(self, _statement: object) -> list[object]:
            self.calls += 1
            if self.calls == 1:
                return [primary_id]
            return [enrollment_contact_id]

    ids = _contact_ids_for_invoice(_Session(), invoice)  # type: ignore[arg-type]
    assert ids == [primary_id, enrollment_contact_id]
