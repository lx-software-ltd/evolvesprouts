"""Add ``whatsapp_conversations`` and ``whatsapp_messages`` for webhook capture.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new tables only.
2. N/A.
3. N/A.
4. N/A (runtime webhook data; no seed rows required).
5. N/A.
6. N/A (FKs point at existing ``contacts`` / ``sales_leads`` rows and are
   nullable, so insert order is unaffected).

Result: No seed updates required.

Revision id: ``0072_whatsapp_messages`` (22 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0072_whatsapp_messages"
down_revision: Union[str, None] = "0071_partner_legal_name"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_message_direction = postgresql.ENUM(
    "inbound",
    "outbound",
    name="whatsapp_message_direction",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    _message_direction.create(bind, checkfirst=True)
    op.create_table(
        "whatsapp_conversations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("wa_id", sa.String(length=32), nullable=False),
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
        "whatsapp_conversations_wa_id_idx",
        "whatsapp_conversations",
        ["wa_id"],
        unique=True,
    )
    op.create_index(
        "whatsapp_conversations_contact_idx",
        "whatsapp_conversations",
        ["contact_id"],
    )
    op.create_index(
        "whatsapp_conversations_last_message_idx",
        "whatsapp_conversations",
        ["last_message_at"],
    )

    op.create_table(
        "whatsapp_messages",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("wa_message_id", sa.String(length=128), nullable=False),
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
            ["whatsapp_conversations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "whatsapp_messages_wa_message_id_idx",
        "whatsapp_messages",
        ["wa_message_id"],
        unique=True,
    )
    op.create_index(
        "whatsapp_messages_conversation_idx",
        "whatsapp_messages",
        ["conversation_id", "sent_at"],
    )


def downgrade() -> None:
    op.drop_index("whatsapp_messages_conversation_idx", "whatsapp_messages")
    op.drop_index("whatsapp_messages_wa_message_id_idx", "whatsapp_messages")
    op.drop_table("whatsapp_messages")
    op.drop_index("whatsapp_conversations_last_message_idx", "whatsapp_conversations")
    op.drop_index("whatsapp_conversations_contact_idx", "whatsapp_conversations")
    op.drop_index("whatsapp_conversations_wa_id_idx", "whatsapp_conversations")
    op.drop_table("whatsapp_conversations")
    bind = op.get_bind()
    _message_direction.drop(bind, checkfirst=True)
