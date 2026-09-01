"""Add singleton ``sales_settings`` for default lead assignee and notify flag.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new table only; seed SQL does not insert sales settings.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — no renamed or dropped columns.
4. New table evaluated: migration inserts the singleton default row
   (``default_assigned_to`` null, notify off). No seed rows required.
5. No enum changes.
6. No FK changes.

Result: No seed SQL update.

Revision id: ``0078_sales_settings`` (19 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0078_sales_settings"
down_revision: Union[str, None] = "0077_invoice_assets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sales_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("default_assigned_to", sa.String(length=128), nullable=True),
        sa.Column(
            "notify_assignee_on_assignment",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.String(length=128), nullable=True),
        sa.PrimaryKeyConstraint("id", name="sales_settings_pkey"),
        sa.CheckConstraint("id = 1", name="sales_settings_singleton_chk"),
    )
    op.execute(
        """
        INSERT INTO sales_settings (
            id, default_assigned_to, notify_assignee_on_assignment
        )
        VALUES (1, NULL, false)
        """
    )


def downgrade() -> None:
    op.drop_table("sales_settings")
