"""Add optional ``job_title`` to CRM contacts.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new nullable column; the seed SQL does not insert into
   ``contacts``.
2. No NOT NULL / CHECK constraint added.
3. N/A — no renamed or dropped columns.
4. N/A — no new table.
5. No enum changes.
6. No FK changes.

Result: No seed SQL update.

Revision id: ``0083_contact_job_title`` (22 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0083_contact_job_title"
down_revision: Union[str, None] = "0082_lead_ai_suggestion_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("contacts", sa.Column("job_title", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("contacts", "job_title")
