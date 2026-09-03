"""One automated open sales lead per contact.

Adds ``sales_leads.is_manual`` (admin-created leads may share a contact
with an automated open lead), records ``action_recorded`` on
``lead_event_type``, merges duplicate open leads for the same contact,
and adds partial unique index ``sales_leads_one_open_contact_idx``.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: seed SQL does not insert ``sales_leads`` or lead events.
2. New NOT NULL column ``is_manual`` has server default ``false``.
3. N/A — no renamed or dropped columns.
4. N/A — no new table.
5. Enum ``lead_event_type`` gains ``action_recorded``; no seed rows use it.
6. No FK/cascade changes. Existing open-lead ``lead_id`` pointers
   (notes, events, AI suggestions/jobs, WhatsApp/Meta conversations)
   are reassigned onto the kept lead before extras are deleted.

Result: No seed SQL update.

Revision id: ``0084_one_open_lead_contact`` (26 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0084_one_open_lead_contact"
down_revision: Union[str, None] = "0083_contact_job_title"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OPEN_STAGES = "('new', 'contacted', 'engaged', 'qualified', 'unqualified')"

_MERGE_OPEN_DUPLICATES = f"""
DO $$
DECLARE
  grp RECORD;
  keeper UUID;
  merged UUID[];
BEGIN
  FOR grp IN
    SELECT contact_id
    FROM sales_leads
    WHERE contact_id IS NOT NULL
      AND funnel_stage IN {_OPEN_STAGES}
    GROUP BY contact_id
    HAVING count(*) > 1
  LOOP
    SELECT id INTO keeper
    FROM sales_leads
    WHERE contact_id = grp.contact_id
      AND funnel_stage IN {_OPEN_STAGES}
    ORDER BY
      CASE funnel_stage
        WHEN 'qualified' THEN 4
        WHEN 'engaged' THEN 3
        WHEN 'contacted' THEN 2
        WHEN 'new' THEN 1
        ELSE 0
      END DESC,
      updated_at DESC,
      created_at DESC,
      id ASC
    LIMIT 1;

    SELECT coalesce(array_agg(id), ARRAY[]::uuid[])
    INTO merged
    FROM sales_leads
    WHERE contact_id = grp.contact_id
      AND funnel_stage IN {_OPEN_STAGES}
      AND id <> keeper;

    IF merged IS NULL OR array_length(merged, 1) IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE sales_leads AS keeper_row
    SET
      lead_type = CASE
        WHEN EXISTS (
          SELECT 1 FROM sales_leads
          WHERE id = ANY(merged) AND lead_type = 'program_enrollment'
        ) OR keeper_row.lead_type = 'program_enrollment'
          THEN 'program_enrollment'::lead_type
        WHEN EXISTS (
          SELECT 1 FROM sales_leads
          WHERE id = ANY(merged) AND lead_type = 'consultation'
        ) OR keeper_row.lead_type = 'consultation'
          THEN 'consultation'::lead_type
        WHEN EXISTS (
          SELECT 1 FROM sales_leads
          WHERE id = ANY(merged) AND lead_type = 'partnership'
        ) OR keeper_row.lead_type = 'partnership'
          THEN 'partnership'::lead_type
        WHEN EXISTS (
          SELECT 1 FROM sales_leads
          WHERE id = ANY(merged) AND lead_type = 'event_inquiry'
        ) OR keeper_row.lead_type = 'event_inquiry'
          THEN 'event_inquiry'::lead_type
        WHEN EXISTS (
          SELECT 1 FROM sales_leads
          WHERE id = ANY(merged) AND lead_type = 'free_guide'
        ) OR keeper_row.lead_type = 'free_guide'
          THEN 'free_guide'::lead_type
        ELSE keeper_row.lead_type
      END,
      assigned_to = coalesce(
        keeper_row.assigned_to,
        (
          SELECT assigned_to FROM sales_leads
          WHERE id = ANY(merged) AND assigned_to IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT 1
        )
      ),
      updated_at = now()
    WHERE keeper_row.id = keeper;

    UPDATE notes SET lead_id = keeper WHERE lead_id = ANY(merged);
    UPDATE sales_lead_events SET lead_id = keeper WHERE lead_id = ANY(merged);
    UPDATE sales_lead_ai_suggestions SET lead_id = keeper
      WHERE lead_id = ANY(merged);
    UPDATE sales_lead_ai_suggestion_jobs SET lead_id = keeper
      WHERE lead_id = ANY(merged);
    UPDATE whatsapp_conversations SET lead_id = keeper
      WHERE lead_id = ANY(merged);
    UPDATE meta_conversations SET lead_id = keeper
      WHERE lead_id = ANY(merged);

    DELETE FROM sales_leads WHERE id = ANY(merged);

    INSERT INTO sales_lead_events (
      lead_id, event_type, metadata, created_by
    )
    VALUES (
      keeper,
      'action_recorded',
      jsonb_build_object(
        'source', 'open_lead_backfill',
        'merged_lead_ids', to_jsonb(merged)
      ),
      'system'
    );
  END LOOP;
END $$;
"""


def upgrade() -> None:
    op.add_column(
        "sales_leads",
        sa.Column(
            "is_manual",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.execute("ALTER TYPE lead_event_type ADD VALUE IF NOT EXISTS 'action_recorded'")
    op.execute(_MERGE_OPEN_DUPLICATES)
    op.execute(
        """
        CREATE UNIQUE INDEX sales_leads_one_open_contact_idx
        ON sales_leads (contact_id)
        WHERE contact_id IS NOT NULL
          AND is_manual IS NOT TRUE
          AND funnel_stage IN
          ('new', 'contacted', 'engaged', 'qualified', 'unqualified')
        """
    )


def downgrade() -> None:
    op.drop_index("sales_leads_one_open_contact_idx", table_name="sales_leads")
    op.drop_column("sales_leads", "is_manual")
