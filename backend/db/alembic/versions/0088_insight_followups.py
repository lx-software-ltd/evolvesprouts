"""Insight follow-up: generator display name and priority completions.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: nullable column plus an on-demand table; seed SQL does not
   insert daily plans, jobs, or completions.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — no renamed or dropped columns.
4. New table evaluated: no seed rows (created when an admin ticks a
   priority).
5. No enum changes.
6. FK from completions to ``sales_daily_plans`` is insert-only at runtime;
   seed insert order is unchanged.

Result: No seed SQL update.

Revision id: ``0088_insight_followups`` (21 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0088_insight_followups"
down_revision: Union[str, None] = "0087_sales_daily_plan_memory"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sales_daily_plans",
        sa.Column("generated_by_name", sa.String(length=256), nullable=True),
    )
    op.create_table(
        "sales_daily_plan_priority_completions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("priority_key", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("done_by", sa.Text(), nullable=False),
        sa.Column(
            "done_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["sales_daily_plans.id"],
            name="sdp_priority_completions_plan_fk",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="sdp_priority_completions_pkey"),
        sa.UniqueConstraint(
            "plan_id",
            "priority_key",
            name="sdp_priority_completions_plan_key_uidx",
        ),
    )
    op.create_index(
        "sdp_priority_completions_done_at_idx",
        "sales_daily_plan_priority_completions",
        ["done_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "sdp_priority_completions_done_at_idx",
        table_name="sales_daily_plan_priority_completions",
    )
    op.drop_table("sales_daily_plan_priority_completions")
    op.drop_column("sales_daily_plans", "generated_by_name")
