# Database Audit Logging

This document describes the audit logging implementation for tracking all data changes in the database.

## Writer rule

Admin mutations use two complementary writers:

1. **`set_audit_context` / `session_with_audit`** — stamps PostgreSQL session variables so table triggers write `source=trigger` rows with an actor and request id. Prefer `session_with_audit(user_id, request_id)` for new mutating handlers that need a session plus transaction. Call `set_audit_context` when a session already exists.
2. **`AuditService`** — writes `source=application` rows for custom actions (invoice draft/issue markers, payment events) and for trigger-exempt tables (`calendar_manual_blocks`). Do not also `AuditService.log_create` / `log_update` / `log_delete` for ordinary trigger-covered CRUD; that duplicates rows.

These writers are not interchangeable. A typical billing mutation uses `session_with_audit` (or `set_audit_context`) so row changes are trigger-audited, then `AuditService.log_custom` for the extra business event.

## Overview

The system uses a **hybrid audit logging approach** combining:

1. **Database Triggers** - Automatically capture all INSERT, UPDATE, DELETE operations
2. **Application-Level Context** - Enriches trigger logs with user identity and request ID

This ensures:
- All changes are captured, even direct database modifications
- Business context (who, why) is preserved with each change
- Compliance with audit requirements

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Lambda Handler                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  set_audit_context(session, user_id, request_id)        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Database Operations (CRUD)                  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        PostgreSQL                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           Audit Trigger Function                         │    │
│  │  - Reads app.current_user_id from session               │    │
│  │  - Reads app.current_request_id from session            │    │
│  │  - Captures old/new values as JSONB                     │    │
│  │  - Detects changed fields                               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    audit_log table                       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

### audit_log Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `timestamp` | TIMESTAMPTZ | When the change occurred |
| `table_name` | TEXT | Name of the modified table |
| `record_id` | TEXT | Primary key of the modified record |
| `action` | TEXT | INSERT, UPDATE, or DELETE |
| `user_id` | TEXT | Cognito user sub, `api-key:<id>` for token writes, or a system actor (`system`, `webhook:whatsapp`, `webhook:meta`, `alembic`, `system:sales-daily-plan`) |
| `request_id` | TEXT | Lambda request ID for log correlation |
| `old_values` | JSONB | Previous values (UPDATE/DELETE) |
| `new_values` | JSONB | New values (INSERT/UPDATE) |
| `changed_fields` | TEXT[] | List of fields that changed (UPDATE) |
| `source` | TEXT | 'trigger' or 'application' |
| `ip_address` | TEXT | Client IP (if available) |
| `user_agent` | TEXT | Client user agent (if available) |

### Indexes

- `audit_log_table_record_idx` - Query history for a specific record
- `audit_log_timestamp_idx` - Query by time range
- `audit_log_user_id_idx` - Query user activity
- `audit_log_action_idx` - Filter by action type

## Usage

### Automatic Trigger-Based Auditing

All CRUD operations are automatically audited via database triggers. To include user context:

```python
from app.db.audit import session_with_audit
from app.db.repositories import AssetRepository

with session_with_audit("cognito-user-sub", "lambda-request-id") as session:
    repo = AssetRepository(session)
    asset = repo.get_by_id(asset_id)
    asset.title = "Updated Title"
    repo.update(asset)
```

When a session is already open, call `set_audit_context(session, user_id=..., request_id=...)` instead.

### Application-Level Auditing

For custom actions or additional metadata:

```python
from app.db.audit import AuditService, serialize_for_audit

with Session(get_engine()) as session:
    audit = AuditService(
        session,
        user_id="cognito-user-sub",
        request_id="lambda-request-id",
        ip_address="192.168.1.1",
    )

    # Log a custom action
    audit.log_custom(
        table_name="organization_access_requests",
        record_id=request.id,
        action="APPROVE",
        old_values={"status": "pending"},
        new_values={"status": "approved"},
    )

    session.commit()
```

### Querying Audit Logs

```python
from app.db.audit import AuditLogRepository
from datetime import datetime, timedelta

with Session(get_engine()) as session:
    repo = AuditLogRepository(session)

    # Get history for a specific record
    history = repo.get_record_history("assets", asset_id)

    # Get user activity
    activity = repo.get_user_activity(user_sub, limit=50)

    # Get recent changes to a table
    recent = repo.get_table_activity(
        "assets",
        since=datetime.now() - timedelta(days=7),
        action="DELETE"
    )
```

## Audited Tables

All SQLAlchemy application tables have `audit_trigger_func()` triggers except
`audit_log` (to avoid recursion) and `calendar_manual_blocks` (already written
via `AuditService`; a trigger would duplicate those rows with a null actor).
The admin list filter allow-list is `AUDITABLE_TABLES` in
`backend/src/app/db/auditable_tables.py`.

Composite-PK tables (no `id` column) store `record_id` as colon-joined primary-key
values (revision `0075_cover_audit_tables`). Sensitive fields such as `key_hash`
and `share_token` are redacted in admin audit API responses.

Application-level `AuditService` entries supplement invoice draft/issue flows where noted in code
(for example `DRAFT_CREATED` and `DRAFT_CREATED_CUSTOMIZED` on `customer_invoices` when creating enrollment-based or customized drafts,
`INVOICE_ISSUE_PAYMENT_CREATED` on `customer_payments` when issue inserts a pending inbound stub,
and `DELETE_DRAFT` before a draft invoice row is removed).

