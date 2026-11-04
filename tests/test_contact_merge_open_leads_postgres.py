"""PostgreSQL: contact merge folds two open automated leads.

Skipped unless ``TEST_DATABASE_URL`` is set. Covers the free-guide parent plus
WhatsApp stub case, where both contacts already have an open automated lead.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from app.db.audit import set_audit_context
from app.db.models.contact import Contact
from app.db.models.enums import (
    ContactSource,
    ContactType,
    FunnelStage,
    LeadType,
    RelationshipType,
)
from app.db.models.sales_lead import SalesLead
from app.db.models.whatsapp import WhatsAppConversation
from app.services.contact_merge import merge_contacts
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from tests.helpers.db import database_url

pytest.importorskip("psycopg", reason="psycopg required for DB integration test")


def _phone(prefix: str) -> str:
    """Eight-digit national number. The contacts check allows digits only."""
    return f"{prefix}{uuid4().int % 10_000_000:07d}"


def _engine_url(url: str) -> str:
    if url.startswith(("postgresql+", "postgres+")):
        return url
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    return url


def _contact(
    *,
    first_name: str,
    source: ContactSource,
    email: str | None = None,
    phone: str | None = None,
) -> Contact:
    return Contact(
        id=uuid4(),
        first_name=first_name,
        email=email,
        phone_region="HK" if phone else None,
        phone_national_number=phone,
        contact_type=ContactType.PARENT,
        relationship_type=RelationshipType.PROSPECT,
        source=source,
    )


def _lead(
    contact: Contact,
    lead_type: LeadType,
    *,
    manual: bool = False,
) -> SalesLead:
    return SalesLead(
        id=uuid4(),
        contact_id=contact.id,
        lead_type=lead_type,
        funnel_stage=FunnelStage.NEW,
        is_manual=manual,
    )


def _cleanup(
    engine,
    contact_ids: list,
    lead_ids: list,
    wa_id: str | None,
    request_id: str,
) -> None:
    with engine.begin() as conn:
        if wa_id:
            conn.execute(
                text("DELETE FROM whatsapp_conversations WHERE wa_id = :wa"),
                {"wa": wa_id},
            )
        for lead_id in lead_ids:
            conn.execute(
                text("DELETE FROM sales_lead_events WHERE lead_id = :id"),
                {"id": lead_id},
            )
            conn.execute(
                text("DELETE FROM sales_leads WHERE id = :id"),
                {"id": lead_id},
            )
        for contact_id in contact_ids:
            conn.execute(
                text("DELETE FROM sales_leads WHERE contact_id = :id"),
                {"id": contact_id},
            )
            conn.execute(
                text("DELETE FROM contacts WHERE id = :id"),
                {"id": contact_id},
            )
        conn.execute(
            text("DELETE FROM audit_log WHERE request_id = :request_id"),
            {"request_id": request_id},
        )


@pytest.mark.skipif(database_url() is None, reason="TEST_DATABASE_URL not set")
def test_merge_folds_open_automated_leads_onto_keeper_lead() -> None:
    """Free-guide lead survives and takes the WhatsApp thread."""
    url = database_url()
    assert url is not None
    engine = create_engine(_engine_url(url))
    suffix = uuid4().hex[:12]
    wa_id = f"8529{suffix}"[:32]
    keeper = _contact(
        first_name="Pat",
        source=ContactSource.FREE_GUIDE,
        email=f"pat-guide-{suffix}@example.com",
    )
    loser = _contact(
        first_name="Pat",
        source=ContactSource.WHATSAPP,
        phone=_phone("9"),
    )
    guide_lead = _lead(keeper, LeadType.FREE_GUIDE)
    chat_lead = _lead(loser, LeadType.OTHER)
    keeper_id = keeper.id
    loser_id = loser.id
    guide_lead_id = guide_lead.id
    chat_lead_id = chat_lead.id
    loser_phone = loser.phone_national_number
    contact_ids = [keeper_id, loser_id]
    lead_ids = [guide_lead_id, chat_lead_id]
    try:
        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-merge")
            session.add_all([keeper, loser, guide_lead, chat_lead])
            session.flush()
            session.add(
                WhatsAppConversation(
                    id=uuid4(),
                    wa_id=wa_id,
                    contact_id=loser_id,
                    lead_id=chat_lead_id,
                )
            )
            session.commit()

        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-merge")
            merge_contacts(
                session,
                contact_ids=contact_ids,
                keeper_contact_id=keeper_id,
                actor_sub="pytest",
            )
            session.commit()

        with Session(engine) as session:
            saved = session.get(Contact, keeper_id)
            assert saved is not None
            assert saved.phone_national_number == loser_phone
            assert saved.source == ContactSource.WHATSAPP
            assert session.get(Contact, loser_id) is None
            leads = session.scalars(
                select(SalesLead).where(SalesLead.contact_id == keeper_id)
            ).all()
            assert len(leads) == 1
            assert leads[0].id == guide_lead_id
            assert leads[0].lead_type == LeadType.FREE_GUIDE
            assert leads[0].funnel_stage == FunnelStage.NEW
            assert session.get(SalesLead, chat_lead_id) is None
            thread = session.scalar(
                select(WhatsAppConversation).where(WhatsAppConversation.wa_id == wa_id)
            )
            assert thread is not None
            assert thread.contact_id == keeper_id
            assert thread.lead_id == guide_lead_id
    finally:
        _cleanup(engine, contact_ids, lead_ids, wa_id, "open-lead-merge")
        engine.dispose()


@pytest.mark.skipif(database_url() is None, reason="TEST_DATABASE_URL not set")
def test_merge_moves_open_lead_when_keeper_has_none() -> None:
    url = database_url()
    assert url is not None
    engine = create_engine(_engine_url(url))
    suffix = uuid4().hex[:12]
    keeper = _contact(
        first_name="Nia",
        source=ContactSource.EVENT,
        email=f"nia-event-{suffix}@example.com",
    )
    loser = _contact(
        first_name="Nia",
        source=ContactSource.WHATSAPP,
        phone=_phone("8"),
    )
    chat_lead = _lead(loser, LeadType.OTHER)
    keeper_id = keeper.id
    loser_id = loser.id
    chat_lead_id = chat_lead.id
    contact_ids = [keeper_id, loser_id]
    lead_ids = [chat_lead_id]
    try:
        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-move")
            session.add_all([keeper, loser, chat_lead])
            session.commit()

        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-move")
            merge_contacts(
                session,
                contact_ids=contact_ids,
                keeper_contact_id=keeper_id,
                actor_sub="pytest",
            )
            session.commit()

        with Session(engine) as session:
            moved = session.get(SalesLead, chat_lead_id)
            assert moved is not None
            assert moved.contact_id == keeper_id
            assert moved.lead_type == LeadType.OTHER
            assert session.get(Contact, loser_id) is None
    finally:
        _cleanup(engine, contact_ids, lead_ids, None, "open-lead-move")
        engine.dispose()


@pytest.mark.skipif(database_url() is None, reason="TEST_DATABASE_URL not set")
def test_merge_keeps_manual_open_lead_beside_automated_lead() -> None:
    url = database_url()
    assert url is not None
    engine = create_engine(_engine_url(url))
    suffix = uuid4().hex[:12]
    keeper = _contact(
        first_name="Ren",
        source=ContactSource.MANUAL,
        email=f"ren-manual-{suffix}@example.com",
    )
    loser = _contact(
        first_name="Ren",
        source=ContactSource.WHATSAPP,
        phone=_phone("7"),
    )
    manual_lead = _lead(keeper, LeadType.CONSULTATION, manual=True)
    chat_lead = _lead(loser, LeadType.OTHER)
    keeper_id = keeper.id
    manual_lead_id = manual_lead.id
    chat_lead_id = chat_lead.id
    contact_ids = [keeper_id, loser.id]
    lead_ids = [manual_lead_id, chat_lead_id]
    try:
        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-manual")
            session.add_all([keeper, loser, manual_lead, chat_lead])
            session.commit()

        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-manual")
            merge_contacts(
                session,
                contact_ids=contact_ids,
                keeper_contact_id=keeper_id,
                actor_sub="pytest",
            )
            session.commit()

        with Session(engine) as session:
            leads = session.scalars(
                select(SalesLead).where(SalesLead.contact_id == keeper_id)
            ).all()
            by_id = {lead.id: lead for lead in leads}
            assert set(by_id) == {manual_lead_id, chat_lead_id}
            assert by_id[manual_lead_id].is_manual is True
            assert by_id[chat_lead_id].is_manual is False
    finally:
        _cleanup(engine, contact_ids, lead_ids, None, "open-lead-manual")
        engine.dispose()
