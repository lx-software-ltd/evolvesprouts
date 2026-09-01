"""Track async lead AI suggestion generation jobs with timing.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new table only; seed SQL does not insert AI suggestion jobs.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — no renamed or dropped columns.
4. New table evaluated: jobs are created on demand by admins; no seed rows.
5. No enum changes (status stored as string).
6. FKs to ``sales_leads`` and ``sales_lead_ai_suggestions`` with ON DELETE CASCADE;
   no seed insert order impact.

Result: No seed SQL update.

Revision id: ``0081_lead_ai_suggestion_jobs`` (28 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0081_lead_ai_suggestion_jobs"
down_revision: Union[str, None] = "0080_lead_ai_suggestions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sales_lead_ai_suggestion_jobs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("suggestion_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("timezone('utc', now())"),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "finished_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("timezone('utc', now())"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["lead_id"],
            ["sales_leads.id"],
            name="sales_lead_ai_suggestion_jobs_lead_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["suggestion_id"],
            ["sales_lead_ai_suggestions.id"],
            name="sales_lead_ai_suggestion_jobs_suggestion_id_fkey",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="sales_lead_ai_suggestion_jobs_pkey"),
    )
    op.create_index(
        "sales_lead_ai_suggestion_jobs_lead_created_idx",
        "sales_lead_ai_suggestion_jobs",
        ["lead_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "sales_lead_ai_suggestion_jobs_status_idx",
        "sales_lead_ai_suggestion_jobs",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "sales_lead_ai_suggestion_jobs_status_idx",
        table_name="sales_lead_ai_suggestion_jobs",
    )
    op.drop_index(
        "sales_lead_ai_suggestion_jobs_lead_created_idx",
        table_name="sales_lead_ai_suggestion_jobs",
    )
    op.drop_table("sales_lead_ai_suggestion_jobs")
