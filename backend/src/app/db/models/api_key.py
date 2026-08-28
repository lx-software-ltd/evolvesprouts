"""Hashed API tokens for public token-authenticated routes."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TIMESTAMP

from app.db.base import Base


class ApiKey(Base):
    """API token used to authenticate ``/v1/public/*`` requests.

    Only a SHA-256 hash of the token is stored; the plaintext value is
    returned exactly once when the token is created.
    """

    __tablename__ = "api_keys"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('admin', 'user')",
            name="api_keys_scope_allowed",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(
        Text(),
        nullable=False,
        comment="Human-readable label for the token",
    )
    key_prefix: Mapped[str] = mapped_column(
        Text(),
        nullable=False,
        comment="First characters of the plaintext token, for display",
    )
    key_hash: Mapped[str] = mapped_column(
        Text(),
        nullable=False,
        unique=True,
        comment="SHA-256 hex digest of the plaintext token",
    )
    scope: Mapped[str] = mapped_column(
        Text(),
        nullable=False,
        comment="Access scope: admin (full) or user (read-only)",
    )
    created_by: Mapped[str | None] = mapped_column(
        Text(),
        nullable=True,
        comment="Cognito sub of the admin who created the token",
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
        comment="Optional expiry; NULL = does not expire",
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
        comment="Set when the token is revoked; NULL = active",
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
