from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from alembic.script import ScriptDirectory
from sqlalchemy import engine_from_config
from sqlalchemy import pool

config = context.config

# Alembic's version_num column is varchar(32) by default
MAX_REVISION_LENGTH = 32


def validate_revision_lengths() -> None:
    """Ensure all revision IDs fit in alembic_version.version_num (varchar(32))."""
    script_dir = ScriptDirectory.from_config(config)
    violations = []
    for script in script_dir.walk_revisions():
        if len(script.revision) > MAX_REVISION_LENGTH:
            violations.append(f"  {script.revision} ({len(script.revision)} chars)")
    if violations:
        raise RuntimeError(
            f"Revision IDs must be ≤{MAX_REVISION_LENGTH} characters:\n"
            + "\n".join(violations)
        )


validate_revision_lengths()

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

base_dir = Path(__file__).resolve().parents[2]
sys.path.append(str(base_dir / "src"))

from app.db.audit import (  # noqa: E402
    ALEMBIC_AUDIT_USER_ID,
    migrations_audit_request_id,
    set_connection_audit_context,
)
from app.db.base import Base  # noqa: E402
from app.db import models  # noqa: F401,E402
from app.db.connection import ensure_database_url_sslmode  # noqa: E402

target_metadata = Base.metadata


def _normalize_sqlalchemy_postgres_url(url: str) -> str:
    """Prefer psycopg v3 (``psycopg``); plain ``postgresql://`` defaults to psycopg2."""
    trimmed = url.strip()
    if not trimmed:
        return trimmed
    if trimmed.startswith("postgresql+") or trimmed.startswith("postgres+"):
        return trimmed
    if trimmed.startswith("postgresql://"):
        return "postgresql+psycopg://" + trimmed.removeprefix("postgresql://")
    if trimmed.startswith("postgres://"):
        return "postgresql+psycopg://" + trimmed.removeprefix("postgres://")
    return trimmed


def get_database_url() -> str:
    """Return the database URL from environment variables."""
    url = config.get_main_option("sqlalchemy.url")
    if not url:
        url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required for Alembic migrations.")
    return ensure_database_url_sslmode(_normalize_sqlalchemy_postgres_url(url))


def _escape_for_config(value: str) -> str:
    """Escape percent signs for configparser interpolation."""
    return value.replace("%", "%%")


def run_migrations_offline() -> None:
    """Run migrations in offline mode."""
    url = get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        # Each revision commits separately so PostgreSQL can use a new enum
        # label added in one migration (e.g. ALTER TYPE ... ADD VALUE) in a
        # later migration (UnsafeNewEnumValueUsage if all run in one txn).
        transaction_per_migration=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in online mode."""
    config.set_main_option("sqlalchemy.url", _escape_for_config(get_database_url()))
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # Session-scoped (not SET LOCAL): Alembic commits per revision.
        set_connection_audit_context(
            connection,
            user_id=ALEMBIC_AUDIT_USER_ID,
            request_id=migrations_audit_request_id(),
            local=False,
        )
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            # Each revision commits separately so PostgreSQL can use a new enum
            # label added in one migration (e.g. ALTER TYPE ... ADD VALUE) in a
            # later migration (UnsafeNewEnumValueUsage if all run in one txn).
            transaction_per_migration=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
