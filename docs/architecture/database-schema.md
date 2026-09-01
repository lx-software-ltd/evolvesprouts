# Database Schema

This document describes the PostgreSQL schema for the Evolve Sprouts
backend. It is based on the Alembic migrations.

Alembic migrations live in `backend/db/alembic/versions/`.
The Alembic environment enables `transaction_per_migration` so each revision
commits in its own transaction. That avoids PostgreSQL
`UnsafeNewEnumValueUsage` when one revision adds an enum label and a later
revision in the same upgrade run references that label (for example
`0024_discount_referral_add_enum` then `0025_discount_codes_value_check`).
Seed data lives in `backend/db/seed/seed_data.sql`.

## Extensions and enums

- Extension: `pgcrypto` (used by `gen_random_uuid()` defaults).
- Enum `asset_type`: `guide`, `video`, `pdf`, `document`.
- Enum `asset_visibility`: `public`, `restricted`.
- Enum `access_grant_type`: `all_authenticated`, `organization`, `user`.
- Enum `contact_type`: `parent`, `child`, `helper`, `professional`, `other`.
- Enum `contact_source`: `free_guide`, `newsletter`, `contact_form`,
  `reservation`, `referral`, `instagram`, `facebook`, `manual`, `whatsapp`,
  `linkedin`, `event`, `phone_call`, `public_website`.
- Enum `meta_channel`: `facebook`, `instagram`.
- Enum `meta_message_direction`: `inbound`, `outbound`.
- Enum `relationship_type`: `prospect`, `client`, `past_client`, `partner`,
  `vendor`, `other` (stored on contacts, families, and organizations). Admin API
  write rules narrow allowed values: families may only use `prospect`, `client`,
  or `other`; organizations may not use `past_client`.
- Enum `mailchimp_sync_status`: `pending`, `synced`, `failed`, `unsubscribed`.
- Enum `family_role`: `parent`, `child`, `helper`, `guardian`, `other`.
- Enum `organization_type`: `school`, `company`, `community_group`, `ngo`, `other`.
- Enum `organization_role`: `admin`, `staff`, `teacher`, `member`, `client`,
  `partner`, `other`.
- Enum `lead_type`: `free_guide`, `event_inquiry`, `program_enrollment`,
  `consultation`, `partnership`, `other`.
- Enum `funnel_stage`: `new`, `contacted`, `engaged`, `qualified`, `unqualified`,
  `converted`, `lost`.
- Enum `lead_event_type`: `created`, `stage_changed`, `note_added`, `email_sent`,
  `email_opened`, `guide_downloaded`, `assigned`, `converted`, `lost`.
- Enum `service_type`: `training_course`, `event`, `consultation`, `intro_call`.
- Enum `service_status`: `draft`, `published`, `archived`.
- Enum `service_delivery_mode`: `online`, `in_person`, `hybrid`.
- Enum `training_format`: `group`, `private`.
- Enum `training_pricing_unit`: `per_person`, `per_family`.
- Enum `event_category`: `workshop`, `webinar`, `open_house`,
  `community_meetup`, `other`.
- Enum `consultation_format`: `one_on_one`, `group`.
- Enum `consultation_pricing_model`: `free`, `hourly`, `package`.
- Enum `instance_status`: `scheduled`, `open`, `full`, `in_progress`,
  `completed`, `cancelled`.
- Enum `discount_type`: `percentage`, `absolute`, `referral`.
- Enum `enrollment_status`: `registered`, `waitlisted`, `confirmed`,
  `cancelled`, `completed`.
- Enum `expense_status`: `draft`, `submitted`, `paid`, `voided`, `amended`.
- Enum `expense_parse_status`: `not_requested`, `queued`, `processing`,
  `succeeded`, `failed`.

Migration `0022_remove_crm_tickets` drops the CRM `tickets` table and PostgreSQL
enums `ticket_type` and `ticket_status` (legacy manager access / place-suggestion
workflow). Event service `event_ticket_tiers` and related fields are unchanged.

Migration `0023_services_add_slug` adds nullable `services.slug` (varchar(80)) with
unique partial index `services_slug_unique_idx` on `lower(slug)` where `slug` is not
null (case-insensitive uniqueness for public referral URLs).

Migration `0041_slug_tier_unique` drops `services_slug_unique_idx` and creates
`services_slug_tier_unique_idx` on `(lower(slug), lower(service_tier))` where `slug`
is not null (composite uniqueness; PostgreSQL still treats NULL tiers as distinct until
the next revision).

Migration `0042_slug_nulls_nd` recreates `services_slug_tier_unique_idx` with
`NULLS NOT DISTINCT` so at most one row per slug may have NULL `service_tier`, and
rejects duplicate real tier values case-insensitively. Upgrade runs a guard that fails
when duplicate `(lower(slug), service_tier)` groups already exist among slugged rows.

Migration `0046_services_slug_to_key` renames `services.slug` to `services.service_key`
and renames the composite unique index to `services_service_key_tier_unique_idx`.

Migration `0047_orgs_slug_to_partner_key` renames `organizations.slug` to
`organizations.partner_key` and renames the partial unique index to
`organizations_partner_key_unique_idx`.

Migration `0048_inst_slug_backfill_consult` backfills NULL/empty `service_instances.slug`
values (primarily consultations) with deterministic kebab-case slugs, then asserts no
NULL/empty rows remain.

