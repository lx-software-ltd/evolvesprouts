"""Add operator_input memory columns for sales daily plans.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: nullable columns on on-demand tables; seed SQL does not
   insert daily plans or jobs.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — no renamed or dropped columns.
4. No new tables.
5. No enum changes.
6. No FK/cascade changes.

Result: No seed SQL update.

Revision id: ``0087_sales_daily_plan_memory`` (28 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0087_sales_daily_plan_memory"
down_revision: Union[str, None] = "0086_one_open_lead_contact"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sales_daily_plans",
        sa.Column("operator_input", sa.Text(), nullable=True),
    )
    op.add_column(
        "sales_daily_plan_jobs",
        sa.Column("operator_input", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sales_daily_plan_jobs", "operator_input")
    op.drop_column("sales_daily_plans", "operator_input")
