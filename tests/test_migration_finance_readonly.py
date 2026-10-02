"""Finance read-only role sync for the Aurora Data API mirror."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any

from psycopg import sql


def _load_sync_module() -> Any:
    backend_root = Path(__file__).resolve().parents[1] / "backend"
    backend_root_str = str(backend_root)
    if backend_root_str not in sys.path:
        sys.path.insert(0, backend_root_str)
    return importlib.import_module("lambda.migrations.sync")


def _render(query: Any) -> str:
    if isinstance(query, str):
        return query
    return query.as_string(None)


class _Cursor:
    def __init__(self, existing_roles: set[str]) -> None:
        self.existing_roles = existing_roles
        self.calls: list[tuple[str, Any]] = []
        self._last_role: str | None = None

    def execute(self, query: Any, params: Any = None) -> None:
        rendered = _render(query)
        self.calls.append((rendered, params))
        if "pg_roles" in rendered and params:
            self._last_role = params[0]

    def fetchone(self) -> tuple[int] | None:
        if self._last_role in self.existing_roles:
            return (1,)
        return None


class _Connection:
    def __init__(self, cursor: _Cursor) -> None:
        self._cursor = cursor
        self.committed = False

    def __enter__(self) -> "_Connection":
        return self

    def __exit__(self, *_args: object) -> bool:
        return False

    def cursor(self) -> Any:
        cursor = self._cursor

        class _CursorContext:
            def __enter__(self_inner) -> _Cursor:
                return cursor

            def __exit__(self_inner, *_args: object) -> bool:
                return False

        return _CursorContext()

    def commit(self) -> None:
        self.committed = True


def _install_connection(
    monkeypatch: Any,
    migration_sync: Any,
    existing_roles: set[str],
) -> _Connection:
    connection = _Connection(_Cursor(existing_roles))
    monkeypatch.setattr(
        migration_sync,
        "_psycopg_connect",
        lambda _url: connection,
    )
    return connection


def test_finance_readonly_role_is_created_without_rds_iam(
    monkeypatch: Any,
) -> None:
    migration_sync = _load_sync_module()
    monkeypatch.delenv("DATABASE_APP_USER_SECRET_ARN", raising=False)
    monkeypatch.delenv("DATABASE_ADMIN_USER_SECRET_ARN", raising=False)
    monkeypatch.setenv(
        "DATABASE_FINANCE_READONLY_SECRET_ARN",
        "arn:aws:secretsmanager:ap-southeast-1:111111111111:secret:finance",
    )
    monkeypatch.setattr(
        migration_sync,
        "_load_db_user_secret",
        lambda _arn: ("evolvesprouts_finance_ro", "pw-1"),
    )
    connection = _install_connection(monkeypatch, migration_sync, set())

    migration_sync._sync_proxy_user_passwords(
        "postgresql://postgres:secret@db.example:5432/evolvesprouts"
    )

    rendered = [query for query, _params in connection._cursor.calls]
    assert connection.committed is True
    assert any(query.startswith("CREATE ROLE") for query in rendered)
    assert not any("rds_iam" in query for query in rendered)
    assert not any("ALTER DEFAULT PRIVILEGES" in query for query in rendered)
    assert 'GRANT CONNECT ON DATABASE "evolvesprouts"' in "\n".join(rendered)
    assert "GRANT USAGE ON SCHEMA public" in "\n".join(rendered)
    select_grants = [
        query for query in rendered if query.startswith("GRANT SELECT ON TABLE")
    ]
    assert len(select_grants) == 1
    for table in (
        "customer_payments",
        "expenses",
        "organizations",
        "customer_invoices",
    ):
        assert f'"{table}"' in select_grants[0]
    assert "evolvesprouts_app" not in select_grants[0]


def test_finance_readonly_password_is_updated_when_role_exists(
    monkeypatch: Any,
) -> None:
    migration_sync = _load_sync_module()
    monkeypatch.delenv("DATABASE_APP_USER_SECRET_ARN", raising=False)
    monkeypatch.delenv("DATABASE_ADMIN_USER_SECRET_ARN", raising=False)
    monkeypatch.setenv("DATABASE_FINANCE_READONLY_SECRET_ARN", "arn:finance")
    monkeypatch.setattr(
        migration_sync,
        "_load_db_user_secret",
        lambda _arn: ("evolvesprouts_finance_ro", "pw-2"),
    )
    connection = _install_connection(
        monkeypatch,
        migration_sync,
        {"evolvesprouts_finance_ro"},
    )

    migration_sync._sync_proxy_user_passwords(
        "postgresql://postgres:secret@db.example:5432/evolvesprouts"
    )

    rendered = [query for query, _params in connection._cursor.calls]
    assert any(query.startswith("ALTER ROLE") for query in rendered)
    assert not any(query.startswith("CREATE ROLE") for query in rendered)
    assert not any("rds_iam" in query for query in rendered)
    assert any(query.startswith("GRANT SELECT ON TABLE") for query in rendered)


def test_finance_readonly_secret_rejects_unexpected_username(
    monkeypatch: Any,
) -> None:
    migration_sync = _load_sync_module()
    monkeypatch.delenv("DATABASE_APP_USER_SECRET_ARN", raising=False)
    monkeypatch.delenv("DATABASE_ADMIN_USER_SECRET_ARN", raising=False)
    monkeypatch.setenv("DATABASE_FINANCE_READONLY_SECRET_ARN", "arn:finance")
    monkeypatch.setattr(
        migration_sync,
        "_load_db_user_secret",
        lambda _arn: ("evolvesprouts_app", "pw-3"),
    )
    connection = _install_connection(monkeypatch, migration_sync, set())

    try:
        migration_sync._sync_proxy_user_passwords(
            "postgresql://postgres:secret@db.example:5432/evolvesprouts"
        )
    except RuntimeError as exc:
        assert "Unexpected database user" in str(exc)
    else:
        raise AssertionError("expected unexpected username to be rejected")

    assert connection._cursor.calls == []
    assert connection.committed is False


def test_finance_readonly_sync_skips_when_secret_arn_is_unset(
    monkeypatch: Any,
) -> None:
    migration_sync = _load_sync_module()
    monkeypatch.delenv("DATABASE_APP_USER_SECRET_ARN", raising=False)
    monkeypatch.delenv("DATABASE_ADMIN_USER_SECRET_ARN", raising=False)
    monkeypatch.delenv("DATABASE_FINANCE_READONLY_SECRET_ARN", raising=False)
    called = False

    def _connect(_url: str) -> Any:
        nonlocal called
        called = True
        raise AssertionError("database connection is not required")

    monkeypatch.setattr(migration_sync, "_psycopg_connect", _connect)

    migration_sync._sync_proxy_user_passwords(
        "postgresql://postgres:secret@db.example:5432/evolvesprouts"
    )

    assert called is False


def test_sql_literal_quotes_finance_password() -> None:
    statement = sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD {}").format(
        sql.Identifier("evolvesprouts_finance_ro"),
        sql.Literal("pw'quoted"),
    )
    rendered = statement.as_string(None)
    assert "rds_iam" not in rendered
    assert "pw''quoted" in rendered or "pw\\'quoted" in rendered
