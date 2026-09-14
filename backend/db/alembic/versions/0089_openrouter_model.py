"""Add optional OpenRouter model id on singleton sales settings.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: additive nullable column; seed SQL does not insert
   ``sales_settings`` rows beyond migration defaults.
2. New column is nullable (NULL means Auto); existing singleton row needs no
   seed rewrite.
3. N/A — no renamed or dropped columns.
4. N/A — no new tables requiring seed rows.
5. No enum changes.
6. N/A — no FK changes.

Result: No seed SQL update.

Revision id: ``0089_openrouter_model`` (21 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0089_openrouter_model"
down_revision: Union[str, None] = "0088_insight_followups"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sales_settings",
        sa.Column("openrouter_model", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sales_settings", "openrouter_model")
