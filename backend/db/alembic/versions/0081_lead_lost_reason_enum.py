"""Convert ``sales_leads.lost_reason`` from free text to a controlled enum.

Allowed values: price_too_high, value_not_understood, ghosted,
language_mismatch, other.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: seed SQL does not insert sales_leads rows with lost_reason.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — column remains nullable; type narrows from text to enum.
4. No new tables.
5. Enum/allowed-value changes: existing free-text lost_reason values that
   are not in the controlled vocabulary are remapped to ``other`` before
   the type change. No seed rows reference lost_reason.
6. No FK/cascade changes.

Result: No seed SQL update.

Revision id: ``0081_lead_lost_reason_enum`` (26 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0081_lead_lost_reason_enum"
down_revision: Union[str, None] = "0080_lead_ai_suggestions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEAD_LOST_REASON_VALUES = (
    "price_too_high",
    "value_not_understood",
    "ghosted",
    "language_mismatch",
    "other",
)


def upgrade() -> None:
    lead_lost_reason = sa.Enum(
        *_LEAD_LOST_REASON_VALUES,
        name="lead_lost_reason",
    )
    lead_lost_reason.create(op.get_bind(), checkfirst=True)

    # Normalize legacy free-text reasons before casting to the enum.
    op.execute(
        sa.text(
            """
            UPDATE sales_leads
            SET lost_reason = CASE
                WHEN lower(trim(lost_reason)) = 'price_too_high' THEN 'price_too_high'
                WHEN lower(trim(lost_reason)) = 'value_not_understood'
                    THEN 'value_not_understood'
                WHEN lower(trim(lost_reason)) = 'ghosted' THEN 'ghosted'
                WHEN lower(trim(lost_reason)) = 'language_mismatch'
                    THEN 'language_mismatch'
                WHEN lower(trim(lost_reason)) = 'other' THEN 'other'
                WHEN lost_reason IS NULL OR trim(lost_reason) = '' THEN NULL
                ELSE 'other'
            END
            WHERE lost_reason IS NOT NULL
            """
        )
    )

    op.execute(
        sa.text(
            """
            ALTER TABLE sales_leads
            ALTER COLUMN lost_reason TYPE lead_lost_reason
            USING lost_reason::lead_lost_reason
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            ALTER TABLE sales_leads
            ALTER COLUMN lost_reason TYPE text
            USING lost_reason::text
            """
        )
    )
    sa.Enum(name="lead_lost_reason").drop(op.get_bind(), checkfirst=True)
