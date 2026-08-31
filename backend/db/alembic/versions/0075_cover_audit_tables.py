"""Attach audit triggers to remaining application tables.

Replaces ``audit_trigger_func()`` so composite-PK tables (no ``id`` column)
store ``record_id`` as colon-joined primary-key values.

Seed-data assessment (``backend/db/seed/seed_data.sql``):
1. Compatible: trigger + function only; no schema/data change.
2. N/A.
3. N/A.
4. N/A (``audit_log`` remains append-only operational data).
5. N/A.
6. N/A.

Result: No seed updates required.

Revision id: ``0075_cover_audit_tables`` (23 chars, <= 32).
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0075_cover_audit_tables"
down_revision: Union[str, None] = "0074_meta_conversations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen snapshot of tables that lacked audit triggers before this revision.
_NEW_AUDIT_TRIGGER_TABLES: tuple[str, ...] = (
    "asset_share_links",
    "asset_tags",
    "bulk_expense_import_jobs",
    "consultation_details",
    "contact_tags",
    "contacts",
    "discount_codes",
    "document_counters",
    "enrollments",
    "event_details",
    "event_ticket_tiers",
    "expense_attachments",
    "expenses",
    "families",
    "family_members",
    "family_tags",
    "geographic_areas",
    "inbound_emails",
    "instance_session_slots",
    "legacy_import_refs",
    "locations",
    "meta_conversations",
    "meta_messages",
    "notes",
    "organization_members",
    "organization_tags",
    "organizations",
    "sales_lead_events",
    "sales_leads",
    "service_assets",
    "service_instance_organizations",
    "service_instance_tags",
    "service_instances",
    "service_tags",
    "services",
    "tags",
    "training_course_details",
    "training_instance_details",
    "whatsapp_conversations",
    "whatsapp_messages",
)

_AUDIT_TRIGGER_FUNC = """
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
    record_id_val TEXT;
    old_data JSONB;
    new_data JSONB;
    row_data JSONB;
    changed_cols TEXT[];
    col_name TEXT;
    current_user_id TEXT;
    current_request_id TEXT;
BEGIN
    current_user_id := current_setting('app.current_user_id', true);
    current_request_id := current_setting('app.current_request_id', true);

    IF TG_OP = 'DELETE' THEN
        row_data := to_jsonb(OLD);
    ELSE
        row_data := to_jsonb(NEW);
    END IF;

    IF row_data ? 'id' AND COALESCE(row_data->>'id', '') <> '' THEN
        record_id_val := row_data->>'id';
    ELSE
        SELECT string_agg(row_data ->> a.attname, ':' ORDER BY x.ord)
        INTO record_id_val
        FROM pg_index i
        JOIN unnest(i.indkey) WITH ORDINALITY AS x(attnum, ord) ON true
        JOIN pg_attribute a
            ON a.attrelid = i.indrelid AND a.attnum = x.attnum
        WHERE i.indrelid = TG_RELID AND i.indisprimary;
    END IF;

    IF record_id_val IS NULL OR record_id_val = '' THEN
        record_id_val := TG_TABLE_NAME;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        old_data := to_jsonb(OLD);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        new_data := to_jsonb(NEW);
    END IF;

    IF TG_OP = 'UPDATE' THEN
        changed_cols := ARRAY[]::TEXT[];
        FOR col_name IN
            SELECT key FROM jsonb_object_keys(new_data) AS key
        LOOP
            IF (old_data->col_name) IS DISTINCT FROM (new_data->col_name) THEN
                changed_cols := array_append(changed_cols, col_name);
            END IF;
        END LOOP;

        IF array_length(changed_cols, 1) IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO audit_log (
        table_name,
        record_id,
        action,
        user_id,
        request_id,
        old_values,
        new_values,
        changed_fields,
        source
    ) VALUES (
        TG_TABLE_NAME,
        record_id_val,
        TG_OP,
        NULLIF(current_user_id, ''),
        NULLIF(current_request_id, ''),
        old_data,
        new_data,
        changed_cols,
        'trigger'
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
"""


def upgrade() -> None:
    op.execute(_AUDIT_TRIGGER_FUNC)
    for table_name in _NEW_AUDIT_TRIGGER_TABLES:
        op.execute(
            f"""
            CREATE TRIGGER {table_name}_audit_trigger
            AFTER INSERT OR UPDATE OR DELETE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
            """
        )


def downgrade() -> None:
    for table_name in _NEW_AUDIT_TRIGGER_TABLES:
        op.execute(
            f"DROP TRIGGER IF EXISTS {table_name}_audit_trigger ON {table_name};"
        )
    # Restore the ``id``-only record_id behaviour from ``0054_add_audit_log``.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_trigger_func()
        RETURNS TRIGGER AS $$
        DECLARE
            record_id_val TEXT;
            old_data JSONB;
            new_data JSONB;
            changed_cols TEXT[];
            col_name TEXT;
            current_user_id TEXT;
            current_request_id TEXT;
        BEGIN
            current_user_id := current_setting('app.current_user_id', true);
            current_request_id := current_setting('app.current_request_id', true);

            IF TG_OP = 'DELETE' THEN
                record_id_val := OLD.id::text;
            ELSE
                record_id_val := NEW.id::text;
            END IF;

            IF TG_OP IN ('UPDATE', 'DELETE') THEN
                old_data := to_jsonb(OLD);
            END IF;

            IF TG_OP IN ('INSERT', 'UPDATE') THEN
                new_data := to_jsonb(NEW);
            END IF;

            IF TG_OP = 'UPDATE' THEN
                changed_cols := ARRAY[]::TEXT[];
                FOR col_name IN
                    SELECT key FROM jsonb_object_keys(new_data) AS key
                LOOP
                    IF (old_data->col_name) IS DISTINCT FROM (new_data->col_name) THEN
                        changed_cols := array_append(changed_cols, col_name);
                    END IF;
                END LOOP;

                IF array_length(changed_cols, 1) IS NULL THEN
                    RETURN NEW;
                END IF;
            END IF;

            INSERT INTO audit_log (
                table_name,
                record_id,
                action,
                user_id,
                request_id,
                old_values,
                new_values,
                changed_fields,
                source
            ) VALUES (
                TG_TABLE_NAME,
                record_id_val,
                TG_OP,
                NULLIF(current_user_id, ''),
                NULLIF(current_request_id, ''),
                old_data,
                new_data,
                changed_cols,
                'trigger'
            );

            RETURN COALESCE(NEW, OLD);
        END;
        $$ LANGUAGE plpgsql;
        """
    )
