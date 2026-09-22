"""Standing and same-day instructions for insight generation.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new on-demand table; seed SQL does not insert insight rows.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — no renamed or dropped columns.
4. New table evaluated: no seed rows (created when an admin saves a
   refinement).
5. No PostgreSQL enum types (allowed values are a CHECK constraint).
6. No foreign keys. No seed insert-order impact.

Result: No seed SQL update.

Revision id: ``0092_insight_instructions`` (24 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0092_insight_instructions"
down_revision: Union[str, None] = "0091_insight_item_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sales_daily_plan_instructions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("active_until", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("archived_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("archived_by", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "scope IN ('today', 'standing')",
            name="sdp_instructions_scope_chk",
        ),
        sa.PrimaryKeyConstraint("id", name="sdp_instructions_pkey"),
    )
    op.create_index(
        "sdp_instructions_active_idx",
        "sales_daily_plan_instructions",
        ["archived_at", "active_until"],
    )


def downgrade() -> None:
    op.drop_index(
        "sdp_instructions_active_idx",
        table_name="sales_daily_plan_instructions",
    )
    op.drop_table("sales_daily_plan_instructions")