Migration `0049_inst_slug_not_null` sets `service_instances.slug` to `NOT NULL` after
the backfill succeeds.

Migration `0050_fix_mba_service_key` updates `services.service_key` from the legacy
MBA key string to `my-best-auntie-training-course` for matching training-course
titles (idempotent; aligns with the public booking constant).

Migration `0051_backfill_event_service_key` assigns kebab-case `services.service_key`
values to `event` / `training_course` rows that were missing a key (draft/archived
rows may remain without a key), then asserts no **published** rows in those types
remain without a key.

Migration `0032_services_booking` adds nullable `services.booking_system` (varchar(80))
for an optional admin-visible booking-system label.

## Table: assets

Purpose: Stores asset metadata for files in S3.

Columns:
- `id` (UUID, PK, default `gen_random_uuid()`)
- `title` (varchar(255), required)
- `description` (text, optional)
- `asset_type` (enum `asset_type`, required) — categorization
- `s3_key` (varchar, unique, required) — object key in S3
- `file_name` (varchar(255), required) — original filename
- `resource_key` (varchar(64), optional) — normalized key for media form mapping
- `content_type` (varchar(127), optional) — MIME type
- `content_language` (varchar(35), optional) — BCP 47-style tag for file content
  (e.g. `en`, `zh-HK`); admin create/update allow only `en`, `zh-CN`, and `zh-HK`;
  public `GET /v1/assets/free` list filters accept any valid BCP 47-style tag
- `visibility` (enum `asset_visibility`, required) — access level
- `created_by` (varchar(128), required) — Cognito sub of uploader
- `created_at` (timestamptz, default `now()`)
- `updated_at` (timestamptz, default `now()`)

Object key pattern: `assets/{asset_id}/{uuid}-{sanitized_filename}` for uploaded
files. Issued customer invoice PDFs keep `billing/invoices/{invoice_id}.pdf` and
reuse that key on the linked `assets` row.

Indexes:
- `assets_visibility_idx` on `visibility`
- `assets_asset_type_idx` on `asset_type`
- `assets_created_by_idx` on `created_by`
- `assets_resource_key_unique_idx` unique index on `resource_key` where non-null
- Unique constraint on `s3_key`

## Table: asset_access_grants

Purpose: Controls who can access restricted assets.

Columns:
- `id` (UUID, PK, default `gen_random_uuid()`)
- `asset_id` (UUID, FK → assets.id, cascade delete)
- `grant_type` (enum `access_grant_type`, required) — scope of grant
- `grantee_id` (varchar(128), nullable) — org ID or user sub
  (null for `all_authenticated`)
- `granted_by` (varchar(128), required) — admin who granted
- `created_at` (timestamptz, default `now()`)

Constraints:
- Unique on (`asset_id`, `grant_type`, `COALESCE(grantee_id, '')`)

Indexes:
- `access_grants_asset_idx` on `asset_id`
- `access_grants_grantee_idx` on `grantee_id`
- `access_grants_unique` unique index on
  (`asset_id`, `grant_type`, `COALESCE(grantee_id, '')`)

## Table: audit_log

Purpose: Append-only change history. Rows are written by PostgreSQL triggers on
application tables (when `set_audit_context` supplies session variables) and by
application code via `AuditService` (`source` = `trigger` or `application`).
Created by migration `0054_add_audit_log`; remaining tables received triggers in
`0075_cover_audit_tables` except `audit_log` and `calendar_manual_blocks` (the
latter stays application-sourced). Token-authenticated writes store `user_id` as
`api-key:<id>`.

Columns (summary): `id` (UUID), `timestamp` (timestamptz), `table_name`, `record_id`,
`action`, optional `user_id` / `request_id`, JSONB `old_values` / `new_values`,
`changed_fields` (text array, updates only), `source`, optional `ip_address` /
`user_agent`.

Indexes: `audit_log_table_record_idx`, `audit_log_timestamp_idx`,
`audit_log_user_id_idx`, `audit_log_action_idx`.

## Table: asset_share_links

Purpose: Stores stable bearer links for assets that can be shared externally.

Columns:
- `id` (UUID, PK, default `gen_random_uuid()`)
- `asset_id` (UUID, FK → `assets.id`, cascade delete, unique)
- `share_token` (varchar(128), unique, required)
- `allowed_domains` (varchar(255)[], required) — source domains allowed to
  resolve the share link (no server default; runtime configuration provides
  values)
- `created_by` (varchar(128), required) — admin user sub that created the link
- `created_at` (timestamptz, default `now()`)
- `updated_at` (timestamptz, default `now()`)

Indexes:
- `asset_share_links_asset_idx` unique index on `asset_id`
- `asset_share_links_token_idx` unique index on `share_token`

## Table: asset_tags

Purpose: Associates `tags` rows with `assets` (for example marking files used as
expense invoice attachments).

Columns:
- `asset_id` (UUID, PK, FK → `assets.id`, cascade delete)
- `tag_id` (UUID, PK, FK → `tags.id`, cascade delete)
- `created_at` (timestamptz, default `now()`)

Indexes:
- `asset_tags_tag_idx` on `tag_id`

The `expense_attachment` tag is maintained in application code when
`expense_attachments` rows are created or replaced; migration `0014_add_asset_tags`
backfills from existing `expense_attachments`.

