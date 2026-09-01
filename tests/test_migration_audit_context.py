"""Audit context stamping for deploy-time Alembic and country sync."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any

from app.db.audit import (
    ALEMBIC_AUDIT_USER_ID,
    set_connection_audit_context,
    set_psycopg_audit_context,
    stamp_alembic_audit_context,
)


def _load_migrations_module(name: str) -> Any:
    backend_root = Path(__file__).resolve().parents[1] / "backend"
    backend_root_str = str(backend_root)
    if backend_root_str not in sys.path:
        sys.path.insert(0, backend_root_str)
    return importlib.import_module(name)


def test_set_connection_audit_context_uses_session_scope_when_not_local() -> None:
    executed: list[tuple[str, dict[str, Any]]] = []

    class _Connection:
        def execute(self, statement: Any, params: dict[str, Any]) -> None:
            executed.append((str(statement), params))

    set_connection_audit_context(
        _Connection(),
        user_id=ALEMBIC_AUDIT_USER_ID,
        request_id="req-mig-1",
        local=False,
    )
    assert executed[0][1] == {"user_id": "alembic", "is_local": False}
    assert executed[1][1] == {"request_id": "req-mig-1", "is_local": False}


def test_stamp_alembic_audit_context_commits_after_session_gucs() -> None:
    events: list[str] = []

    class _Connection:
        def execute(self, statement: Any, params: dict[str, Any]) -> None:
            events.append(f"execute:{params.get('is_local')}")

        def commit(self) -> None:
            events.append("commit")

    stamp_alembic_audit_context(
        _Connection(),
        user_id=ALEMBIC_AUDIT_USER_ID,
        request_id="req-mig-2",
    )
    assert events == ["execute:False", "execute:False", "commit"]


def test_sync_active_countries_stamps_alembic_actor(
    monkeypatch: Any,
) -> None:
    migration_sync = _load_migrations_module("lambda.migrations.sync")
    calls: list[tuple[Any, ...]] = []

    class _Cursor:
        def __enter__(self) -> "_Cursor":
            return self

        def __exit__(self, *_a: object) -> bool:
            return False

        def execute(self, query: Any, params: Any = None) -> None:
            calls.append((query, params))

        def fetchone(self) -> tuple[bool]:
            return (False,)

        def fetchall(self) -> list[Any]:
            return []

    class _Connection:
        def __enter__(self) -> "_Connection":
            return self

        def __exit__(self, *_a: object) -> bool:
            return False

        def cursor(self) -> _Cursor:
            return _Cursor()

        def commit(self) -> None:
            return None

    monkeypatch.setenv("ACTIVE_COUNTRY_CODES", "HK")
    monkeypatch.setenv("MIGRATIONS_REQUEST_ID", "cfn-req-9")
    monkeypatch.setattr(migration_sync, "_psycopg_connect", lambda _url: _Connection())

    migration_sync._sync_active_countries("postgresql://example.test/db")

    assert calls[0] == (
        "SELECT set_config('app.current_user_id', %s, %s)",
        ("alembic", True),
    )
    assert calls[1] == (
        "SELECT set_config('app.current_request_id', %s, %s)",
        ("cfn-req-9", True),
    )


def test_run_seed_stamps_alembic_actor(
    monkeypatch: Any,
    tmp_path: Any,
) -> None:
    migration_seed = _load_migrations_module("lambda.migrations.seed")
    calls: list[tuple[Any, ...]] = []
    seed_file = tmp_path / "seed.sql"
    seed_file.write_text("SELECT 1;", encoding="utf-8")

    class _Cursor:
        def __enter__(self) -> "_Cursor":
            return self

        def __exit__(self, *_a: object) -> bool:
            return False

        def execute(self, query: Any, params: Any = None) -> None:
            calls.append((query, params))

    class _Connection:
        def __enter__(self) -> "_Connection":
            return self

        def __exit__(self, *_a: object) -> bool:
            return False

        def cursor(self) -> _Cursor:
            return _Cursor()

        def commit(self) -> None:
            return None

    monkeypatch.setenv("MIGRATIONS_REQUEST_ID", "seed-req")
    monkeypatch.setattr(migration_seed, "_psycopg_connect", lambda _url: _Connection())

    migration_seed._run_seed("postgresql://example.test/db", str(seed_file))

    assert calls[0] == (
        "SELECT set_config('app.current_user_id', %s, %s)",
        ("alembic", True),
    )
    assert calls[-1] == ("SELECT 1;", None)


def test_set_psycopg_audit_context_defaults_empty_strings() -> None:
    calls: list[tuple[Any, ...]] = []

    class _Cursor:
        def execute(self, query: Any, params: Any = None) -> None:
            calls.append((query, params))

    set_psycopg_audit_context(_Cursor())
    assert calls == [
        ("SELECT set_config('app.current_user_id', %s, %s)", ("", True)),
        ("SELECT set_config('app.current_request_id', %s, %s)", ("", True)),
    ]
