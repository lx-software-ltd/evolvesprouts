"""Add open funnel stage ``unqualified`` and Helper Detector sales setting.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: additive enum label + nullable-default column; seed SQL does not
   insert ``sales_leads`` or ``sales_settings`` rows beyond migration defaults.
2. New NOT NULL column uses server default ``false``; existing singleton row is
   updated safely without seed changes.
3. N/A — no renamed or dropped columns.
4. N/A — no new tables requiring seed rows.
5. Additive enum value ``unqualified``; no existing seed rows reference funnel
   stages that need rewriting.
6. N/A — no FK changes.

Result: No seed SQL update.

Revision id: ``0079_helper_detector`` (20 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0079_helper_detector"
down_revision: Union[str, None] = "0078_sales_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE funnel_stage ADD VALUE IF NOT EXISTS 'unqualified'")
    op.add_column(
        "sales_settings",
        sa.Column(
            "helper_detector_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("sales_settings", "helper_detector_enabled")
    # PostgreSQL enum value removals are intentionally not attempted.