The `client_document` tag is a system tag for admin-assignable client-facing
documents; migration `0015_add_client_document_tag` ensures it exists (seed data
also inserts it for fresh databases).

The `customer_invoice` tag is a reserved system tag for issued (and later voided)
customer invoice PDFs. Migration `0077_invoice_assets` adds
`customer_invoices.asset_id` (nullable unique FK → `assets.id`, `ON DELETE RESTRICT`),
inserts the tag, backfills assets for rows that already have `issued_pdf_s3_key`,
and forces existing `expense_attachment` assets to `visibility = restricted`.
Issuing or refreshing an invoice PDF creates or updates that restricted asset.
Admin list search on assets also matches the linked invoice `bill_to_display_name`
and `invoice_number`. These assets cannot be deleted, have their file replaced, or
be made public.

Migration `0016_delete_expenses_missing_vendor` removes expenses with no vendor
(`vendor_id` null and legacy `vendor_name` null or whitespace-only), removes the
expense with `vendor_name` 'Contact Person: Luca Cacchiani', sets `vendor_id`
from the unique active vendor org named `EPrint100` where `vendor_name` was
`EPrint100` and `vendor_id` was null, deletes orphan attachment assets (same
rules as before), and drops column `expenses.vendor_name`.

## Access control logic

**Public assets** (`visibility = 'public'`):
- Any request (even unauthenticated) gets a CloudFront-signed download URL.
- Servable via the public website or mobile app without login.

**Restricted assets** (`visibility = 'restricted'`):
- User authenticates via Cognito.
- Lambda checks `asset_access_grants` for a matching row:
  - `grant_type = 'all_authenticated'` — any logged-in user
  - `grant_type = 'organization'` + `grantee_id = user's org` — org members
  - `grant_type = 'user'` + `grantee_id = user's sub` — specific user
- If authorized, returns a CloudFront-signed GET URL
  (`ASSET_DOWNLOAD_LINK_EXPIRY_DAYS`, default `9999`).
- If denied, returns 403.
- Admin/Manager always have full access.

## Table: expenses

Purpose: Stores admin-entered expense invoices and parser-enriched fields.

Columns:
- `id` (UUID, PK, default `gen_random_uuid()`)
- `amends_expense_id` (UUID, FK → `expenses.id`, nullable) — source record for amendment history
- `status` (enum `expense_status`, required, default `draft`)
- `parse_status` (enum `expense_parse_status`, required, default `not_requested`)
- `vendor_id` (UUID, FK → `organizations.id`, nullable) — managed vendor selection
- `invoice_number` (varchar(128), optional)
- `invoice_date` (date, optional)
- `due_date` (date, optional)
- `currency` (varchar(3), optional)
- `subtotal`, `tax`, `total` (numeric(12,2), optional)
- `line_items` (jsonb, optional) — normalized parsed/manual line item array
- `parse_confidence` (numeric(4,3), optional, 0..1)
- `parser_raw` (jsonb, optional) — raw parser response payload
- `notes` (text, optional)
- `void_reason` (text, optional)
- `submitted_at`, `paid_at`, `voided_at` (timestamptz, optional)
- `created_by` (varchar(128), required)
- `updated_by` (varchar(128), optional)
- `created_at` / `updated_at` (timestamptz, default `now()`)

Constraints and indexes:
- `expenses_amendment_not_self` prevents self-referencing amendment links
- `expenses_parse_confidence_range` enforces `0..1`
- `expenses_status_idx`, `expenses_parse_status_idx`,
  `expenses_invoice_date_idx`, `expenses_amends_expense_idx`,
  `expenses_vendor_idx`
- `set_updated_at()` trigger updates `updated_at` on write

## Table: bulk_expense_import_jobs

Purpose: Tracks asynchronous combined-PDF bulk imports (OpenRouter extraction + expense creation).

Columns:
- `id` (UUID, PK, default `gen_random_uuid()`)
- `created_by` (text, required) — Cognito `sub` of the admin who queued the job
- `attachment_asset_id` (UUID, FK → `assets.id`, cascade delete)
- `default_vendor_id` (UUID, FK → `organizations.id`, restrict delete)
- `expense_status` (enum `expense_status`, required) — `draft` or `submitted` rows created from parsed data
- `status` (varchar(32), required) — `pending | processing | succeeded | succeeded_with_errors | failed`
- `error_message` (text, optional)
- `created_expense_ids` (jsonb, optional) — ordered UUID strings for created expenses
- `created_count` (integer, optional)
- `created_at` / `updated_at` (timestamptz, default `timezone('utc', now())`)

Indexes:
- `ix_bulk_expense_import_jobs_created_by` on `created_by`
- `ix_bulk_expense_import_jobs_status` on `status`

## Table: expense_attachments

Purpose: Links each expense record to one or more uploaded assets.

Columns:
- `id` (UUID, PK, default `gen_random_uuid()`)
- `expense_id` (UUID, FK → `expenses.id`, cascade delete)
- `asset_id` (UUID, FK → `assets.id`, restrict delete)
- `sort_order` (integer, default `0`)
- `created_at` (timestamptz, default `now()`)

Constraints and indexes:
- Unique index on (`expense_id`, `asset_id`) to avoid duplicate links
- `expense_attachments_expense_idx` on `expense_id`
- `expense_attachments_asset_idx` on `asset_id`

## Table: inbound_emails

