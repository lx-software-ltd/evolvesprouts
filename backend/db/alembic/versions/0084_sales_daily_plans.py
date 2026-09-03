"""Store org-wide AI sales daily plans and generation jobs.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new tables only; seed SQL does not insert daily plans.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — no renamed or dropped columns.
4. New tables evaluated: plans and jobs are generated on demand by admins;
   no seed rows required.
5. No enum changes (job status stored as string).
6. FK from jobs to plans with ON DELETE SET NULL; no seed insert order impact.

Result: No seed SQL update.

Revision id: ``0084_sales_daily_plans`` (22 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0084_sales_daily_plans"
down_revision: Union[str, None] = "0083_contact_job_title"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sales_daily_plans",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
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
            "pipeline_watermark_at",
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
        sa.PrimaryKeyConstraint("id", name="sales_daily_plans_pkey"),
    )
    op.create_index(
        "sales_daily_plans_generated_idx",
        "sales_daily_plans",
        ["generated_at"],
        unique=False,
    )
    op.create_table(
        "sales_daily_plan_jobs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=True),
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
            ["plan_id"],
            ["sales_daily_plans.id"],
            name="sales_daily_plan_jobs_plan_id_fkey",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="sales_daily_plan_jobs_pkey"),
    )
    op.create_index(
        "sales_daily_plan_jobs_created_idx",
        "sales_daily_plan_jobs",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "sales_daily_plan_jobs_status_idx",
        "sales_daily_plan_jobs",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "sales_daily_plan_jobs_status_idx",
        table_name="sales_daily_plan_jobs",
    )
    op.drop_index(
        "sales_daily_plan_jobs_created_idx",
        table_name="sales_daily_plan_jobs",
    )
    op.drop_table("sales_daily_plan_jobs")
    op.drop_index(
        "sales_daily_plans_generated_idx",
        table_name="sales_daily_plans",
    )
    op.drop_table("sales_daily_plans")
