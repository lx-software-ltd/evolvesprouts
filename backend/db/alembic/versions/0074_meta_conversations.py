"""Add ``meta_conversations`` / ``meta_messages`` and ``facebook`` contact source.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new tables plus an additive enum value.
2. N/A (no new NOT NULL columns on existing seed tables).
3. N/A.
4. N/A (runtime webhook data; no seed rows required).
5. Existing seed ``contact_source`` values remain valid; ``facebook`` is additive.
6. N/A (FKs point at existing ``contacts`` / ``sales_leads`` rows and are
   nullable, so insert order is unaffected).

Result: No seed updates required.

Revision id: ``0074_meta_conversations`` (23 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0074_meta_conversations"
down_revision: Union[str, None] = "0073_api_keys"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_channel = postgresql.ENUM(
    "facebook",
    "instagram",
    name="meta_channel",
    create_type=False,
)
_message_direction = postgresql.ENUM(
    "inbound",
    "outbound",
    name="meta_message_direction",
    create_type=False,
)


def upgrade() -> None:
    op.execute("ALTER TYPE contact_source ADD VALUE IF NOT EXISTS 'facebook'")
    bind = op.get_bind()
    _channel.create(bind, checkfirst=True)
    _message_direction.create(bind, checkfirst=True)
    op.create_table(
        "meta_conversations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("channel", _channel, nullable=False),
        sa.Column("platform_user_id", sa.String(length=128), nullable=False),
        sa.Column("page_id", sa.String(length=128), nullable=True),
        sa.Column("profile_name", sa.String(length=256), nullable=True),
        sa.Column("contact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("first_inbound_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_message_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "inbound_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "outbound_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["lead_id"], ["sales_leads.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "meta_conversations_channel_user_idx",
        "meta_conversations",
        ["channel", "platform_user_id"],
        unique=True,
    )
    op.create_index(
        "meta_conversations_contact_idx",
        "meta_conversations",
        ["contact_id"],
    )
    op.create_index(
        "meta_conversations_last_message_idx",
        "meta_conversations",
        ["last_message_at"],
    )
    op.create_index(
        "meta_conversations_channel_idx",
        "meta_conversations",
        ["channel"],
    )

    op.create_table(
        "meta_messages",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform_message_id", sa.String(length=256), nullable=False),
        sa.Column("direction", _message_direction, nullable=False),
        sa.Column(
            "message_type",
            sa.String(length=32),
            server_default=sa.text("'text'"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["meta_conversations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "meta_messages_platform_message_id_idx",
        "meta_messages",
        ["platform_message_id"],
        unique=True,
    )
    op.create_index(
        "meta_messages_conversation_idx",
        "meta_messages",
        ["conversation_id", "sent_at"],
    )


def downgrade() -> None:
    op.drop_index("meta_messages_conversation_idx", "meta_messages")
    op.drop_index("meta_messages_platform_message_id_idx", "meta_messages")
    op.drop_table("meta_messages")
    op.drop_index("meta_conversations_channel_idx", "meta_conversations")
    op.drop_index("meta_conversations_last_message_idx", "meta_conversations")
    op.drop_index("meta_conversations_contact_idx", "meta_conversations")
    op.drop_index("meta_conversations_channel_user_idx", "meta_conversations")
    op.drop_table("meta_conversations")
    bind = op.get_bind()
    _message_direction.drop(bind, checkfirst=True)
    _channel.drop(bind, checkfirst=True)
