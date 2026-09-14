"""Insight-board item annotations and follow-up questions.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new on-demand tables only; seed SQL does not insert
   daily plans or insight annotations.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — no renamed or dropped columns.
4. New tables evaluated: annotations and questions are created when an
   admin rates, snoozes, edits a draft, or asks a follow-up; no seed rows.
5. No PostgreSQL enum types (allowed values are CHECK constraints).
6. FK ``ON DELETE CASCADE`` from ``sales_daily_plans``; deleting a plan
   (including memory reset) removes child rows. No seed insert-order impact.

Result: No seed SQL update.

Revision id: ``0090_insight_board`` (18 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0090_insight_board"
down_revision: Union[str, None] = "0089_openrouter_model"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sales_daily_plan_item_annotations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_kind", sa.Text(), nullable=False),
        sa.Column("item_key", sa.Text(), nullable=False),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("snoozed_until", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("draft_reply", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "item_kind IN ('priority', 'outreach')",
            name="sdp_item_annotations_kind_chk",
        ),
        sa.CheckConstraint(
            "feedback IS NULL OR feedback IN ('up', 'down', 'not_relevant')",
            name="sdp_item_annotations_feedback_chk",
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["sales_daily_plans.id"],
            name="sdp_item_annotations_plan_fk",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="sdp_item_annotations_pkey"),
        sa.UniqueConstraint(
            "plan_id",
            "item_kind",
            "item_key",
            name="sdp_item_annotations_plan_item_uidx",
        ),
    )
    op.create_index(
        "sdp_item_annotations_snooze_idx",
        "sales_daily_plan_item_annotations",
        ["snoozed_until"],
        unique=False,
    )
    op.create_table(
        "sales_daily_plan_questions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("asked_by", sa.Text(), nullable=False),
        sa.Column(
            "asked_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("model", sa.String(length=256), nullable=True),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["sales_daily_plans.id"],
            name="sdp_questions_plan_fk",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="sdp_questions_pkey"),
    )
    op.create_index(
        "sdp_questions_plan_asked_idx",
        "sales_daily_plan_questions",
        ["plan_id", "asked_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("sdp_questions_plan_asked_idx", table_name="sales_daily_plan_questions")
    op.drop_table("sales_daily_plan_questions")
    op.drop_index(
        "sdp_item_annotations_snooze_idx",
        table_name="sales_daily_plan_item_annotations",
    )
    op.drop_table("sales_daily_plan_item_annotations")
