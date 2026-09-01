"""Unit tests for AI Helper Detector on new sales leads."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.db.models.enums import ContactType, FunnelStage, LeadEventType
from app.services import helper_detector as detector


class _FakeLeadRepo:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def update(self, lead: Any) -> Any:
        return lead

    def add_event(self, **kwargs: Any) -> None:
        self.events.append(kwargs)


def test_detect_helper_language_signal_true(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        detector.openrouter,
        "_openrouter_chat_completion",
        lambda **_kwargs: '{"choices":[{"message":{"content":"{\\"is_helper_language_signal\\": true}"}}]}',
    )
    monkeypatch.setattr(
        detector.openrouter,
        "_parse_completion_body",
        lambda _body: {"is_helper_language_signal": True},
    )
    assert (
        detector.detect_helper_language_signal(
            first_name="Maria Clara",
            last_name="Santos",
            username="maria_santos",
        )
        is True
    )


def test_detect_helper_language_signal_fail_open(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _boom(**_kwargs: Any) -> str:
        raise RuntimeError("openrouter down")

    monkeypatch.setattr(detector.openrouter, "_openrouter_chat_completion", _boom)
    assert detector.detect_helper_language_signal(first_name="Ada") is False


def test_maybe_apply_skips_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(detector, "is_helper_detector_enabled", lambda _s: False)
    called = {"n": 0}

    def _detect(**_kwargs: Any) -> bool:
        called["n"] += 1
        return True

    monkeypatch.setattr(detector, "detect_helper_language_signal", _detect)
    contact = SimpleNamespace(
        first_name="Maria",
        last_name=None,
        instagram_handle=None,
        contact_type=ContactType.OTHER,
    )
    lead = SimpleNamespace(id=uuid4(), funnel_stage=FunnelStage.NEW)
    assert detector.maybe_apply_helper_detector(object(), contact, lead) is False
    assert called["n"] == 0
    assert lead.funnel_stage is FunnelStage.NEW


def test_maybe_apply_sets_unqualified_and_helper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _FakeLeadRepo()
    monkeypatch.setattr(detector, "is_helper_detector_enabled", lambda _s: True)
    monkeypatch.setattr(detector, "detect_helper_language_signal", lambda **_: True)
    monkeypatch.setattr(detector, "SalesLeadRepository", lambda _s: repo)

    contact = SimpleNamespace(
        first_name="Putri",
        last_name="Wijaya",
        instagram_handle="putri_w",
        contact_type=ContactType.OTHER,
    )
    lead = SimpleNamespace(id=uuid4(), funnel_stage=FunnelStage.NEW)
    assert detector.maybe_apply_helper_detector(object(), contact, lead) is True
    assert lead.funnel_stage is FunnelStage.UNQUALIFIED
    assert contact.contact_type is ContactType.HELPER
    assert repo.events[0]["event_type"] is LeadEventType.STAGE_CHANGED
    assert repo.events[0]["to_stage"] is FunnelStage.UNQUALIFIED


def test_maybe_apply_does_not_overwrite_non_other_contact_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _FakeLeadRepo()
    monkeypatch.setattr(detector, "is_helper_detector_enabled", lambda _s: True)
    monkeypatch.setattr(detector, "detect_helper_language_signal", lambda **_: True)
    monkeypatch.setattr(detector, "SalesLeadRepository", lambda _s: repo)

    contact = SimpleNamespace(
        first_name="Maria",
        last_name="Santos",
        instagram_handle=None,
        contact_type=ContactType.PARENT,
    )
    lead = SimpleNamespace(id=uuid4(), funnel_stage=FunnelStage.NEW)
    assert detector.maybe_apply_helper_detector(object(), contact, lead) is True
    assert lead.funnel_stage is FunnelStage.UNQUALIFIED
    assert contact.contact_type is ContactType.PARENT
    assert repo.events[0]["metadata"]["contact_type_updated"] is False
