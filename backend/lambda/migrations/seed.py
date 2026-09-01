"""Seeding helpers for migrations Lambda."""

from __future__ import annotations

from pathlib import Path

from app.db.audit import (
    ALEMBIC_AUDIT_USER_ID,
    migrations_audit_request_id,
    set_psycopg_audit_context,
)

from .utils import _psycopg_connect


def _run_seed(database_url: str, seed_path: str) -> None:
    """Run seed SQL if the file exists."""
    path = Path(seed_path)
    if not path.exists():
        return

    seed_sql = path.read_text(encoding="utf-8")
    if not seed_sql.strip():
        return

    with _psycopg_connect(database_url) as connection:
        with connection.cursor() as cursor:
            set_psycopg_audit_context(
                cursor,
                user_id=ALEMBIC_AUDIT_USER_ID,
                request_id=migrations_audit_request_id(),
            )
            cursor.execute(seed_sql)
        connection.commit()
