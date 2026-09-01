"""Link issued customer invoices to restricted assets.

Adds ``customer_invoices.asset_id``, the reserved ``customer_invoice`` tag,
backfills assets for issued/void invoices that already have a PDF, and forces
existing ``expense_attachment`` assets to ``restricted`` visibility.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: new nullable FK only; seed SQL has no ``customer_invoices`` rows.
2. No new NOT NULL columns on existing seed-backed tables.
3. N/A — no renamed or dropped columns.
4. No new tables; ``customer_invoice`` tag is inserted like other system tags.
5. No enum changes.
6. FK insert order is asset then invoice ``asset_id``; seed has no invoice rows.

Result: Seed updated to insert the ``customer_invoice`` system tag.

Revision id: ``0077_invoice_assets`` (19 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0077_invoice_assets"
down_revision: Union[str, None] = "0076_inbox_import_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO tags (id, name, created_by)
        SELECT gen_random_uuid(), 'customer_invoice', 'system'
        WHERE NOT EXISTS (
            SELECT 1 FROM tags WHERE lower(name) = lower('customer_invoice')
        )
        """
    )
    op.add_column(
        "customer_invoices",
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "customer_invoices_asset_id_fkey",
        "customer_invoices",
        "assets",
        ["asset_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "customer_invoices_asset_id_uidx",
        "customer_invoices",
        ["asset_id"],
        unique=True,
        postgresql_where=sa.text("asset_id IS NOT NULL"),
    )
    op.execute(
        """
        UPDATE assets AS a
        SET visibility = 'restricted'
        FROM asset_tags AS at
        JOIN tags AS t ON t.id = at.tag_id
        WHERE at.asset_id = a.id
          AND lower(t.name) = 'expense_attachment'
          AND a.visibility <> 'restricted'
        """
    )
    op.execute(
        """
        UPDATE customer_invoices AS ci
        SET asset_id = a.id
        FROM assets AS a
        WHERE ci.asset_id IS NULL
          AND ci.issued_pdf_s3_key IS NOT NULL
          AND btrim(ci.issued_pdf_s3_key) <> ''
          AND a.s3_key = ci.issued_pdf_s3_key
        """
    )
    op.execute(
        """
        WITH to_create AS (
            SELECT
                ci.id AS invoice_id,
                gen_random_uuid() AS asset_id,
                left(
                    CASE
                        WHEN ci.bill_to_display_name IS NOT NULL
                             AND btrim(ci.bill_to_display_name) <> ''
                        THEN concat(
                            coalesce(nullif(btrim(ci.invoice_number), ''), 'Invoice'),
                            ' — ',
                            btrim(ci.bill_to_display_name)
                        )
                        ELSE coalesce(nullif(btrim(ci.invoice_number), ''), 'Invoice')
                    END,
                    255
                ) AS title,
                left(
                    concat(
                        coalesce(nullif(btrim(ci.invoice_number), ''), 'invoice'),
                        '.pdf'
                    ),
                    255
                ) AS file_name,
                ci.issued_pdf_s3_key AS s3_key
            FROM customer_invoices AS ci
            WHERE ci.asset_id IS NULL
              AND ci.issued_pdf_s3_key IS NOT NULL
              AND btrim(ci.issued_pdf_s3_key) <> ''
        ),
        inserted AS (
            INSERT INTO assets (
                id,
                title,
                description,
                asset_type,
                s3_key,
                file_name,
                content_type,
                visibility,
                created_by
            )
            SELECT
                asset_id,
                title,
                'Customer invoice',
                'document',
                s3_key,
                file_name,
                'application/pdf',
                'restricted',
                'system'
            FROM to_create
            RETURNING id
        )
        UPDATE customer_invoices AS ci
        SET asset_id = tc.asset_id
        FROM to_create AS tc
        WHERE ci.id = tc.invoice_id
        """
    )
    op.execute(
        """
        INSERT INTO asset_tags (asset_id, tag_id)
        SELECT ci.asset_id, t.id
        FROM customer_invoices AS ci
        JOIN tags AS t ON lower(t.name) = 'customer_invoice'
        WHERE ci.asset_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM asset_tags
        WHERE tag_id IN (
            SELECT id FROM tags WHERE lower(name) = lower('customer_invoice')
        )
        """
    )
    op.drop_index("customer_invoices_asset_id_uidx", table_name="customer_invoices")
    op.drop_constraint(
        "customer_invoices_asset_id_fkey",
        "customer_invoices",
        type_="foreignkey",
    )
    op.execute(
        """
        DELETE FROM assets
        WHERE id IN (
            SELECT asset_id FROM customer_invoices WHERE asset_id IS NOT NULL
        )
        """
    )
    op.drop_column("customer_invoices", "asset_id")
    op.execute(
        """
        DELETE FROM tags
        WHERE lower(name) = lower('customer_invoice')
          AND NOT EXISTS (SELECT 1 FROM contact_tags WHERE tag_id = tags.id)
          AND NOT EXISTS (SELECT 1 FROM family_tags WHERE tag_id = tags.id)
          AND NOT EXISTS (SELECT 1 FROM organization_tags WHERE tag_id = tags.id)
          AND NOT EXISTS (SELECT 1 FROM service_tags WHERE tag_id = tags.id)
          AND NOT EXISTS (SELECT 1 FROM asset_tags WHERE tag_id = tags.id)
        """
    )
