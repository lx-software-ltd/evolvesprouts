"""Advance sales-lead funnel stages from live messaging webhooks."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models.enums import FunnelStage, LeadEventType, LeadType
from app.db.models.sales_lead import SalesLead
from app.db.repositories.sales_lead import SalesLeadRepository

_SYSTEM_ACTOR = "system"


class ConversationLeadLink(Protocol):
    """Minimal conversation fields needed to attach and advance a sales lead."""

    contact_id: UUID | None
    lead_id: UUID | None
    inbound_count: int | None
    outbound_count: int | None
    id: UUID
_RANK = {
    FunnelStage.NEW: 0,
    FunnelStage.CONTACTED: 1,
    FunnelStage.ENGAGED: 2,
}


def maybe_advance_lead_funnel(
    session: Session,
    *,
    lead: SalesLead | None = None,
    lead_id: UUID | None = None,
    is_outbound: bool,
    inbound_count: int,
    outbound_count: int,
    created_by: str = _SYSTEM_ACTOR,
) -> FunnelStage | None:
    """Move an open lead forward on first outbound or third inbound message."""
    repository = SalesLeadRepository(session)
    resolved = lead
    if resolved is None and lead_id is not None:
        resolved = repository.get_by_id(lead_id)
    if resolved is None:
        return None

    current = getattr(resolved, "funnel_stage", None)
    if current not in (FunnelStage.NEW, FunnelStage.CONTACTED):
        return None

    target: FunnelStage | None = None
    if is_outbound and outbound_count == 1:
        target = FunnelStage.CONTACTED
    if not is_outbound and inbound_count >= 3:
        target = FunnelStage.ENGAGED
    if target is None or _RANK[target] <= _RANK[current]:
        return None

    resolved.funnel_stage = target
    resolved.updated_at = datetime.now(UTC)
    repository.update(resolved)
    repository.add_event(
        lead_id=resolved.id,
        event_type=LeadEventType.STAGE_CHANGED,
        from_stage=current,
        to_stage=target,
        metadata={"source": "messaging_webhook"},
        created_by=created_by,
    )
    return target


def link_conversation_lead_and_advance(
    session: Session,
    *,
    conversation: ConversationLeadLink,
    channel: str,
    counters: dict[str, int],
    create_leads: bool,
    is_outbound: bool,
) -> None:
    """Attach an open lead to the conversation and apply live funnel rules."""
    contact_id = conversation.contact_id
    if contact_id is None:
        return

    repository = SalesLeadRepository(session)
    lead = None
    if conversation.lead_id is not None:
        lead = repository.get_by_id(conversation.lead_id)
    elif create_leads:
        lead = repository.find_open_by_contact(contact_id)
        if lead is None:
            lead = repository.create_with_event(
                SalesLead(
                    contact_id=contact_id,
                    lead_type=LeadType.OTHER,
                    funnel_stage=FunnelStage.NEW,
                ),
                LeadEventType.CREATED,
                metadata={
                    "channel": channel,
                    "conversation_id": str(conversation.id),
                },
                to_stage=FunnelStage.NEW,
                created_by=_SYSTEM_ACTOR,
            )
            counters["leads_created"] += 1
        conversation.lead_id = lead.id

    if create_leads:
        maybe_advance_lead_funnel(
            session,
            lead=lead,
            lead_id=conversation.lead_id,
            is_outbound=is_outbound,
            inbound_count=conversation.inbound_count or 0,
            outbound_count=conversation.outbound_count or 0,
        )
