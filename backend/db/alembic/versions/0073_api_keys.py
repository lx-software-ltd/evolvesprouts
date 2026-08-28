"""Create ``api_keys`` for hashed public API tokens.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new table only.
2. N/A.
3. N/A.
4. N/A (operators create tokens in Admin; no seed rows).
5. N/A (scope CHECK is ``admin`` / ``user``; no seed rows).
6. N/A (no foreign keys).

Result: No seed updates required.

Revision id: ``0073_api_keys`` (13 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0073_api_keys"
down_revision: Union[str, None] = "0072_whatsapp_messages"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the api_keys table used by the API-token authorizer."""
    op.create_table(
        "api_keys",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "name",
            sa.Text(),
            nullable=False,
            comment="Human-readable label for the token",
        ),
        sa.Column(
            "key_prefix",
            sa.Text(),
            nullable=False,
            comment="First characters of the plaintext token, for display",
        ),
        sa.Column(
            "key_hash",
            sa.Text(),
            nullable=False,
            comment="PBKDF2-HMAC-SHA256 hex digest of the plaintext token",
        ),
        sa.Column(
            "scope",
            sa.Text(),
            nullable=False,
            comment="Access scope: admin (full) or user (read-only)",
        ),
        sa.Column(
            "created_by",
            sa.Text(),
            nullable=True,
            comment="Cognito sub of the admin who created the token",
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "expires_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
            comment="Optional expiry; NULL = does not expire",
        ),
        sa.Column(
            "revoked_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
            comment="Set when the token is revoked; NULL = active",
        ),
        sa.Column(
            "last_used_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.CheckConstraint(
            "scope IN ('admin', 'user')",
            name="api_keys_scope_allowed",
        ),
    )
    op.create_index(
        "api_keys_key_hash_unique",
        "api_keys",
        ["key_hash"],
        unique=True,
    )

    op.execute(
        """
        CREATE TRIGGER api_keys_audit_trigger
        AFTER INSERT OR UPDATE OR DELETE ON api_keys
        FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
        """
    )


def downgrade() -> None:
    """Drop the api_keys table."""
    op.execute("DROP TRIGGER IF EXISTS api_keys_audit_trigger ON api_keys;")
    op.drop_index("api_keys_key_hash_unique", table_name="api_keys")
    op.drop_table("api_keys")
