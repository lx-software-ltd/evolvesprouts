from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

from app.db.models.enums import LeadEventType
from app.services import sales_assignment as sa


class _FakeSettings:
    def __init__(
        self,
        default_assigned_to: str | None = "user-default",
        notify_assignee_on_assignment: bool = True,
    ) -> None:
        self.default_assigned_to = default_assigned_to
        self.notify_assignee_on_assignment = notify_assignee_on_assignment


class _SessionWithGet:
    def __init__(self, row: _FakeSettings | None) -> None:
        self._row = row

    def get(self, _model: object, _id: object) -> _FakeSettings | None:
        return self._row


def test_resolve_create_assignee_uses_explicit_value() -> None:
    session = _SessionWithGet(_FakeSettings())
    assert (
        sa.resolve_create_assignee(
            session, assigned_to="user-explicit", assigned_to_provided=True
        )
        == "user-explicit"
    )


def test_resolve_create_assignee_explicit_null_overrides_default() -> None:
    session = _SessionWithGet(_FakeSettings())
    assert (
        sa.resolve_create_assignee(session, assigned_to=None, assigned_to_provided=True)
        is None
    )


def test_resolve_create_assignee_applies_default_when_omitted() -> None:
    session = _SessionWithGet(_FakeSettings(default_assigned_to="user-default"))
    assert sa.resolve_create_assignee(session) == "user-default"


def test_resolve_create_assignee_defaults_when_session_has_no_get() -> None:
    assert sa.resolve_create_assignee(object()) is None


def test_record_new_lead_assignment_event_skips_missing_lead_id() -> None:
    repo = MagicMock()
    sa.record_new_lead_assignment_event(
        repo, lead_id=None, assigned_to="user-1", actor_sub="admin-1"
    )
    repo.add_event.assert_not_called()


def test_record_new_lead_assignment_event_skips_unassigned() -> None:
    repo = MagicMock()
    sa.record_new_lead_assignment_event(
        repo, lead_id=uuid4(), assigned_to=None, actor_sub="admin-1"
    )
    repo.add_event.assert_not_called()


def test_record_new_lead_assignment_event_writes_assigned() -> None:
    repo = MagicMock()
    lead_id = uuid4()
    sa.record_new_lead_assignment_event(
        repo, lead_id=lead_id, assigned_to="user-1", actor_sub="admin-1"
    )
    repo.add_event.assert_called_once_with(
        lead_id=lead_id,
        event_type=LeadEventType.ASSIGNED,
        metadata={"from": None, "to": "user-1"},
        created_by="admin-1",
    )


def test_maybe_notify_assignee_skips_when_flag_off(monkeypatch: Any) -> None:
    send = MagicMock()
    monkeypatch.setattr(sa, "send_email", send)
    sa.maybe_notify_assignee(
        _SessionWithGet(_FakeSettings(notify_assignee_on_assignment=False)),
        assigned_to="user-1",
        previous=None,
        lead_id="lead-1",
    )
    send.assert_not_called()


def test_maybe_notify_assignee_skips_unassign(monkeypatch: Any) -> None:
    send = MagicMock()
    monkeypatch.setattr(sa, "send_email", send)
    sa.maybe_notify_assignee(
        _SessionWithGet(_FakeSettings()),
        assigned_to=None,
        previous="user-1",
        lead_id="lead-1",
    )
    send.assert_not_called()


def test_maybe_notify_assignee_skips_unchanged(monkeypatch: Any) -> None:
    send = MagicMock()
    monkeypatch.setattr(sa, "send_email", send)
    sa.maybe_notify_assignee(
        _SessionWithGet(_FakeSettings()),
        assigned_to="user-1",
        previous="user-1",
        lead_id="lead-1",
    )
    send.assert_not_called()


def test_maybe_notify_assignee_sends_on_first_assign(monkeypatch: Any) -> None:
    send = MagicMock()
    monkeypatch.setattr(sa, "send_email", send)
    monkeypatch.setattr(
        sa,
        "cognito_emails_for_subs",
        lambda subs, user_pool_id: {subs[0]: "a@example.com"},
    )
    monkeypatch.setenv("SES_SENDER_EMAIL", "from@example.com")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "pool-1")

    sa.maybe_notify_assignee(
        _SessionWithGet(_FakeSettings()),
        assigned_to="user-1",
        previous=None,
        lead_id="lead-1",
        contact_first_name="Ada",
        contact_last_name="Lovelace",
        contact_email="ada@example.com",
        lead_type="consultation",
    )

    send.assert_called_once()
    kwargs = send.call_args.kwargs
    assert kwargs["to_addresses"] == ["a@example.com"]
    assert "lead-1" in kwargs["body_text"]
    assert "Ada Lovelace" in kwargs["body_text"]


def test_maybe_notify_assignee_sends_on_reassignment(monkeypatch: Any) -> None:
    send = MagicMock()
    monkeypatch.setattr(sa, "send_email", send)
    monkeypatch.setattr(
        sa,
        "cognito_emails_for_subs",
        lambda subs, user_pool_id: {subs[0]: "b@example.com"},
    )
    monkeypatch.setenv("SES_SENDER_EMAIL", "from@example.com")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "pool-1")

    sa.maybe_notify_assignee(
        _SessionWithGet(_FakeSettings()),
        assigned_to="user-b",
        previous="user-a",
        lead_id="lead-2",
    )

    send.assert_called_once()
    assert send.call_args.kwargs["to_addresses"] == ["b@example.com"]


def test_maybe_notify_assignee_skips_when_no_email(monkeypatch: Any) -> None:
    send = MagicMock()
    monkeypatch.setattr(sa, "send_email", send)
    monkeypatch.setattr(sa, "cognito_emails_for_subs", lambda *_a, **_k: {})
    monkeypatch.setenv("SES_SENDER_EMAIL", "from@example.com")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "pool-1")

    sa.maybe_notify_assignee(
        _SessionWithGet(_FakeSettings()),
        assigned_to="user-1",
        previous=None,
        lead_id="lead-1",
    )
    send.assert_not_called()


def test_notify_lead_assignee_reads_contact(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}

    def _fake_notify(_session: object, **kwargs: Any) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(sa, "maybe_notify_assignee", _fake_notify)
    lead = SimpleNamespace(
        id=uuid4(),
        assigned_to="user-1",
        lead_type=SimpleNamespace(value="consultation"),
        contact=SimpleNamespace(
            first_name="Kitie",
            last_name="Wong",
            email="kitie@example.com",
        ),
    )
    sa.notify_lead_assignee(object(), lead, previous=None)
    assert captured["assigned_to"] == "user-1"
    assert captured["contact_first_name"] == "Kitie"
    assert captured["lead_type"] == "consultation"