Purpose: Tracks SES-managed inbound email processing for idempotency, replay, and
linkage to stored expense records.

Columns:
- `id` (UUID, PK, default `gen_random_uuid()`)
- `ses_message_id` (varchar(255), required, unique) — SES receipt identifier
- `recipient` (varchar(320), required) — matched inbound mailbox address
- `source_email` (varchar(320), nullable) — parsed sender address
- `subject` (varchar(500), nullable)
- `received_at` (timestamptz, required)
- `raw_s3_bucket` (varchar(255), required)
- `raw_s3_key` (text, required) — raw `.eml` object key in the inbound-email bucket
- `spam_status`, `virus_status`, `spf_status`, `dkim_status`, `dmarc_status`
  (varchar(32), nullable) — SES verdict summaries
- `processing_status` (varchar(32), required, default `received`) —
  `received | processing | stored | skipped | failed`
- `failure_reason` (text, nullable)
- `expense_id` (UUID, FK → `expenses.id`, nullable) — created expense linked to the email
- `created_at` / `updated_at` (timestamptz, default `now()`)

Constraints and indexes:
- `inbound_emails_processing_status_check` restricts allowed processing states
- `inbound_emails_ses_message_id_idx` unique index on `ses_message_id`
- `inbound_emails_processing_status_idx` on `processing_status`
- `inbound_emails_expense_id_idx` on `expense_id`
- `set_updated_at()` trigger updates `updated_at` on write

**Stable share links** (tokens in `asset_share_links`; resolved via
`/v1/assets/share/{token}` or `/v1/assets/email-download/{token}`):
- A token in `asset_share_links.share_token` acts as a bearer capability.
- Requests with a valid token resolve the asset and redirect to a fresh
  CloudFront-signed GET URL.
- On `/v1/assets/share/{token}`, requests are accepted only when Referer/Origin
  matches `asset_share_links.allowed_domains`. The email-download path skips
  that check.
- If the resolved asset has `visibility='restricted'`, the request must also
  include a valid Cognito bearer token.
- Admin APIs can create/reuse, rotate, revoke, and update source-domain
  allowlist policy per asset.

## Table: geographic_areas

Purpose: Hierarchical geographic areas used to classify addresses and drive
location selection in admin workflows.

Columns:
- `id` (UUID, PK, default `gen_random_uuid()`)
- `parent_id` (UUID, FK → geographic_areas.id, nullable, cascade delete)
- `name` (text, required)
- `name_translations` (jsonb, required, default `{}`)
- `level` (text, required) — `country | region | city | district`
- `code` (text, nullable) — ISO country code for country rows
- `sovereign_country_id` (UUID, FK → geographic_areas.id, nullable, ON DELETE SET NULL)
  — optional link from a territory country row to its sovereign country row (used when
  composing geocoding `countrycodes`, e.g. HK + CN)
- `active` (boolean, required, default `true`)
- `display_order` (integer, required, default `0`)

Constraints:
- Unique on (`parent_id`, `name`) via `uq_geo_area_parent_name`

Indexes:
- `geo_areas_parent_idx` on `parent_id`
- `geo_areas_level_idx` on `level`
- `geo_areas_code_idx` on `code`

## Table: locations

Purpose: Canonical address/location records referenced by contacts, families,
and organizations.

Admin venues: when an active CRM organisation has `relationship_type = partner`
and points `location_id` at a row, the admin Venues UI treats that venue as
partner-managed (name locked, delete blocked); the API exposes
`locked_from_partner_org` and `partner_organization_labels` on location payloads.

Columns:
- `id` (UUID, PK, default `gen_random_uuid()`)
- `name` (text, nullable) — display label for the venue/location
- `area_id` (UUID, FK → geographic_areas.id, required)
- `address` (text, nullable)
- `lat` (numeric(9,6), nullable)
- `lng` (numeric(9,6), nullable)
- `created_at` (timestamptz, default `now()`)
- `updated_at` (timestamptz, default `now()`)

Indexes:
- `locations_area_idx` on `area_id`

## Table: legacy_import_refs

Purpose: Soft mapping from legacy CRM primary keys to Aurora row ids for
operator-triggered imports. No foreign keys to target tables (avoids cycles;
deleting a `locations` row can orphan a ref — expected; cleanup is operator-driven).

Populated by the legacy CRM import Lambda (`ImportLegacyVenuesFunction` / shared
`legacy_crm` handler) when importing venues, families, organizations, contacts,
notes, labels, event-related entities, and other registered importers.

Columns:

- `entity` (text, PK) — importer key (for example `venues`)
- `legacy_key` (text, PK) — stable string form of the legacy key (venues use decimal string of legacy int)
- `new_id` (uuid, required) — target row primary key
- `imported_at` (timestamptz, default `now()`)

Indexes:

- `legacy_import_refs_new_id_idx` on `new_id`

Example `entity` values: `venues`, `families`, `organizations`, `contacts`, `notes`,
`link_contact_memberships`, `labels`, `event_services`, `event_instances`,
`event_instance_tags`, `event_enrollments`, `event_discount_codes` (see legacy CRM
import registry). All use decimal string keys of the legacy integer primary key except
`notes`, which maps legacy `note.id`.

## Table: `notes`

Purpose: Unified CRM notes — free-form text linked to contacts, families,
organizations, and/or sales leads. Replaces the former split between the
`crm_notes` table (FK columns per parent) and polymorphic `notes` /
`note_entity_links` (see migration `0028_unify_notes_storage`).

