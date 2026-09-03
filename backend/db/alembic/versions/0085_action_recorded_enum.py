"""Add ``action_recorded`` to ``lead_event_type`` (own commit).

PostgreSQL rejects using a newly added enum label in the same transaction
(``UnsafeNewEnumValueUsage``). This revision only adds the label; see
``0086_one_open_lead_contact`` for the open-lead merge that inserts it.
``transaction_per_migration=True`` in ``backend/db/alembic/env.py`` commits
between revisions.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: seed SQL does not insert ``sales_leads`` or lead events.
2. N/A — enum label only.
3. N/A — no renamed or dropped columns.
4. N/A — no new table.
5. Enum ``lead_event_type`` gains ``action_recorded``; no seed rows use it.
6. N/A — no FK/cascade changes.

Result: No seed SQL update.

Revision id: ``0085_action_recorded_enum`` (25 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0085_action_recorded_enum"
down_revision: Union[str, None] = "0084_sales_daily_plans"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE lead_event_type ADD VALUE IF NOT EXISTS 'action_recorded'")


def downgrade() -> None:
    # PostgreSQL enum value removals are intentionally not attempted.
    return None
