"""Identity, suppression horizon, and post-generation rules for insights."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from app.services.sales_daily_plan_identity import (
    normalize_title,
    priority_identity,
)
from app.services.sales_daily_plan_item_state import set_item_done
from app.services.sales_daily_plan_postprocess import apply_generation_rules
from app.services.sales_daily_plan_time import (
    current_business_day_start,
    next_business_day_start,
)


def test_priority_identity_prefers_invoice_over_title() -> None:
    invoice_id = uuid4()
    lead_id = uuid4()
    assert (
        priority_identity(
            kind="chase_payment",
            lead_id=lead_id,
            invoice_id=invoice_id,
            conversation_id=None,
            title="Chase the invoice",
        )
        == f"invoice:{invoice_id}"
    )
    assert (
        priority_identity(
            kind="reply",
            lead_id=lead_id,
            invoice_id=None,
            conversation_id=None,
            title="Reply",
        )
        == f"lead:{lead_id}:reply"
    )
    assert normalize_title("  Chase INV-12! ") == "chase inv 12"
    assert (
        priority_identity(
            kind=None,
            lead_id=None,
            invoice_id=None,
            conversation_id=None,
            title="Chase INV-12!",
        )
        == "title:chase inv 12"
    )


def test_done_until_is_the_next_hong_kong_business_start() -> None:
    before_open = datetime(2026, 9, 3, 21, 30, tzinfo=UTC)  # 05:30 HKT
    after_open = datetime(2026, 9, 3, 22, 30, tzinfo=UTC)  # 06:30 HKT
    assert next_business_day_start(before_open) == datetime(
        2026, 9, 3, 22, 0, tzinfo=UTC
    )
    assert next_business_day_start(after_open) == datetime(
        2026, 9, 4, 22, 0, tzinfo=UTC
    )
    assert current_business_day_start(before_open) == datetime(
        2026, 9, 2, 22, 0, tzinfo=UTC
    )


def test_set_item_done_sets_horizon_then_clears_it() -> None:
    added: list[object] = []

    class _Result:
        def __init__(self, row: object | None) -> None:
            self._row = row

        def first(self) -> object | None:
            return self._row

    class _Session:
        def __init__(self) -> None:
            self._row: object | None = None

        def scalars(self, _statement: object) -> _Result:
            return _Result(self._row)

        def add(self, row: object) -> None:
            added.append(row)
            self._row = row

        def flush(self) -> None:
            return None

    session = _Session()
    now = datetime(2026, 9, 3, 10, 0, tzinfo=UTC)
    created = set_item_done(
        session,  # type: ignore[arg-type]
        identity="title:call sam",
        item_kind="priority",
        title="Call Sam",
        lead_id=None,
        invoice_id=None,
        conversation_id=None,
        priority_kind=None,
        done=True,
        actor="user-1",
        source_plan_id=None,
        now=now,
    )
    assert created is not None
    assert created.done_until == next_business_day_start(now)
    assert added == [created]

    session._row = created
    cleared = set_item_done(
        session,  # type: ignore[arg-type]
        identity="title:call sam",
        item_kind="priority",
        title="Call Sam",
        lead_id=None,
        invoice_id=None,
        conversation_id=None,
        priority_kind=None,
        done=False,
        actor="user-1",
        source_plan_id=None,
        now=now,
    )
    assert cleared is None
    assert created.done_at is None
    assert created.done_until is None


def test_generation_hides_done_items_and_keeps_today_instructions() -> None:
    invoice_id = str(uuid4())
    instruction_id = str(uuid4())
    payload = apply_generation_rules(
        {
            "focus": "Close today",
            "priorities": [
                {
                    "title": "Chase invoice",
                    "why": "Overdue",
                    "action": "Send a reminder",
                    "invoice_id": invoice_id,
                    "urgency": 1,
                    "kind": "chase_payment",
                },
                {
                    "title": "Chase invoice again",
                    "why": "Still overdue",
                    "action": "Send another reminder",
                    "invoice_id": invoice_id,
                    "urgency": 2,
                    "kind": "chase_payment",
                },
            ],
            "outreach": [],
        },
        context={
            "unpaid_invoices": [
                {
                    "id": invoice_id,
                    "updated_at": "2026-09-01T00:00:00+00:00",
                }
            ],
            "open_leads": [],
            "recent_closed_leads": [],
            "converted_nurture": [],
            "needs_reply_threads": [],
            "suppressed_items": [
                {
                    "item_key": f"invoice:{invoice_id}",
                    "reason": "done_today",
                    "title": "Chase invoice",
                    "done_at": "2026-09-03T01:00:00+00:00",
                }
            ],
            "today_instructions": [
                {
                    "id": instruction_id,
                    "text": "Call the venue about Thursday",
                }
            ],
        },
    )
    assert payload["priorities"][0]["from_instruction"] is True
    assert payload["priorities"][0]["instruction_id"] == instruction_id
    assert payload["priorities"][0]["item_key"] == f"instruction:{instruction_id}"
    assert len(payload["priorities"]) == 1
    assert payload["suppressed_items"][0]["reason"] == "done_today"
    assert payload["suppressed_items"][0]["item_key"] == f"invoice:{invoice_id}"


def test_generation_resurfaces_done_work_after_new_activity() -> None:
    invoice_id = str(uuid4())
    payload = apply_generation_rules(
        {
            "focus": "Close today",
            "priorities": [
                {
                    "title": "Chase invoice",
                    "invoice_id": invoice_id,
                    "urgency": 1,
                    "kind": "chase_payment",
                }
            ],
        },
        context={
            "unpaid_invoices": [
                {
                    "id": invoice_id,
                    "updated_at": "2026-09-03T08:00:00+00:00",
                }
            ],
            "suppressed_items": [
                {
                    "item_key": f"invoice:{invoice_id}",
                    "reason": "done_today",
                    "done_at": "2026-09-03T01:00:00+00:00",
                    "title": "Chase invoice",
                }
            ],
        },
    )
    assert payload["suppressed_items"] == []
    assert payload["priorities"][0]["resurfaced"] is True


def test_generation_drops_unknown_invoice_ids() -> None:
    payload = apply_generation_rules(
        {
            "focus": "Close",
            "priorities": [
                {
                    "title": "Chase missing invoice",
                    "invoice_id": str(uuid4()),
                }
            ],
        },
        context={"unpaid_invoices": []},
    )
    assert payload["priorities"] == []


def test_follow_through_ignores_plans_from_the_current_business_day(
    monkeypatch: object,
) -> None:
    from app.services.sales_daily_plan_context_enrichment import (
        build_yesterday_follow_through,
    )

    now = datetime(2026, 9, 3, 23, 0, tzinfo=UTC)  # 07:00 HKT
    today = SimpleNamespace(
        generated_at=datetime(2026, 9, 3, 22, 30, tzinfo=UTC),
        payload={"priorities": [{"title": "Same day"}]},
    )
    monkeypatch.setattr(
        "app.services.sales_daily_plan_context_enrichment.list_recent_plans",
        lambda _session, limit=8: [today],
    )
    result = build_yesterday_follow_through(
        SimpleNamespace(scalars=lambda _s: None), now=now
    )
    assert result == {
        "previous_priority_count": 0,
        "completed_count": 0,
        "still_open": [],
    }


def test_show_again_keeps_instruction_identity() -> None:
    from app.services.sales_daily_plan_item_state import (
        apply_item_states,
        release_cleared_suppressions,
    )

    instruction_id = str(uuid4())
    identity = f"instruction:{instruction_id}"
    cleared = SimpleNamespace(
        item_identity=identity,
        done_until=None,
        snoozed_until=None,
        dismissed_until=None,
        feedback=None,
    )
    still_done = SimpleNamespace(
        item_identity="title:leave this hidden",
        done_until=datetime(2026, 9, 4, 22, 0, tzinfo=UTC),
        snoozed_until=None,
        dismissed_until=None,
        feedback=None,
    )
    rows = {cleared.item_identity: cleared, still_done.item_identity: still_done}

    class _Result:
        def all(self) -> list[object]:
            return list(rows.values())

    class _Session:
        def scalars(self, _statement: object) -> _Result:
            return _Result()

    priorities: list[dict[str, object]] = []
    remaining = release_cleared_suppressions(
        _Session(),  # type: ignore[arg-type]
        priorities=priorities,
        outreach=[],
        suppressed=[
            {
                "item_key": identity,
                "item_kind": "priority",
                "title": "Call the venue",
                "reason": "done_today",
            },
            {
                "item_key": "title:leave this hidden",
                "item_kind": "priority",
                "title": "Leave this hidden",
                "reason": "done_today",
            },
        ],
        now=datetime(2026, 9, 3, 10, 0, tzinfo=UTC),
    )
    assert [item["item_key"] for item in remaining] == ["title:leave this hidden"]
    assert priorities[0]["instruction_id"] == instruction_id
    assert priorities[0]["from_instruction"] is True
    assert priorities[0]["item_key"] == identity

    apply_item_states(
        SimpleNamespace(),
        priorities=priorities,
        outreach=[],
    )
    assert priorities[0]["item_key"] == identity