Columns:

- `id` (UUID, PK, default `gen_random_uuid()`)
- `contact_id`, `family_id`, `organization_id`, `lead_id` (UUID, nullable, FKs with
  `ON DELETE SET NULL` to the respective parent tables)
- `content` (text, required)
- `created_by` (varchar(128), required) — Cognito sub, or `legacy-import` for
  mysqldump imports
- `created_at`, `updated_at` (timestamptz, default `now()`)
- `took_at` (timestamptz, nullable) — populated for legacy-imported rows; when
  the note was “taken” in the source system. Not exposed in the admin API.

Constraint `notes_has_parent` requires at least one of `contact_id`, `family_id`,
`organization_id`, or `lead_id`.

Indexes: `notes_contact_idx`, `notes_family_idx`, `notes_lead_idx` (each includes
`created_at` for ordering).

Triggers: `notes_set_updated_at` → `set_updated_at()` on UPDATE.

**Legacy import:** the `notes` entity importer writes one row per resolved contact
for each legacy note (multi-contact notes yield multiple rows); `legacy_import_refs`
maps legacy `note.id` to the **first** inserted row’s UUID.

## CRM tables (media lead capture)

### `contacts`

- Purpose: canonical contact profile for CRM and campaign sync.
- Key fields: `email`, `first_name`, `contact_type`, `source`,
  `mailchimp_status`.
- `instagram_handle` is unique (case-insensitive), max 30 characters, stored
  without a leading `@`. Admin UI prefixes `@` for display only. Instagram
  inbound ingest persists Meta `username` here and reuses an existing contact
  (including archived) with that handle. Do not store Messenger PSID or
  Instagram IGSID here. Messenger has no equivalent handle column.
- Phone numbers: `phone_region` (`varchar(2)`, ISO 3166-1 alpha-2, upper-case)
  and `phone_national_number` (`varchar(20)`, digits only — E.164 national
  significant number). Both are nullable and must be set or cleared together
  (check constraint). E.164 is not stored; APIs derive it at read time with
  `phonenumbers` from region + national number.
- `source_metadata` (jsonb, nullable) may hold structured source data; the admin
  API stores `referral_contact_id` (UUID string) when `source = referral`.
- Key indexes: case-insensitive unique email/instagram indexes and source/type
  indexes.
- Admin API rule: a contact may belong to at most one family and at most one
  non-vendor organisation at a time (via `family_members` /
  `organization_members`). While linked, `contacts.location_id` is cleared so
  address is maintained on the family or organisation record.

### `families` and `family_members`

- `families` stores household-level entities.
- Activeness is derived from `archived_at` (no separate `status` column).
- `family_members` links contacts to families with role metadata.
- `family_members` rows are deleted automatically when either parent record is
  deleted (`ON DELETE CASCADE`).

### `organizations` and `organization_members`

- `organizations` stores external organization entities.
- Activeness is derived from `archived_at` (no separate `status` column).
- `organizations.partner_key` is an optional URL-safe identifier used when
  `relationship_type` is `partner`; uniqueness is enforced case-insensitively
  among partner rows with a non-null key (partial unique index
  `organizations_partner_key_unique_idx`).
- `organizations.legal_name` is an optional legal entity name for partner rows
  only; admin APIs reject non-null values when `relationship_type` is not
  `partner`. AR invoice Bill To resolution uses `legal_name` with fallback to
  `name` for partner organisations at issue time. By design, `legal_name` appears
  only on the issued invoice PDF Bill To line (`bill_to_display_name`); admin
  pickers/list labels and the structured `bill_to_snapshot` organization trade
  name keep `organizations.name`.
- `organizations.location_id` optionally links an organization to a canonical
  row in `locations` for address management.
- `organization_members` links contacts to organizations with role/title and an optional
  primary-contact flag (at most one primary per organisation in normal admin use).
- Membership rows use `ON DELETE CASCADE`.

### `tags`, `contact_tags`, `family_tags`, `organization_tags`, `asset_tags`

- `tags` stores reusable labels.
- `tags.archived_at` (timestamptz, nullable) soft-retires a tag: null means active; non-null
  means archived (hidden from assignment pickers such as `GET /v1/admin/contacts/tags` while
  existing junction rows remain valid).
- Junction tables model many-to-many tagging across contacts/families/orgs/assets.
- Junction rows use composite primary keys and cascade deletion.

### `sales_leads`

- Purpose: lead lifecycle tracking for contacts/families/organizations.
- Includes `lead_type`, `funnel_stage`, optional `asset_id`.
- `sales_leads_guide_dedup_idx` enforces idempotency for media processing
  by unique (`contact_id`, `lead_type`, `asset_id`) when `asset_id` is present.

### `sales_settings`

- Purpose: singleton sales configuration (always `id = 1`).
- `default_assigned_to` is an optional Cognito `sub` applied when a new lead is
  created without an explicit assignee (admin create, public forms, inbox ingest,
  and media/free-guide leads).
- `notify_assignee_on_assignment` emails the new assignee on first assignment and
  reassignment. Unassign does not send mail.
- `helper_detector_enabled` toggles AI Helper Detector on automated new leads
  (Filipino/Bahasa name signals → funnel stage `unqualified`, contact type
  `helper` only when current type is `other`). Default off.
