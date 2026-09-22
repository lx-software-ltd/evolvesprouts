"""Org-wide insight item state, backfilled from per-plan ticks.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new on-demand table; seed SQL does not insert daily plans,
   completions, or annotations.
2. No new NOT NULL columns on existing seed-backed tables.
3. Drops ``sales_daily_plan_priority_completions`` after copying rows. That
   table is not referenced by seed SQL.
4. New table evaluated: no seed rows (created when an admin ticks, dismisses,
   or snoozes an insight item).
5. No PostgreSQL enum types (allowed values are CHECK constraints).
6. ``source_plan_id`` uses ``ON DELETE SET NULL``, so deleting a plan keeps
   item state. No seed insert-order impact.

Result: No seed SQL update.

Revision id: ``0091_insight_item_state`` (23 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0091_insight_item_state"
down_revision: Union[str, None] = "0090_insight_board"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TITLE_SQL = (
    "btrim(regexp_replace(regexp_replace(lower({expr}), "
    "'[^[:alnum:][:space:]]', ' ', 'g'), '[[:space:]]+', ' ', 'g'))"
)


def upgrade() -> None:
    op.create_table(
        "sales_daily_plan_item_states",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("item_identity", sa.Text(), nullable=False),
        sa.Column("item_kind", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("priority_kind", sa.Text(), nullable=True),
        sa.Column("done_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("done_by", sa.Text(), nullable=True),
        sa.Column("done_until", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("dismissed_until", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("snoozed_until", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("source_plan_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "item_kind IN ('priority', 'outreach')",
            name="sdp_item_states_kind_chk",
        ),
        sa.CheckConstraint(
            "feedback IS NULL OR feedback IN ('up', 'down', 'not_relevant')",
            name="sdp_item_states_feedback_chk",
        ),
        sa.ForeignKeyConstraint(
            ["source_plan_id"],
            ["sales_daily_plans.id"],
            name="sdp_item_states_plan_fk",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="sdp_item_states_pkey"),
        sa.UniqueConstraint("item_identity", name="sdp_item_states_identity_uidx"),
    )
    op.create_index(
        "sdp_item_states_done_until_idx",
        "sales_daily_plan_item_states",
        ["done_until"],
    )
    op.create_index(
        "sdp_item_states_snoozed_until_idx",
        "sales_daily_plan_item_states",
        ["snoozed_until"],
    )
    op.create_index(
        "sdp_item_states_updated_idx",
        "sales_daily_plan_item_states",
        ["updated_at"],
    )
    op.execute(
        """
        INSERT INTO sales_daily_plan_item_states (
            item_identity, item_kind, title, lead_id, invoice_id,
            done_at, done_by, done_until, source_plan_id, updated_by, updated_at
        )
        SELECT DISTINCT ON (item_identity)
            item_identity,
            'priority',
            title,
            lead_id,
            invoice_id,
            done_at,
            done_by,
            done_at + interval '1 day',
            plan_id,
            done_by,
            done_at
        FROM (
            SELECT
                title,
                lead_id,
                invoice_id,
                done_at,
                done_by,
                plan_id,
                CASE
                    WHEN invoice_id IS NOT NULL THEN 'invoice:' || invoice_id::text
                    WHEN lead_id IS NOT NULL
                        THEN 'lead:' || lead_id::text || ':' || 'any'
                    ELSE 'title:' || """
        + _TITLE_SQL.format(expr="title")
        + """
                END AS item_identity
            FROM sales_daily_plan_priority_completions
        ) keyed
        WHERE item_identity <> 'title:'
        ORDER BY item_identity, done_at DESC
        """
    )
    op.execute(
        """
        INSERT INTO sales_daily_plan_item_states (
            item_identity, item_kind, title, lead_id, invoice_id, conversation_id,
            feedback, dismissed_until, snoozed_until, source_plan_id,
            updated_by, updated_at
        )
        SELECT DISTINCT ON (item_identity)
            item_identity,
            item_kind,
            COALESCE(NULLIF(btrim(title), ''), item_identity),
            lead_id,
            invoice_id,
            conversation_id,
            feedback,
            dismissed_until,
            snoozed_until,
            plan_id,
            updated_by,
            updated_at
        FROM (
            SELECT
                item_kind,
                plan_id,
                updated_by,
                updated_at,
                CASE
                    WHEN feedback IN ('down', 'not_relevant') THEN feedback
                    ELSE NULL
                END AS feedback,
                CASE
                    WHEN feedback IN ('down', 'not_relevant')
                        THEN updated_at + interval '30 days'
                    ELSE NULL
                END AS dismissed_until,
                snoozed_until,
                CASE
                    WHEN item_kind = 'priority'
                        AND split_part(item_key, E'\\n', 3)
                            ~ '^[0-9a-fA-F-]{36}$'
                        THEN 'invoice:' || split_part(item_key, E'\\n', 3)
                    WHEN item_kind = 'priority'
                        AND split_part(item_key, E'\\n', 2)
                            ~ '^[0-9a-fA-F-]{36}$'
                        THEN 'lead:' || split_part(item_key, E'\\n', 2) || ':' || 'any'
                    WHEN item_kind = 'priority'
                        THEN 'title:' || """
        + _TITLE_SQL.format(expr="split_part(item_key, E'\\n', 1)")
        + """
                    WHEN split_part(item_key, E'\\n', 3) ~ '^[0-9a-fA-F-]{36}$'
                        THEN 'conversation:' || split_part(item_key, E'\\n', 3)
                    WHEN split_part(item_key, E'\\n', 2) ~ '^[0-9a-fA-F-]{36}$'
                        THEN 'lead:' || split_part(item_key, E'\\n', 2)
                            || ':' || 'outreach'
                    ELSE 'excerpt:' || lower(
                        COALESCE(
                            NULLIF(btrim(split_part(item_key, E'\\n', 1)), ''),
                            'unknown'
                        )
                    ) || CASE
                        WHEN """
        + _TITLE_SQL.format(expr="split_part(item_key, E'\\n', 4)")
        + """ = '' THEN ''
                        ELSE ':' || """
        + _TITLE_SQL.format(expr="split_part(item_key, E'\\n', 4)")
        + """
                    END
                END AS item_identity,
                CASE
                    WHEN item_kind = 'priority'
                        THEN split_part(item_key, E'\\n', 1)
                    ELSE left(split_part(item_key, E'\\n', 4), 240)
                END AS title,
                CASE
                    WHEN split_part(item_key, E'\\n', 2) ~ '^[0-9a-fA-F-]{36}$'
                        THEN split_part(item_key, E'\\n', 2)::uuid
                    ELSE NULL
                END AS lead_id,
                CASE
                    WHEN item_kind = 'priority'
                        AND split_part(item_key, E'\\n', 3) ~ '^[0-9a-fA-F-]{36}$'
                        THEN split_part(item_key, E'\\n', 3)::uuid
                    ELSE NULL
                END AS invoice_id,
                CASE
                    WHEN item_kind = 'outreach'
                        AND split_part(item_key, E'\\n', 3) ~ '^[0-9a-fA-F-]{36}$'
                        THEN split_part(item_key, E'\\n', 3)::uuid
                    ELSE NULL
                END AS conversation_id
            FROM sales_daily_plan_item_annotations
            WHERE feedback IN ('down', 'not_relevant')
                OR snoozed_until IS NOT NULL
        ) keyed
        WHERE item_identity NOT IN ('title:', 'excerpt:')
        ORDER BY item_identity, updated_at DESC
        ON CONFLICT (item_identity) DO UPDATE SET
            feedback = COALESCE(
                EXCLUDED.feedback, sales_daily_plan_item_states.feedback
            ),
            dismissed_until = COALESCE(
                EXCLUDED.dismissed_until, sales_daily_plan_item_states.dismissed_until
            ),
            snoozed_until = COALESCE(
                EXCLUDED.snoozed_until, sales_daily_plan_item_states.snoozed_until
            ),
            updated_at = GREATEST(
                sales_daily_plan_item_states.updated_at, EXCLUDED.updated_at
            )
        """
    )
    op.drop_index(
        "sdp_priority_completions_done_at_idx",
        table_name="sales_daily_plan_priority_completions",
    )
    op.drop_table("sales_daily_plan_priority_completions")


def downgrade() -> None:
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
    op.drop_index(
        "sdp_item_states_updated_idx",
        table_name="sales_daily_plan_item_states",
    )
    op.drop_index(
        "sdp_item_states_snoozed_until_idx",
        table_name="sales_daily_plan_item_states",
    )
    op.drop_index(
        "sdp_item_states_done_until_idx",
        table_name="sales_daily_plan_item_states",
    )
    op.drop_table("sales_daily_plan_item_states")
