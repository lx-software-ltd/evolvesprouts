"""Store AI close suggestions per sales lead with conversation watermark.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new table only; seed SQL does not insert AI suggestions.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — no renamed or dropped columns.
4. New table evaluated: suggestions are generated on demand by admins;
   no seed rows required.
5. No enum changes.
6. FK to ``sales_leads`` with ON DELETE CASCADE; no seed insert order impact.

Result: No seed SQL update.

Revision id: ``0080_lead_ai_suggestions`` (24 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0080_lead_ai_suggestions"
down_revision: Union[str, None] = "0079_helper_detector"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sales_lead_ai_suggestions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "conversation_watermark_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "generated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("generated_by", sa.String(length=128), nullable=True),
        sa.Column("model", sa.String(length=256), nullable=True),
        sa.ForeignKeyConstraint(
            ["lead_id"],
            ["sales_leads.id"],
            name="sales_lead_ai_suggestions_lead_id_fkey",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="sales_lead_ai_suggestions_pkey"),
    )
    op.create_index(
        "sales_lead_ai_suggestions_lead_generated_idx",
        "sales_lead_ai_suggestions",
        ["lead_id", "generated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "sales_lead_ai_suggestions_lead_generated_idx",
        table_name="sales_lead_ai_suggestions",
    )
    op.drop_table("sales_lead_ai_suggestions")