- `updated_by` stores the admin Cognito `sub` that last saved the row.

### `sales_lead_events`

- Immutable event log for lead lifecycle transitions and actions.
- Rows cascade delete with parent lead (`lead_id` FK with `ON DELETE CASCADE`).

### `whatsapp_conversations`

- Purpose: one WhatsApp Cloud API thread per counterparty `wa_id`.
- Optional `contact_id` / `lead_id` FKs (`ON DELETE SET NULL`) created on first inbound message.
- Unique index on `wa_id`; activity counters and `last_message_at` for admin listing.

### `whatsapp_messages`

- Individual inbound or outbound (`smb_message_echoes`) messages.
- Unique `wa_message_id` for webhook idempotency; cascade delete with parent conversation.

### `meta_conversations`

- Purpose: one Messenger or Instagram thread per `(channel, platform_user_id)`.
- `channel` is `facebook` (Messenger) or `instagram`. `platform_user_id` is the
  Page-scoped PSID or IGSID. Optional `page_id` is the Page or IG professional id.
- Optional `contact_id` / `lead_id` FKs (`ON DELETE SET NULL`) created on first inbound message.
- Do not store PSID/IGSID on `contacts.instagram_handle`.
- Unique index on `(channel, platform_user_id)`; activity counters and `last_message_at`
  for admin listing.

### `meta_messages`

- Individual inbound or outbound (`message.is_echo`) Messenger/Instagram messages.
- Unique `platform_message_id` for webhook idempotency; cascade delete with parent conversation.

### `inbox_import_jobs`

- Purpose: admin-triggered async backfill of recent Messenger/Instagram Graph
  threads (`kind=meta_graph`) or WhatsApp Business App chat exports
  (`kind=whatsapp_export`).
- `channel` is set for Graph jobs (`facebook` / `instagram`) and null for
  WhatsApp exports. Optional `attachment_asset_id` points at the uploaded
  `.txt` / `.zip` (ON DELETE SET NULL).
- `options` JSON holds export hints (`counterparty_wa_id`,
  `business_display_names`). `counters` JSON stores stored/duplicate/skipped
  totals. Status strings match bulk expense import
  (`pending` / `processing` / `succeeded` / `succeeded_with_errors` / `failed`).
- No seed rows. Historical import creates contacts when missing and does not
  create new sales leads.

## Table: api_keys

- Hashed API tokens for `/v1/public/*` routes (header `x-api-token`).
- Stores `name`, `key_prefix` (display only), `key_hash` (PBKDF2-HMAC-SHA256 of plaintext),
  `scope` (`admin` full access or `user` GET-only), optional `expires_at`,
  `revoked_at`, and `last_used_at`.
- Plaintext is returned once at create and is never persisted.
- Unique index on `key_hash`. Audited via `api_keys_audit_trigger`
  (`key_hash` is redacted in admin audit API responses).

## Services tables

### `services` + type-detail tables

- `services` stores reusable templates (title/description/cover image, type,
  delivery mode, status).
- Optional `service_key` for public referral URLs and booking identity; uniqueness is
  case-insensitive on the pair `(service_key, service_tier)` when `service_key` is set
  (`services_service_key_tier_unique_idx` with `NULLS NOT DISTINCT` from migrations
  `0042_slug_nulls_nd` then `0046_services_slug_to_key`, so NULL tier is one bucket).
- Optional `booking_system` varchar(80) for an admin-visible booking-system label.
- Optional `service_tier` varchar(128): slug-like tier id shared by all instances.
- Optional `location_id` UUID FK to `locations.id` ON DELETE SET NULL: default venue for
  the template (instances and session slots may override).
- Type-specific one-to-one extension tables:
  - `training_course_details`
  - `event_details` (includes optional `default_price` numeric(10,2) and
    `default_currency` varchar(3), default `HKD`, for admin defaults on new event instances)
  - `consultation_details` (Calendly URL column removed in migration `0034_drop_calendly_fields`)

### `service_instances` + schedule/detail tables

- `service_instances` stores dated offerings linked to a parent `services` row (`service_id`).
  **Event and training** cohorts use one row per scheduled public occurrence (calendar feed +
  enrollments share that slug). **Consultation tiers and intro call** use one `services` row
  per catalog tier (`services.service_key`); each public reservation allocates a dedicated
  `service_instances` booking row with a generated unique slug (no template/catalog sibling).
- Template fields can be overridden per instance (`title`, `description`,
  `cover_image_s3_key`, `delivery_mode`).
- Required public-site field: `slug` (varchar(128), `NOT NULL` from migration
  `0049_inst_slug_not_null`). Migration `0063_tier_per_service` replaces the dual partial
  unique indexes with a single btree unique index `svc_instances_slug_uq` on `slug`
  (global uniqueness across all instances).
  Legacy NULL slugs for events and training courses were backfilled by migration
  `0043_backfill_inst_slug`; consultation NULL/empty slugs were backfilled by migration
  `0048_inst_slug_backfill_consult` before the NOT NULL constraint landed.
- Optional `cohort` varchar(128): admin label stored with the same normalization rules as
  instance referral slugs (lowercase letters, digits, single hyphens between segments).
- Optional `external_url` varchar(500): operator-provided external registration/info URL
  (http/https), distinct from Eventbrite sync URLs.
