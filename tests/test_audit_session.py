from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from app.db.audit import session_with_audit


def test_session_with_audit_stamps_context_inside_transaction(monkeypatch: Any) -> None:
    session = MagicMock()
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    session_cm.__exit__.return_value = False
    begin_cm = MagicMock()
    begin_cm.__enter__.return_value = session
    begin_cm.__exit__.return_value = False
    session.begin.return_value = begin_cm

    session_factory = MagicMock(return_value=session_cm)
    monkeypatch.setattr("app.db.audit.Session", session_factory)
    monkeypatch.setattr("app.db.audit.get_engine", lambda: "engine")
    set_audit = MagicMock()
    monkeypatch.setattr("app.db.audit.set_audit_context", set_audit)

    with session_with_audit("user-1", "req-1") as yielded:
        assert yielded is session
        set_audit.assert_called_once_with(session, user_id="user-1", request_id="req-1")

    session.begin.assert_called_once_with()
