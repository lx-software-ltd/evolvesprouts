"""Clean up bad expense rows, fix EPrint100 link, drop expenses.vendor_name.

Data steps (in order):
1. Null `amends_expense_id` pointing at expenses that will be deleted.
2. Collect attachment asset ids for rows to delete, then delete those expenses
   (cascade removes `expense_attachments`), then delete unreferenced assets.
3. Delete expenses whose legacy `vendor_name` is a contact-person
   placeholder (`Contact Person:%`) (and orphan assets same as above).
4. Set `vendor_id` for expenses whose `vendor_name` is 'EPrint100' from the
   active vendor organization named 'EPrint100' (`relationship_type` = vendor,
   `archived_at` IS NULL). Rows are skipped if zero or multiple such orgs exist.
5. Drop column `vendor_name` from `expenses`.

Rows deleted in step 2 match: `vendor_id` IS NULL AND (`vendor_name` IS NULL OR
trim(`vendor_name`) = '').

Seed-data assessment:
1. Seed does not insert expenses; compatible.
2. Dropped column was optional on `expenses` only; seed unaffected.
3. N/A
4. N/A
5. N/A
6. N/A

Result: No seed updates required.

Downgrade: Restores nullable `vendor_name`; cannot restore deleted rows.
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_del_exp_no_vendor"
down_revision: Union[str, None] = "0015_add_client_document_tag"
branch_labels: Union[str, tuple[str, ...], None] = None
depends_on: Union[str, tuple[str, ...], None] = None


def upgrade() -> None:
    """Run expense clean-up, EPrint100 backfill, and drop vendor_name."""
    op.execute(
        """
        UPDATE expenses e
        SET amends_expense_id = NULL
        FROM expenses tgt
        WHERE e.amends_expense_id = tgt.id
          AND (
              (tgt.vendor_id IS NULL
               AND (tgt.vendor_name IS NULL OR trim(tgt.vendor_name) = ''))
              OR trim(tgt.vendor_name) LIKE 'Contact Person:%'
          )
        """
    )

    op.execute(
        """
        CREATE TEMP TABLE IF NOT EXISTS _tmp_expense_attachment_asset_ids (
            id UUID PRIMARY KEY
        ) ON COMMIT DROP
        """
    )
    op.execute("TRUNCATE _tmp_expense_attachment_asset_ids")

    op.execute(
        """
        INSERT INTO _tmp_expense_attachment_asset_ids (id)
        SELECT DISTINCT ea.asset_id
        FROM expense_attachments ea
        WHERE ea.expense_id IN (
            SELECT e.id
            FROM expenses e
            WHERE (e.vendor_id IS NULL
                   AND (e.vendor_name IS NULL OR trim(e.vendor_name) = ''))
               OR trim(e.vendor_name) LIKE 'Contact Person:%'
        )
        ON CONFLICT (id) DO NOTHING
        """
    )

    op.execute(
        """
        DELETE FROM expenses e
        WHERE (e.vendor_id IS NULL
               AND (e.vendor_name IS NULL OR trim(e.vendor_name) = ''))
           OR trim(e.vendor_name) LIKE 'Contact Person:%'
        """
    )

    op.execute(
        """
        DELETE FROM assets a
        WHERE a.id IN (SELECT t.id FROM _tmp_expense_attachment_asset_ids t)
          AND NOT EXISTS (
              SELECT 1 FROM expense_attachments ea WHERE ea.asset_id = a.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM asset_access_grants g WHERE g.asset_id = a.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM asset_share_links sl WHERE sl.asset_id = a.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM service_assets sa WHERE sa.asset_id = a.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM sales_leads sl WHERE sl.asset_id = a.id
          )
        """
    )

    op.execute(
        """
        UPDATE expenses e
        SET vendor_id = v.id
        FROM organizations v
        WHERE e.vendor_id IS NULL
          AND trim(e.vendor_name) = 'EPrint100'
          AND v.relationship_type = 'vendor'
          AND v.archived_at IS NULL
          AND lower(trim(v.name)) = lower(trim('EPrint100'))
          AND (
              SELECT COUNT(*)
              FROM organizations o2
              WHERE o2.relationship_type = 'vendor'
                AND o2.archived_at IS NULL
                AND lower(trim(o2.name)) = lower(trim('EPrint100'))
          ) = 1
        """
    )

    op.drop_column("expenses", "vendor_name")


def downgrade() -> None:
    """Re-add vendor_name; deleted expense data is not restored."""
    op.add_column(
        "expenses",
        sa.Column("vendor_name", sa.String(255), nullable=True),
    )