- Optional `capacity_left_override` integer (migration `0068_inst_capacity_left_override`),
  nullable, `CHECK (capacity_left_override IS NULL OR capacity_left_override >= 0)`.
  **Display only** — does not affect booking eligibility or `InstanceStatus.FULL`
  reconciliation (those remain `max_capacity` vs capacity-counted enrollments). When
  `max_capacity` is null the override is ignored for public `spaces_left` while the raw
  column may still be stored.
- Eventbrite sync metadata is stored on `service_instances` so DB remains source
  of truth while tracking downstream publish state:
  - `eventbrite_event_id`, `eventbrite_event_url`
  - `eventbrite_sync_status` (`pending`, `syncing`, `synced`, `failed`, `skipped`; migration
    `0062_eventbrite_skipped` adds `skipped`—consultation/intro-call booking children default to it)
  - `eventbrite_last_synced_at`, `eventbrite_last_error`
  - `eventbrite_last_payload_hash`, `eventbrite_ticket_class_map`,
    `eventbrite_retry_count`
- Scheduling/detail tables:
  - `instance_session_slots` (time blocks + optional location; `starts_at` / `ends_at`
    are `timestamptz` in Aurora). Migration `0063_tier_per_service` replaces
    `template_instance_id` with nullable `purpose_service_id` → `services.id` (`ON DELETE CASCADE`),
    backfilled from the owning booking instance's catalog service for consultation/intro-call rows.
    Partial unique index `instance_session_slots_purpose_service_starts_uidx` on
    `(purpose_service_id, starts_at)` where `purpose_service_id IS NOT NULL` serializes concurrent
    public bookings against the same catalog service id and start instant. The admin API rejects naive
    datetimes in `session_slots` payloads so only explicit instants are stored. The public
    calendar feed eager-loads `Service.location` only in `list_public_offerings`; venue
    resolution is slot location, then instance `location_id`, then parent
    `services.location_id`.
  - `training_instance_details`
  - `event_ticket_tiers`

### `service_instance_organizations`

- Junction table linking event `service_instances` to partner `organizations`
  (`service_instance_id`, `organization_id`, `sort_order`, `created_at`), added in
  migration `0036_instance_partners_ext_url`. Used by the admin API for event instance
  partner multi-select; ordering follows `sort_order`.

### `service_instance_tags`

- Junction table linking `service_instances` to CRM `tags` rows (`service_instance_id`,
  `tag_id`, `created_at`), added in migration `0037_instance_age_cohort_tags`. Used by
  the admin API for instance tag multi-select (same tag catalog as contacts).
- Migration `0038_drop_inst_tag_inst_idx` drops the redundant btree index on
  `service_instance_id` (the composite primary key already leads with that column);
  the `tag_id` index remains for reverse lookups.

Migration `0039_tags_archived_at` adds nullable `tags.archived_at` for soft-retiring labels
without breaking existing junction references.

### `discount_codes`

- Global, service-scoped, or instance-scoped promo codes.
- Supports `percentage`, `absolute`, and `referral` discount types with usage
  limits and optional validity windows.
- Check constraint `discount_codes_value_by_type`: referral rows require
  `discount_value >= 0`; non-referral rows require `discount_value > 0`.
- Migrations `0024_discount_referral_add_enum` (add enum label only) and
  `0025_discount_codes_value_check` (replace CHECK) are split because PostgreSQL
  does not allow referencing a newly added enum value in the same transaction.

### `enrollments`

- Registration/booking rows linked to a `service_instances` row.
- Supports parent linkage to one of contact/family/organization.
- Optional bill-to fields (`bill_to_kind`, `bill_to_contact_id`, `bill_to_family_id`,
  `bill_to_organization_id`) for AR invoicing (migration `0055_customer_billing_ar`).
- Optional links to event ticket tiers and discount codes.
- Migration `0045_enroll_inst_contact_uidx` adds partial unique index
  `enrollments_instance_contact_uidx` on `(instance_id, contact_id)` where
  `contact_id` is not null (at most one enrollment per contact per instance when
  the parent is a contact).

### `calendar_manual_blocks`

- Purpose-scoped manual half-day blocks (`purpose` varchar(64), `block_date` date,
  `period` in `am` / `pm` / `both`, optional `note`).
- Optional `created_by` / `updated_by` (Cognito sub) for admin accountability; admin API
  writes also append rows to `audit_log` (application source).
- Unique on `(purpose, block_date, period)`; merged at read time with session slots for
  public availability busy intervals (see `app.services.public_calendar_availability` and
  `app.services.calendar_blockers`).

### Customer billing (AR)

Migration `0055_customer_billing_ar` introduces:

- `customer_payments`: inbound payments and refunds (`direction`, `original_payment_id`,
  `stripe_payment_intent_id`, `stripe_refund_id`), linked optionally to `enrollments` and `contacts`.
  `customer_payments.enrollment_id` is nullable. The admin manual-inbound endpoint accepts a payment
  without an enrollment, intended for settling customized invoices that are not linked to any enrollment.
  Such payments may still be allocated to invoices via `payment_allocations`; only currency parity is
  enforced at allocation time.
