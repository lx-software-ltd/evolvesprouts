"""Advance sales-lead funnel stages from live messaging webhooks."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.contact import Contact
from app.db.models.enums import FunnelStage, LeadEventType, LeadType
from app.db.models.meta import MetaConversation
from app.db.models.sales_lead import SalesLead
from app.db.models.whatsapp import WhatsAppConversation
from app.db.repositories.sales_lead import (
    CLOSED_FUNNEL_STAGES,
    SalesLeadRepository,
)
from app.services.helper_detector import maybe_apply_helper_detector
from app.services.sales_assignment import (
    notify_lead_assignee,
    record_new_lead_assignment_event,
    resolve_create_assignee,
)

_SYSTEM_ACTOR = "system"

ConversationLeadLink = WhatsAppConversation | MetaConversation


_RANK = {
    FunnelStage.NEW: 0,
    FunnelStage.CONTACTED: 1,
    FunnelStage.ENGAGED: 2,
}

_LEAD_TYPE_RANK = {
    LeadType.OTHER: 0,
    LeadType.FREE_GUIDE: 1,
    LeadType.EVENT_INQUIRY: 2,
    LeadType.PARTNERSHIP: 3,
    LeadType.CONSULTATION: 4,
    LeadType.PROGRAM_ENROLLMENT: 5,
}


def _find_reusable_lead(
    repository: SalesLeadRepository, contact_id: UUID
) -> SalesLead | None:
    """Prefer ``find_reusable_by_contact``; fakes may only implement open lookup."""
    finder = getattr(repository, "find_reusable_by_contact", None)
    if callable(finder):
        return finder(contact_id)
    return repository.find_open_by_contact(contact_id)


def _promote_lead_type(lead: SalesLead, lead_type: LeadType) -> bool:
    current = getattr(lead, "lead_type", None)
    if current is None:
        lead.lead_type = lead_type
        return True
    if _LEAD_TYPE_RANK.get(lead_type, 0) > _LEAD_TYPE_RANK.get(current, 0):
        lead.lead_type = lead_type
        return True
    return False


def reopen_closed_lead(
    repository: SalesLeadRepository,
    lead: SalesLead,
    *,
    metadata: dict[str, object] | None = None,
    created_by: str = _SYSTEM_ACTOR,
) -> bool:
    """Move a converted/lost lead back to ``new``. Returns True when reopened."""
    current = getattr(lead, "funnel_stage", None)
    if current not in CLOSED_FUNNEL_STAGES:
        return False
    lead.funnel_stage = FunnelStage.NEW
    lead.converted_at = None
    lead.lost_at = None
    lead.lost_reason = None
    lead.updated_at = datetime.now(UTC)
    repository.update(lead)
    event_metadata = {"source": "reopen_on_action"}
    if metadata:
        event_metadata.update(metadata)
    repository.add_event(
        lead_id=lead.id,
        event_type=LeadEventType.STAGE_CHANGED,
        from_stage=current,
        to_stage=FunnelStage.NEW,
        metadata=event_metadata,
        created_by=created_by,
    )
    return True


def ensure_contact_lead(
    session: Session,
    *,
    contact_id: UUID,
    lead_type: LeadType,
    metadata: dict[str, object] | None = None,
    asset_id: UUID | None = None,
    contact: Contact | None = None,
    created_by: str = _SYSTEM_ACTOR,
    attach_event_type: LeadEventType = LeadEventType.ACTION_RECORDED,
    notify: bool = True,
) -> tuple[SalesLead, bool]:
    """Reuse or reopen the contact's lead, or create one. Returns (lead, created)."""
    repository = SalesLeadRepository(session)
    existing = _find_reusable_lead(repository, contact_id)
    if existing is not None:
        changed = _promote_lead_type(existing, lead_type)
        if asset_id is not None and getattr(existing, "asset_id", None) is None:
            existing.asset_id = asset_id
            changed = True
        reopened = reopen_closed_lead(
            repository,
            existing,
            metadata=metadata,
            created_by=created_by,
        )
        if changed and not reopened:
            existing.updated_at = datetime.now(UTC)
            repository.update(existing)
        repository.add_event(
            lead_id=existing.id,
            event_type=attach_event_type,
            metadata=metadata,
            created_by=created_by,
        )
        return existing, False

    assigned_to = resolve_create_assignee(session)
    lead = SalesLead(
        contact_id=contact_id,
        lead_type=lead_type,
        funnel_stage=FunnelStage.NEW,
        asset_id=asset_id,
        assigned_to=assigned_to,
        is_manual=False,
    )
    try:
        nested = getattr(session, "begin_nested", None)
        if callable(nested):
            with nested():
                lead = repository.create_with_event(
                    lead,
                    LeadEventType.CREATED,
                    metadata=metadata,
                    to_stage=FunnelStage.NEW,
                    created_by=created_by,
                )
        else:
            lead = repository.create_with_event(
                lead,
                LeadEventType.CREATED,
                metadata=metadata,
                to_stage=FunnelStage.NEW,
                created_by=created_by,
            )
    except IntegrityError:
        recovered = repository.find_open_by_contact(contact_id)
        if recovered is None:
            raise
        repository.add_event(
            lead_id=recovered.id,
            event_type=attach_event_type,
            metadata=metadata,
            created_by=created_by,
        )
        return recovered, False

    record_new_lead_assignment_event(
        repository,
        lead_id=getattr(lead, "id", None),
        assigned_to=assigned_to,
        actor_sub=created_by,
    )
    if notify:
        notify_lead_assignee(session, lead, previous=None)
    resolved_contact = contact
    if resolved_contact is None:
        getter = getattr(session, "get", None)
        if callable(getter):
            try:
                resolved_contact = getter(Contact, contact_id)
            except Exception:
                resolved_contact = None
    if resolved_contact is not None:
        maybe_apply_helper_detector(
            session, resolved_contact, lead, created_by=created_by
        )
    return lead, True


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
        if create_leads and lead is not None:
            reopen_closed_lead(
                repository,
                lead,
                metadata={
                    "channel": channel,
                    "conversation_id": str(conversation.id),
                },
            )
        elif create_leads and lead is None:
            lead, created = ensure_contact_lead(
                session,
                contact_id=contact_id,
                lead_type=LeadType.OTHER,
                metadata={
                    "channel": channel,
                    "conversation_id": str(conversation.id),
                },
            )
            if created:
                counters["leads_created"] += 1
            conversation.lead_id = lead.id
    elif create_leads:
        lead, created = ensure_contact_lead(
            session,
            contact_id=contact_id,
            lead_type=LeadType.OTHER,
            metadata={
                "channel": channel,
                "conversation_id": str(conversation.id),
            },
        )
        if created:
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
