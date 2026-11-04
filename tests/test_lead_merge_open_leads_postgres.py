"""PostgreSQL: lead merge keeps the selected keeper lead.

Skipped unless ``TEST_DATABASE_URL`` is set. Covers a selected keeper that is
not the keeper contact's open automated lead.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from app.db.audit import set_audit_context
from app.db.models.contact import Contact
from app.db.models.enums import ContactSource, FunnelStage, LeadType
from app.db.models.note import Note
from app.db.models.sales_lead import SalesLead
from app.services.lead_merge import merge_leads
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from tests.helpers.db import database_url
from tests.test_contact_merge_open_leads_postgres import (
    _cleanup,
    _contact,
    _engine_url,
    _lead,
    _phone,
)

pytest.importorskip("psycopg", reason="psycopg required for DB integration test")


@pytest.mark.skipif(database_url() is None, reason="TEST_DATABASE_URL not set")
def test_lead_merge_keeps_selected_manual_keeper() -> None:
    """Selected manual keeper absorbs the loser; sibling open lead stays."""
    url = database_url()
    assert url is not None
    engine = create_engine(_engine_url(url))
    suffix = uuid4().hex[:12]
    keeper = _contact(
        first_name="Ned",
        source=ContactSource.MANUAL,
        email=f"ned-manual-{suffix}@example.com",
    )
    loser = _contact(
        first_name="Ned",
        source=ContactSource.WHATSAPP,
        phone=_phone("2"),
    )
    sibling = _lead(keeper, LeadType.FREE_GUIDE)
    manual_lead = _lead(keeper, LeadType.CONSULTATION, manual=True)
    chat_lead = _lead(loser, LeadType.OTHER, stage=FunnelStage.ENGAGED)
    keeper_id = keeper.id
    loser_id = loser.id
    sibling_id = sibling.id
    manual_lead_id = manual_lead.id
    chat_lead_id = chat_lead.id
    contact_ids = [keeper_id, loser_id]
    lead_ids = [sibling_id, manual_lead_id, chat_lead_id]
    try:
        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="lead-merge-skip")
            session.add_all([keeper, loser, sibling, manual_lead, chat_lead])
            session.add(
                Note(
                    id=uuid4(),
                    content="Asked about a consultation slot.",
                    created_by="pytest",
                    contact_id=loser_id,
                    lead_id=chat_lead_id,
                )
            )
            session.commit()

        with Session(engine) as session:
            set_audit_context(session, user_id="pytest", request_id="lead-merge-skip")
            merge_leads(
                session,
                lead_ids=[manual_lead_id, chat_lead_id],
                keeper_lead_id=manual_lead_id,
                actor_sub="pytest",
            )
            session.commit()

        with Session(engine) as session:
            kept = session.get(SalesLead, manual_lead_id)
            assert kept is not None
            assert kept.contact_id == keeper_id
            assert kept.is_manual is True
            assert kept.lead_type == LeadType.CONSULTATION
            assert kept.funnel_stage == FunnelStage.ENGAGED
            assert session.get(SalesLead, chat_lead_id) is None
            leftover = session.get(SalesLead, sibling_id)
            assert leftover is not None
            assert leftover.contact_id == keeper_id
            assert leftover.lead_type == LeadType.FREE_GUIDE
            assert leftover.funnel_stage == FunnelStage.NEW
            note = session.scalar(
                select(Note).where(Note.content == "Asked about a consultation slot.")
            )
            assert note is not None
            assert note.contact_id == keeper_id
            assert note.lead_id == manual_lead_id
            assert session.get(Contact, loser_id) is None
    finally:
        _cleanup(engine, contact_ids, lead_ids, None, "lead-merge-skip")
        engine.dispose()
