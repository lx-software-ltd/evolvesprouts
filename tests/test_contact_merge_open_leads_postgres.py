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
from app.db.models.note import Note
from app.db.models.sales_lead import SalesLead
from app.db.models.whatsapp import WhatsAppConversation
from app.exceptions import ConflictError
from app.services.contact_merge import merge_contacts
from app.services.record_merge import raise_merge_integrity
from sqlalchemy import create_engine, select, text, update
from sqlalchemy.exc import IntegrityError
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
    stage: FunnelStage = FunnelStage.NEW,
) -> SalesLead:
    return SalesLead(
        id=uuid4(),
        contact_id=contact.id,
        lead_type=lead_type,
        funnel_stage=stage,
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
                text("DELETE FROM notes WHERE lead_id = :id"),
                {"id": lead_id},
            )
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
                text("DELETE FROM notes WHERE contact_id = :id"),
                {"id": contact_id},
            )
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
            session.add(
                Note(
                    id=uuid4(),
                    content="Followed up on the WhatsApp thread.",
                    created_by="pytest",
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
            note = session.scalar(
                select(Note).where(
                    Note.content == "Followed up on the WhatsApp thread."
                )
            )
            assert note is not None
            assert note.contact_id == keeper_id
            assert note.lead_id == guide_lead_id
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


@pytest.mark.skipif(database_url() is None, reason="TEST_DATABASE_URL not set")
def test_merge_copies_further_along_funnel_stage() -> None:
    url = database_url()
    assert url is not None
    engine = create_engine(_engine_url(url))
    suffix = uuid4().hex[:12]
    keeper = _contact(
        first_name="Kit",
        source=ContactSource.FREE_GUIDE,
        email=f"kit-guide-{suffix}@example.com",
    )
    loser = _contact(
        first_name="Kit",
        source=ContactSource.WHATSAPP,
        phone=_phone("6"),
    )
    guide_lead = _lead(keeper, LeadType.FREE_GUIDE)
    chat_lead = _lead(loser, LeadType.OTHER, stage=FunnelStage.ENGAGED)
    keeper_id = keeper.id
    guide_lead_id = guide_lead.id
    chat_lead_id = chat_lead.id
    contact_ids = [keeper_id, loser.id]
    lead_ids = [guide_lead_id, chat_lead_id]
    try:
        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-stage")
            session.add_all([keeper, loser, guide_lead, chat_lead])
            session.commit()

        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-stage")
            merge_contacts(
                session,
                contact_ids=contact_ids,
                keeper_contact_id=keeper_id,
                actor_sub="pytest",
            )
            session.commit()

        with Session(engine) as session:
            saved = session.get(SalesLead, guide_lead_id)
            assert saved is not None
            assert saved.lead_type == LeadType.FREE_GUIDE
            assert saved.funnel_stage == FunnelStage.ENGAGED
            assert session.get(SalesLead, chat_lead_id) is None
    finally:
        _cleanup(engine, contact_ids, lead_ids, None, "open-lead-stage")
        engine.dispose()


@pytest.mark.skipif(database_url() is None, reason="TEST_DATABASE_URL not set")
def test_merge_folds_three_open_automated_leads() -> None:
    url = database_url()
    assert url is not None
    engine = create_engine(_engine_url(url))
    suffix = uuid4().hex[:12]
    keeper = _contact(
        first_name="Val",
        source=ContactSource.FREE_GUIDE,
        email=f"val-guide-{suffix}@example.com",
    )
    mid = _contact(
        first_name="Val",
        source=ContactSource.WHATSAPP,
        phone=_phone("5"),
    )
    last = _contact(
        first_name="Val",
        source=ContactSource.EVENT,
        phone=_phone("3"),
    )
    guide_lead = _lead(keeper, LeadType.FREE_GUIDE)
    chat_lead = _lead(mid, LeadType.OTHER, stage=FunnelStage.ENGAGED)
    event_lead = _lead(last, LeadType.EVENT_INQUIRY, stage=FunnelStage.CONTACTED)
    keeper_id = keeper.id
    mid_id = mid.id
    last_id = last.id
    guide_lead_id = guide_lead.id
    event_lead_id = event_lead.id
    contact_ids = [keeper_id, mid_id, last_id]
    lead_ids = [guide_lead_id, chat_lead.id, event_lead_id]
    try:
        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-three")
            session.add_all([keeper, mid, last, guide_lead, chat_lead, event_lead])
            session.add(
                Note(
                    id=uuid4(),
                    content="Booked a school visit from the event.",
                    created_by="pytest",
                    contact_id=last_id,
                    lead_id=event_lead_id,
                )
            )
            session.commit()

        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-three")
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
            assert len(leads) == 1
            assert leads[0].id == guide_lead_id
            assert leads[0].lead_type == LeadType.EVENT_INQUIRY
            assert leads[0].funnel_stage == FunnelStage.ENGAGED
            note = session.scalar(
                select(Note).where(
                    Note.content == "Booked a school visit from the event."
                )
            )
            assert note is not None
            assert note.contact_id == keeper_id
            assert note.lead_id == guide_lead_id
            assert session.get(Contact, mid_id) is None
            assert session.get(Contact, last_id) is None
    finally:
        _cleanup(engine, contact_ids, lead_ids, None, "open-lead-three")
        engine.dispose()


@pytest.mark.skipif(database_url() is None, reason="TEST_DATABASE_URL not set")
def test_open_lead_index_violation_from_postgres_is_conflict() -> None:
    url = database_url()
    assert url is not None
    engine = create_engine(_engine_url(url))
    suffix = uuid4().hex[:12]
    keeper = _contact(
        first_name="Ari",
        source=ContactSource.FREE_GUIDE,
        email=f"ari-guide-{suffix}@example.com",
    )
    loser = _contact(
        first_name="Ari",
        source=ContactSource.WHATSAPP,
        phone=_phone("4"),
    )
    guide_lead = _lead(keeper, LeadType.FREE_GUIDE)
    chat_lead = _lead(loser, LeadType.OTHER)
    keeper_id = keeper.id
    chat_lead_id = chat_lead.id
    contact_ids = [keeper_id, loser.id]
    lead_ids = [guide_lead.id, chat_lead_id]
    try:
        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-409")
            session.add_all([keeper, loser, guide_lead, chat_lead])
            session.commit()

        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="open-lead-409")
            with pytest.raises(ConflictError, match="open sales lead") as caught:
                try:
                    session.execute(
                        update(SalesLead)
                        .where(SalesLead.id == chat_lead_id)
                        .values(contact_id=keeper_id)
                    )
                    session.flush()
                except IntegrityError as exc:
                    raise_merge_integrity(exc)
            assert caught.value.status_code == 409
            session.rollback()
    finally:
        _cleanup(engine, contact_ids, lead_ids, None, "open-lead-409")
        engine.dispose()
