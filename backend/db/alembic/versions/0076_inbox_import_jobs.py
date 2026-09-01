"""Add ``inbox_import_jobs`` for Meta Graph and WhatsApp export backfills.

Tracks admin-triggered async imports that exceed synchronous API limits.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new operational table only; seed SQL does not insert jobs.
2. NOT NULL columns: job rows are app-created only.
3. N/A.
4. No seed rows for this job queue.
5. Kind/status strings are application-defined; ``meta_channel`` enum is reused.
6. Optional FK to ``assets`` uses ON DELETE SET NULL; insert order is
   asset (when present) then job.

Result: No seed updates required.

Revision id: ``0076_inbox_import_jobs`` (23 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0076_inbox_import_jobs"
down_revision: Union[str, None] = "0075_cover_audit_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_channel = postgresql.ENUM(
    "facebook",
    "instagram",
    name="meta_channel",
    create_type=False,
)


def upgrade() -> None:
    op.create_table(
        "inbox_import_jobs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("channel", _channel, nullable=True),
        sa.Column(
            "attachment_asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("options", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("counters", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("timezone('utc', now())"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("timezone('utc', now())"),
        ),
    )
    op.create_index(
        "inbox_import_jobs_kind_created_idx",
        "inbox_import_jobs",
        ["kind", "created_at"],
    )
    op.execute(
        """
        CREATE TRIGGER inbox_import_jobs_audit_trigger
        AFTER INSERT OR UPDATE OR DELETE ON inbox_import_jobs
        FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS inbox_import_jobs_audit_trigger ON inbox_import_jobs;"
    )
    op.drop_index("inbox_import_jobs_kind_created_idx", table_name="inbox_import_jobs")
    op.drop_table("inbox_import_jobs")
