"""Tests for admin lead update payload parsing (lost reason enum)."""

from __future__ import annotations

import pytest

from app.api.admin_leads_common import parse_update_lead_payload
from app.db.models.enums import FunnelStage, LeadLostReason
from app.exceptions import ValidationError


def test_parse_update_lead_requires_lost_reason_when_marking_lost() -> None:
    with pytest.raises(ValidationError) as exc_info:
        parse_update_lead_payload({"funnel_stage": "lost"})
    assert exc_info.value.field == "lost_reason"


def test_parse_update_lead_rejects_free_text_lost_reason() -> None:
    with pytest.raises(ValidationError) as exc_info:
        parse_update_lead_payload(
            {"funnel_stage": "lost", "lost_reason": "too expensive for us"}
        )
    assert exc_info.value.field == "lost_reason"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("price_too_high", LeadLostReason.PRICE_TOO_HIGH),
        ("value_not_understood", LeadLostReason.VALUE_NOT_UNDERSTOOD),
        ("ghosted", LeadLostReason.GHOSTED),
        ("language_mismatch", LeadLostReason.LANGUAGE_MISMATCH),
        ("other", LeadLostReason.OTHER),
        ("GHOSTED", LeadLostReason.GHOSTED),
    ],
)
def test_parse_update_lead_accepts_lost_reason_enum(
    raw: str, expected: LeadLostReason
) -> None:
    payload = parse_update_lead_payload({"funnel_stage": "lost", "lost_reason": raw})
    assert payload["funnel_stage"] == FunnelStage.LOST
    assert payload["lost_reason"] == expected