**Public reservations:** Trigger-written `audit_log` rows for enrollments and related tables
use `user_id = NULL` (no Cognito actor); correlate using `request_id` from API Gateway. Optional
`AuditService.log_custom` rows (e.g. `PUBLIC_RESERVATION_PERSISTED` on `enrollments`) add
application-sourced markers with details in `new_values`.

## Performance Considerations

1. **Trigger Overhead**: Minimal (~1-2ms per operation)
2. **Storage Growth**: Monitor `audit_log` table size
3. **Query Performance**: Use indexes for efficient queries

### Recommended Retention Policy

Consider implementing a retention policy to manage audit log growth:

```sql
-- Example: Archive logs older than 1 year
DELETE FROM audit_log
WHERE timestamp < NOW() - INTERVAL '1 year';
```

## Security

- **No PII in logs**: User IDs are Cognito subs, not emails
- **Request correlation**: Use `request_id` to correlate with CloudWatch logs
- **Access control**: Only admin users can query audit logs via API
- **Tamper evidence**: Trigger-based logging cannot be bypassed by application code

## Compliance

This implementation supports:

- **SOC 2**: Change tracking and accountability
- **GDPR**: Data processing audit trail
- **Internal policies**: Who changed what, when

## Admin API Endpoints

Audit logs can be queried via the admin API at `/v1/admin/audit-logs`. The admin web
viewer lives under **Audit** at `/audit` (top-level navigation).

The admin UI Actor filter uses the `email` query parameter. Values containing
`@` resolve to a Cognito `sub` via `aws_proxy.invoke('cognito-idp',
'list_users', ...)`. Other values first match known system-actor labels or
stored ids (`System` / `system`, `WhatsApp webhook` / `webhook:whatsapp`,
`Meta webhook` / `webhook:meta`, `Alembic` / `alembic`,
`Sales daily plan schedule` / `system:sales-daily-plan`), then `api_keys.name`
(case-insensitive) which becomes `user_id = api-key:<id>`. The response is an
empty list when no actor matches. List and detail responses may include
optional `user_email`: Cognito email for human actors, the API key `name`
(raw) for `api-key:<id>` writes, or a system-actor label for webhook and other
automated writers.

WhatsApp and Meta Cloud API webhooks set `set_audit_context` with
`user_id = webhook:whatsapp` or `webhook:meta` before ingest so trigger-written
rows (including `whatsapp_conversations` updates) show an actor. Historical
rows written before that context exist keep a null `user_id`. Inbound invoice
ingest already stores `user_id = system`. Deploy-time Alembic DML, seed SQL,
and migrations-Lambda country sync set `user_id = alembic` (display label
**Alembic**). The 06:00 HKT sales daily plan scheduler sets
`user_id = system:sales-daily-plan` (display label **Sales daily plan schedule**).

For full endpoint details (parameters, request/response schemas), see the
OpenAPI spec: [`docs/api/admin.yaml`](../api/admin.yaml) — search for
`/v1/admin/audit-logs`.

**Note:** Sensitive fields (password, secret, token, api_key) are
automatically redacted from `old_values` and `new_values` in API responses.

### Sales lead event metadata (public reservations)

`POST /v1/reservations` creates a `PROGRAM_ENROLLMENT` sales lead with a
`CREATED` lead event whose `metadata` JSON may include (when present on the
request): `payment_method`, `title`, `locale`, `service_key`, `service_type`,
`service_instance_slug`, `service_instance_cohort`, `booking_system`, `discount_code`,
`discount_code_id`.
These keys are application-defined payloads on the lead event, not columns on
`audit_log`; they are useful for support triage and should stay aligned with the
current public reservation OpenAPI (`docs/api/public.yaml`).

---

## Migration

The `audit_log` table and shared trigger function `audit_trigger_func()` are created by
Alembic revision `0054_add_audit_log` in `backend/db/alembic/versions/0054_add_audit_log.py`
(`down_revision`: `0053_manual_block_audit`). That revision attaches triggers to `assets`
and `asset_access_grants`.

Customer billing (AR) tables receive the same `audit_trigger_func()` triggers from revision
`0055_customer_billing_ar` (`down_revision`: `0054_add_audit_log`); that migration does not
recreate `audit_log`. Later revisions attach the same function to `completion_certificates`
(`0070`) and `api_keys` (`0073`). Revision `0075_cover_audit_tables` replaces
`audit_trigger_func()` so composite primary keys work, then attaches triggers to the
remaining application tables.

To apply:
```bash
cd backend/db
alembic upgrade head
```

To rollback `audit_log` and asset triggers (leaves prior revisions applied):
```bash
cd backend/db
alembic downgrade 0053_manual_block_audit
```

To rollback only the billing schema after `0055_customer_billing_ar` is applied:
```bash
cd backend/db
alembic downgrade 0054_add_audit_log
```

## Admin read endpoints without audit rows

Some admin GET endpoints return operational data without inserting application audit rows
(for example `GET /v1/admin/billing/enrollments/recent-for-invoicing`). Access remains gated by
API Gateway admin authorization; whether to add explicit read-access audit logging for bulk PII
exports is a product decision tracked separately.