- `customer_invoices` / `customer_invoice_lines`: draft/issued/void invoices with tax-ready line columns.
  Migration `0067_inv_settlement_fields` adds cached settlement projection columns on
  `customer_invoices`: `amount_allocated` (sum of matching-currency `payment_allocations`),
  `balance_due` (`max(total - amount_allocated, 0)`), and   `paid_at` (timestamp when an issued
  invoice with positive total becomes fully covered). `pdf_template_version` for issued rows tracks the renderer (currently `billing-invoice-v21`, including the paid-state diagonal watermark when `paid_at` is set). A partial index `customer_invoices_open_idx`
  on `due_date` speeds “open issued” listing (`status = issued` and `balance_due > 0`).
- `payment_allocations`: links payments to invoices with **positive-only** `allocated_amount`
  (partial allocation); refunds are modeled as separate `customer_payments` rows, not negative allocations.
  **`payment_unapplied_amount`** sums allocations **matching the parent payment's currency** only
  (one currency per payment; multi-currency allocation is not supported).
- `customer_receipts`: one row per succeeded inbound payment (`customer_payment_id` unique).
- `completion_certificates` (migration `0069_completion_certs`): issued training
  completion PDFs linked to `contacts`, `service_instances`, `services`, and
  `enrollments`. Snapshots recipient name, program title, partner branding, and body
  text at issue time. `status` is `issued` or `voided`; voided rows drop the contact
  award badge. Multiple issued rows per contact/instance are allowed. PDF object keys
  live under `completion-certificates/` in the assets bucket.
- `document_counters`: serialized numbering per scope and year; **invoices** use one
  global sequence per year (`INV-YYYY-NNNNNN`), while **receipts** keep a per-currency scope.
- Audit: same `audit_trigger_func()` as `0054_add_audit_log` on all five billing tables.
- Migration `0057_invoice_dates_snapshot` adds nullable `invoice_date` and `due_date`
  on `customer_invoices`. Drafts persist `invoice_date` at creation (defaulting to today in
  `INVOICE_DISPLAY_TIMEZONE` when that env var is set, else UTC); `due_date` remains unset until
  issuance and is then derived as `invoice_date` + `INVOICE_PAYMENT_TERMS_DAYS`. At issue time,
  if `invoice_date` was not set on the draft (legacy rows), both dates are computed from `issued_at`
  in `INVOICE_DISPLAY_TIMEZONE` as before. PDF rendering prefers these columns when set.
- Migration `0064_invoice_bill_to_location` adds nullable `bill_to_location_text` on
  `customer_invoices` (CRM snapshot of linked `locations` venue/address plus geographic
  district and country labels when resolvable, refreshed when drafts are resolved and again
  immediately before issuance).
- Migration `0077_invoice_assets` adds nullable unique `customer_invoices.asset_id`
  (FK → `assets.id`, `ON DELETE RESTRICT`) so issued invoice PDFs appear in the admin
  Assets list under the reserved `customer_invoice` tag.
- Migration `0066_cp_enroll_extref_uq` adds a partial unique index on
  `customer_payments (enrollment_id, external_reference)` when `external_reference` is not null,
  so duplicate manual inbound references for the same enrollment return HTTP 409 from the admin API.

**Migration `0058_inv_line_null_enrollment`:** `customer_invoice_lines.enrollment_id` is nullable so customized (non-enrollment) invoice lines can omit the enrollment foreign key.

**CSV export (admin):** `GET /v1/admin/billing/export` defaults to **`export_version=2`**
(query `exportVersion`, default `2`). v2 emits `payment`, `refund`, `invoice`,
`invoice_line`, `receipt`, and `allocation` rows with bill-to, tax, and linkage columns;
`exportVersion=1` retains the legacy payments+allocations-only columns.

**Invoice reads (admin):** `GET /v1/admin/billing/invoices` lists invoice summaries with optional
`status`, optional `settlement` (`open` / `partially_paid` / `paid` / `no_charge`, issued rows only; AND-combined with `status`),
`currency`, and cursor pagination (`cursor`, `limit`). Summary and detail payloads include
`amountAllocated`, `balanceDue`, `paidAt`, and `isPaid` (derived; lifecycle `status` stays draft/issued/void).
`GET /v1/admin/billing/invoices/{id}` returns the invoice with line items (for example allocation line UUIDs).

Issuing a **positive-total** invoice (`POST /v1/admin/billing/invoices/{id}/issue`) also
inserts one pending inbound `customer_payments` row with the invoice `total` and `currency`,
method `fps`, and `enrollment_id` only when the invoice has exactly one enrollment line
(customized and multi-enrollment invoices leave it unset). That stub is **not** allocated
at issue time, so settlement (`amount_allocated` / `paid_at`) stays unchanged until staff
allocate later. Zero-total issues do not create a payment. Voiding the invoice leaves the
pending stub in place (eligible for orphan delete while still pending and unallocated).

For offline inbound payments, the `customer_payments` row may be **pending** until staff
confirm the payment via `POST /v1/admin/billing/payments/{id}/confirm` or an equivalent succeeded path;
the receipt row (and PDF that lists applied invoice numbers) follows server rules after confirmation.

### `service_tags` + `service_assets`

- Junction tables for many-to-many links between services and existing `tags`
  / `assets` rows.

## Shared update trigger

- Function: `set_updated_at()`.
- Applied to: `contacts`, `families`, `organizations`, `sales_leads`,
  `notes`, `services`, `service_instances`, `discount_codes`,
  `enrollments`.
- Behavior: updates `updated_at` to `now()` before each UPDATE.
