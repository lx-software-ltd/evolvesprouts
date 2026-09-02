from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.api.public_reservations_intro_call import _enforce_intro_call_invariants
from app.db.models.enums import ServiceType
from app.services.intro_call_slots import (
    enumerate_intro_call_candidate_slots,
    intro_call_window,
)


def test_intro_call_cooldown_lookup_failure_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 6, 15, 10, 0, tzinfo=UTC)
    win_from, win_to = intro_call_window(now=now)
    slots = enumerate_intro_call_candidate_slots(win_from, win_to, now=now)
    assert slots, "expected at least one intro-call candidate slot"
    start, end = slots[0]
    payload = {
        "service_key": "intro-call",
        "total_amount": Decimal("0"),
        "payment_method": "free",
        "primary_session_start_iso": start.isoformat().replace("+00:00", "Z"),
        "primary_session_end_iso": end.isoformat().replace("+00:00", "Z"),
        "attendee_email": "guest@example.com",
    }
    catalog_service = MagicMock()
    catalog_service.service_type = ServiceType.INTRO_CALL

    def _boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(
        "app.api.public_reservations_intro_call.recent_intro_call_enrollment_last_booked_at",
        _boom,
    )

    with pytest.raises(RuntimeError, match="database unavailable"):
        _enforce_intro_call_invariants(
            MagicMock(),
            payload,
            catalog_service,
            now=now,
        )
