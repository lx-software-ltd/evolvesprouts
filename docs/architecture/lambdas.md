# Lambda Catalog

This document lists the backend Lambda functions, their handlers, and
their primary responsibilities.

## Runtime and packaging

- Runtime: Python 3.12.
- Packaging: deterministic bundling (no bytecode files, repeatable output).
- CDK runs `backend/scripts/run-cdk-app.sh`, which builds the local
  bundle via `backend/scripts/build_lambda_bundle.py` before synth/deploy.
- Lambda dependency wheels are cached under
  `backend/.lambda-build/dependency-cache` keyed by `backend/requirements.txt`
  content and target runtime metadata to avoid reinstalling pip dependencies on
  every synth.
- Cache retention is bounded (default keeps the 3 most recent keys). Older
  cached dependency keys are pruned automatically by
  `backend/scripts/build_lambda_bundle.py`.

### CDK deploy parameter hygiene

- Discount validation and reservation flows resolve public `service_key` values from
  `services.service_key` in Aurora. The legacy `PUBLIC_SERVICE_KEY_MAP_JSON` Lambda environment
  variable (and CDK `PublicServiceKeyMapJson` parameter) has been removed; production and
  staging deploys must not pass it in pipeline parameter files or `cdk deploy --parameters`
  invocations.

## API Gateway Lambdas

### Admin API
- Function: EvolvesproutsAdminFunction
- Handler: backend/lambda/admin/handler.py
- Trigger: API Gateway — currently wired for
  `/v1/assets/free/request`, `/v1/reservations`,
  `/v1/reservations/payment-intent`,
  `/v1/calendar/public` (same public calendar feed and contract as
  `/www/v1/calendar/public`; see that entry below for payload, ordering, and query filters),
  `/v1/calendar/availability` (GET; requires `purpose` `consultation_booking` or `intro_call_booking`;
  returns discrete UTC slot intervals plus metadata; `consultation_booking` uses half-day AM/PM blocks Mon–Fri local with strict grid validation on reservations (09:00 / 14:00 local on weekdays); `intro_call_booking` uses 15-minute slots on a 30-minute cadence; same contract as `/www/v1/calendar/availability`;
  `purpose=consultation_booking` uses `Cache-Control: no-store` on success; intro-call uses the standard public cacheable GET headers),
  `/v1/discounts/validate`,
  `/v1/contact-us`,
  `/v1/forms/{form_slug}/answers` (PUT; API key; persists training form answers to DynamoDB
  `evolvesprouts-poll-responses`; same contract as `/www/v1/forms/{form_slug}/answers`),
  `/v1/polls/{poll_slug}/answers` (GET lists answers for `sessionId`; PUT upserts one answer;
  API key; DynamoDB `evolvesprouts-poll-responses`; validates options when control state
  publishes `questionOptions`; per-session hourly write rate limits; same contract as
  `/www/v1/polls/{poll_slug}/answers`),
  `/v1/polls/{poll_slug}/questions/{question_id}/results` (GET; API key; live aggregates for
  `select` / `truefalse` questions and free-text lists for `text` / `email`; same contract as
  `/www/v1/polls/.../results`),
  `/v1/polls/{poll_slug}/control` (GET, PUT; API key; facilitator toggles for which questions
  respondents may answer and optional `questionOptions` for answer validation; stored at DynamoDB
  sort key `CONTROL`; default is all off; same contract as `/www/v1/polls/{poll_slug}/control`),
  `/v1/admin/geographic-areas`,
  `/v1/mailchimp/webhook` (GET/POST),
  `/v1/whatsapp/webhook` (GET handshake + POST inbound/echo/`history` messages;
  HMAC `X-Hub-Signature-256` via `META_APP_SECRET`; verify token
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; persists conversations and creates
  WhatsApp CRM contacts/leads except history/export backfills which skip new
  leads; sets audit actor `webhook:whatsapp`),
  `/v1/meta/webhook` (GET handshake + POST Messenger/Instagram inbound and
  `is_echo` messages; same HMAC and verify token; persists
  `meta_conversations` / `meta_messages` and creates CRM contacts/leads;
  sets audit actor `webhook:meta`),
  `/v1/public/whatsapp/*` and `/v1/public/meta/*` (hashed `x-api-token` conversation
  reads; name/dates/text only),
  `/v1/public/contacts` and `/v1/public/contacts/{id}` (hashed `x-api-token` CRM
  contact list/get for `user` and `admin` scopes; create/update/delete for `admin`
  only; payloads match `/v1/admin/contacts`; notes, services, and Mailchimp sync
  jobs are not exposed),
  `/v1/admin/locations/*` (including `GET /v1/admin/locations?exclude_addresses=true`
  to list service venues without family/organisation home addresses, and
  `POST /v1/admin/locations/geocode` for
  Nominatim-backed address geocoding via `AwsApiProxyFunction`),
  `/v1/admin/assets/*` (including `POST /v1/admin/assets/{id}/content/init` and
  `POST /v1/admin/assets/{id}/content/complete` for two-step S3 file replacement
  while preserving the asset id; complete validates the pending key segment
  (`UUID-` prefix + filename), enforces PDF `Content-Type` and max upload size on
  S3 head, and logs a warning with `outcome=replace_delete_failed` if deleting the
  previous object fails after commit). **Operational caveats:** concurrent replaces
  are last-writer-wins; abandoned `complete` calls can leave orphan objects under
  `assets/{id}/`; failed old-key deletes are log-only until a follow-up lifecycle or
  reconciliation job exists. **Caching:** share-link tokens stay stable on replace;
  CDN or browser caching keyed only by URL (not `s3_key`) may show stale bytes until TTL—
  downloads keyed by changing `s3_key` generally avoid that.
  `/v1/admin/contacts/*` (including `GET /v1/admin/contacts` optional `contact_type` filter;
  list and single-contact responses include read-only `family_location_summary` and
  `organization_location_summary` when the contact is linked to a family or organisation that has a venue location,
  plus related-record flags `has_sales_conversation` (with optional `sales_conversation_channel`),
  `has_service_instance`, and `has_invoice`;
  `POST /v1/admin/contacts/mailchimp-sync-run`, `POST /v1/admin/contacts/mailchimp-sync-orphans`, and
  `GET /v1/admin/contacts/mailchimp-sync-status` for production Mailchimp audience sync, orphan cleanup, and status counters),
  `/v1/admin/tags/*` for CRM tag catalog administration (list with optional `include_archived` or
  `archived_only`, create, update, `PATCH` `archived` to restore, delete returns `deleted` +
  `usage_count`; system tag names are protected),
  `/v1/admin/calendar/manual-blocks` and `/v1/admin/calendar/manual-blocks/{id}` for purpose-scoped
  manual calendar blocks (list requires `purpose`, `from`, `to`; create supports `consultation_booking`
  in the current release; merged into public availability busy intervals via `GET /v1/calendar/availability`),
  `GET /v1/admin/contacts/tags` for tag pickers (active tags only),
  `GET /v1/admin/contacts/search` for contact picker search,
  `GET|POST /v1/admin/contacts/{id}/notes` and `PATCH|DELETE /v1/admin/contacts/{id}/notes/{noteId}`
  for standalone CRM notes on a contact (not tied to a sales lead), `GET /v1/admin/contacts/{id}/services`
  for read-only purchased-service labels on a contact (including services purchased by any family or
  organisation the contact belongs to), and `DELETE /v1/admin/contacts/{id}`
  for hard-deleting a contact after clearing blocking CRM rows),
  `/v1/admin/families/picker`, `/v1/admin/families/*` (`GET /v1/admin/families` optional `query`
  matches family name and linked member contacts' names or email; `PATCH /v1/admin/families/{id}` with
  `relationship_type` updates that field on the family and on every member contact; including `DELETE /v1/admin/families/{id}`
  for hard-deleting a family after clearing blocking CRM rows; `GET /v1/admin/families/{id}/services`
  for read-only purchased-service labels on a family (including member contacts); `POST /v1/admin/families/{id}/members`
  derives each member's role from the linked contact's `contact_type`; `PATCH /v1/admin/families/{id}/members/{memberId}`
  updates membership fields such as primary contact),
  `/v1/admin/organizations/picker` (optional `relationship_type` query mirrors organisation list
  semantics; default excludes both vendors and partners; pass `relationship_type=partner` for
  partner-only admin pickers), `/v1/admin/organizations/*` (CRM organisations and vendor
  rows share one resource; default list excludes vendors and partners; Services → Partners lists
  partners with `GET /v1/admin/organizations?relationship_type=partner`; Finance lists vendors with
  `GET /v1/admin/organizations?relationship_type=vendor` (optional `sort=name` for case-insensitive
  alphabetical order by trimmed name); includes `DELETE /v1/admin/organizations/{id}`
  for non-vendor orgs; `GET /v1/admin/organizations/{id}/services` for read-only purchased-service
  labels on an organisation (including member contacts); `POST /v1/admin/organizations/{id}/members` derives each member's role from the
  linked contact's `contact_type`; `PATCH /v1/admin/organizations/{id}/members/{memberId}` updates
  membership fields such as primary contact; partner rows accept optional `legal_name` for AR
  invoice Bill To entity lines—resolved as `legal_name` or `name` at issue time; pickers and
  structured bill-to snapshots keep the trade `name` by design),
  `/v1/admin/forms` (lists form slugs with answer counts from DynamoDB
  `evolvesprouts-poll-responses`), `/v1/admin/forms/{form_slug}/answers`
  (`GET` lists all stored answer rows; `DELETE` clears all rows for the form),
  `/v1/admin/forms/{form_slug}/answers/export` (`GET`; CSV export),
  `/v1/admin/polls` (lists poll slugs with answer counts from DynamoDB
  `evolvesprouts-poll-responses`), `/v1/admin/polls/{poll_slug}/answers`
  (`GET` lists all stored answer rows; `DELETE` clears all rows for the poll),
  `/v1/admin/polls/{poll_slug}/answers/export` (`GET`; CSV export),
  `/v1/admin/leads/*`, `/v1/admin/users`, `/v1/admin/instructors`,
  `GET /v1/admin/audit-logs` and `GET /v1/admin/audit-logs/{id}` (read-only `audit_log` history; list supports filters `table`, `record_id`, `user_id`, `email`, `action`, `since`, `cursor`, `limit`; `email` resolves via Cognito `list_users`, known system-actor labels/`user_id` values, or `api_keys.name`; optional `user_email` is a Cognito email, API key name, or system-actor label),
  `/v1/admin/services/*` (including `GET /v1/admin/services/instances` for
  cross-service instance listing with optional `service_id` / `service_type` /
  `contact_id` filters; instance create/update accepts optional `cohort`, and
  `tag_ids` with `tags` / `tag_ids` echoed on instance responses; completing an instance
  (`status: completed`) bulk-updates `registered` / `confirmed` enrollments on that
  instance to `completed` (cancelled, waitlisted, and already-completed rows unchanged);
  `session_slots`
  `starts_at` / `ends_at` on create/update must be timezone-aware (RFC 3339 with
  `Z` or a numeric offset; naive strings are rejected); instance JSON
  includes `resolved_*` fields (title, slug, description, delivery mode, location,
  and type-specific pricing/tiers) when the instance omits a value and the parent
  service supplies the effective default; instance payloads also include
  `parent_service_title` / `parent_service_tier` / `parent_service_type` for
  cross-service lists; `capacity_enrolled_count` (enrollments in registered,
  confirmed, completed) for admin capacity display; optional `capacity_left_override`
  with read-only `capacity_left_effective` for a display-only soft cap on spots left;
  listing instances and
  mutating enrollments reconcile `status` to `full` when `max_capacity` is set
  and no seats remain, and from `full` back to `open` when seats free (only
  among scheduled/open/full); `partner_organizations` entries include optional
  `location_id` (partner venue); and
  `GET /v1/admin/services/{id}/discount-code-usage-summary` for
  aggregate discount usage before service key changes; `DELETE /v1/admin/services/{id}`
  returns `409` when the service still has instances), `/v1/admin/completion-certificates/*`
  (preview, issue, list, void, delete, PDF download; requires a completed enrollment for
  the contact and instance), `/v1/admin/discount-codes/*`
  (`POST` returns `409` with `field: code` when the code collides with the
  case-insensitive unique index; `PUT` accepts `discount_value` `0` only when the
  effective discount type after the update is `referral`, otherwise `discount_value`
  must be greater than `0`),
  `/v1/admin/expenses/*`, including:
  - `POST /v1/admin/expenses/import-from-bulk-pdf` — validates a single uploaded PDF asset,
    writes a `bulk_expense_import_jobs` row, enqueues `evolvesprouts-bulk-expense-import-queue`,
    and returns **202** with a job id.
  - `GET /v1/admin/expenses/bulk-import-jobs` — creator-scoped list of recent bulk-import jobs.
  - `GET /v1/admin/expenses/bulk-import-jobs/{job_id}` — polls job status until `BulkExpenseImportFunction`
    finishes OpenRouter bulk extraction and creates one expense per parsed row (sharing that attachment).
  - `DELETE /v1/admin/expenses/bulk-import-jobs/{job_id}` — creator-scoped hard delete of the job row only
    (does not remove created expenses; the bulk worker treats a missing job id as already handled).
  `/v1/admin/billing/*` (customer AR: `GET /v1/admin/billing/payments` optional `invoice_id` filters to payments with an allocation to that invoice; `POST /v1/admin/billing/payments` creates either a refund (`direction: refund`) or a manual inbound payment (`direction: inbound`; `enrollmentId` is optional on inbound—omit to record a no-enrollment payment for later allocation to a customized invoice; when set, currency must match the enrollment billing currency; duplicate non-null `externalReference` per enrollment returns **409**); `GET /v1/admin/billing/payments/{id}` includes `allocationInvoices`, `orphanPaymentDeletable`, and `externalReference` when set; `PATCH /v1/admin/billing/payments/{id}` updates manual inbound payments without a Stripe PaymentIntent (enrollment immutable; succeeded rows limit field changes; duplicate non-null `externalReference` per enrollment returns **409**; application audit action `MANUAL_INBOUND_PAYMENT_UPDATED`); `DELETE /v1/admin/billing/payments/{id}` removes eligible orphan inbound payments (pending or free/zero, enrollment unlinked or cancelled, no allocations/receipt/refund children); payments, `GET /v1/admin/billing/invoices` (optional `status`, optional `settlement` for settlement slices (open/partially_paid/paid/no_charge apply to issued rows; `not_completed` includes draft invoices and issued positive-total rows that are not paid or no-charge), `currency`, optional `contact_id` for invoices billed to that contact or their family/organisation, and `q` matching invoice number, bill-to text fields, and ISO `invoice_date`; each summary includes cached `amountAllocated` / `balanceDue` / `paidAt` / `isPaid`), invoice get/detail, draft invoices via
  `POST /v1/admin/billing/invoices` with `draftKind` `enrollment_merge` or `customized_manual`,
  `GET /v1/admin/billing/enrollments/recent-for-invoicing` (draft invoice enrollment picker: non-cancelled rows with `enrolled_at` within the last 730 rolling days), `POST /v1/admin/billing/dashboard/resolve-bill-to-primary-contacts` (bulk family/organisation→primary contact id map for dashboard spend rollups), `DELETE /v1/admin/billing/invoices/{id}` (draft-only permanent delete; blocked when allocations exist), `GET /v1/admin/billing/invoices/{id}/pdf`
  (returns a CloudFront-signed URL; each response includes a unique cache-bust query on the
  signed resource so draft/void preview PDFs re-uploaded to the same S3 key are not edge-cached
  as an older file),
  allocations, `POST /v1/admin/billing/invoices/{id}/email` (comma- or semicolon-separated
  `toEmail` recipient list; branded MIME body from `evolvesprouts-invoice-{locale}`
  copy plus the issued invoice PDF attachment; send path stays `SendRawEmail`), export;
  enrollment lines on issued invoices: **zero-total** issues immediately transition linked enrollments from `registered` to `confirmed` and promote the enrolled CRM party when it is still `prospect` to `client` (family or organization enrollments: every contact member of that family or organization); **positive-total** issues leave enrollment status unchanged until the first **payment allocation** is created against that issued invoice, which performs the same `registered`→`confirmed` and prospect→client promotions idempotently;
  handler code split across `admin_billing*.py` modules under `app.api`, same Lambda),
  `/v1/user/assets/*`,
  `/v1/assets/public/*`, `/v1/assets/share/*`, `/v1/assets/email-download/*`,
  and `GET /v1/assets/free`,
  plus public website proxy routes including
  `/www/v1/discounts/validate` (native Aurora-backed discount validation; request body
  requires `service_key`; optional `service_instance_slug` pairs with `service_key` to resolve a
  `service_instances` row whose parent `services.service_key` matches `service_key`
  (case-insensitive); slug-less requests resolve `services` by `service_key` only—unknown keys **404**
  with `unknown_service_key`. Otherwise **404** with `unknown_service_instance_slug` or
  `service_key_instance_mismatch`. Scoped codes compare against the resolved service/instance
  ids; codes with `discount_type` `referral` are rejected with the same 404
  envelope as unknown/inactive codes; on each 404 the Lambda logs a structured
  `Public discount validate rejected` entry with `rejection_reason` (for example
  `code_not_found`, `referral_type_not_allowed`, `inactive`, `not_yet_valid`, `expired`,
  `max_uses_exhausted`, `unknown_service_instance_slug`, `service_key_instance_mismatch`,
  `unknown_service_key`,
  `instance_scope_mismatch`, `service_scope_mismatch`), `code_hash`,
  and `code_prefix`—never the full code),
  `/www/v1/contact-us`, `/www/v1/reservations`,
  `/www/v1/calendar/public` (public calendar feed: returns **event** and
  **training_course** `service_instances` for published services; consultation
  is intentionally excluded. Instances with an empty `service_instances.slug` are omitted.
  Visibility: instances with any session not yet ended, or **event** instances whose last session ended within the prior 90 days (finished **training_course** rows are omitted).
  Each item includes `service_type`,
  `slug` (public instance slug from `service_instances.slug`), parent `service_key`
  (nullable `services.service_key`; required for public discount validate and reservation
  submission when non-null), `partners`, `service_tier`
  (from parent service, or inferred from instance slug for My Best Auntie) / `cohort`,
  and `title` augmented with the tier, a spaced hyphen, and a title-cased cohort label
  when both `service_tier` and `cohort` are present (cohort hyphen segments capitalized,
  e.g. `may-26` → `May 26`),
  `is_fully_booked`, and a server-derived `location_url`. `location_name` falls back
  to the linked partner organization's display name when the venue location row has
  no name but is that partner's `organizations.location`. `booking_system` comes
  from `services.booking_system` or defaults from service type (MBA training
  cohorts default to `my-best-auntie-booking` when `services.service_key` is
  `my-best-auntie-training-course`). Results order by earliest upcoming session slot ascending
  with `service_instances.id` as tie-break (finished **event** rows sort after active rows). Optional query filters:
  `slug` (matched case-insensitively against `service_instances.slug`), `service_type`,
  `service_key` (matched case-insensitively against `services.service_key`; invalid values
  ignored). `slug` echoes from `service_instances`; when `max_capacity` is set,
  `spaces_total` mirrors `max_capacity` and `spaces_left` counts remaining seats from
  enrollments in registered, confirmed, or completed status, optionally reduced further
  by an admin-only `capacity_left_override` soft cap for public display),
  `/www/v1/calendar/availability` (requires `purpose`; returns discrete slots + meta for consultation or intro-call booking;
  consultation uses Mon–Fri half-day grid with `meta.wall_time_zone`; success `Cache-Control` follows purpose),
  `/www/v1/assets/free` (lists public assets tagged `client_document`;
  optional `language` query filters on `assets.content_language` using any valid
  BCP 47-style tag; admin asset writes restrict `content_language` to `en`,
  `zh-CN`, or `zh-HK`; downloads
  remain on `/v1/assets/public/{id}/download` with device attestation),
  Allowlisted public GETs behind `/www/*` (`GET /v1/calendar/public`,
  `GET /v1/calendar/availability` (edge-cacheable on 200 for intro-call; consultation uses `no-store`),
  `GET /v1/assets/free`, and `/www/v1/...`) emit `Cache-Control` on success and
  `no-store` on handler error paths; new allowlisted GETs must follow the same
  contract,
- Auth: Cognito JWT — admin group for `/v1/admin/*`,
  any authenticated user for `/v1/user/*`,
  device attestation + API key for `/v1/assets/public/*`,
  API key for `/v1/assets/share/*` and `/v1/assets/email-download/*` (injected by
  media CloudFront at origin) and `GET /v1/assets/free`
- Permissions: SES `SendEmail` / `SendRawEmail` / `SendTemplatedEmail` on the
  verified `SesSenderEmail` identity **and** the `AuthEmailFromAddress` identity
  (plus derived domain identity ARNs), Secrets Manager read for the Mailchimp API
  secret when marketing hooks run on public form routes
- Environment (selected): `SES_SENDER_EMAIL`, `CONFIRMATION_EMAIL_FROM_ADDRESS`,
  `PUBLIC_WWW_CONFIG_SECRET_ARN` (Secrets Manager JSON object that holds the
  resolved `PUBLIC_WWW_*` deployment config: `BASE_URL`, optional `INSTAGRAM_URL` /
  `LINKEDIN_URL` / `WHATSAPP_URL` for the transactional email shell — `wa.me/message/...`
  values are rewritten to `https://wa.me/<phone>` for reliable email clients —
  plus `BUSINESS_PHONE_NUMBER` for `wa.me/<digits>` links, `BUSINESS_NAME` /
  `BUSINESS_LEGAL_NAME` / `BUSINESS_ADDRESS` / `BUSINESS_REGISTRATION` for AR
  invoice header/footer, `BANK_NAME` / `BANK_ACCOUNT_HOLDER` / `BANK_ACCOUNT_NUMBER`
  for the AR invoice bank block, optional `BILLING_EMAIL` for the **Payment Options**
  page payment-confirmation copy, optional `FPS_MERCHANT_NAME` / `FPS_MOBILE_NUMBER`
  used to render an FPS QR payload on positive-total HKD invoices, and
  `STAGING_SITE_ORIGIN` for the staging-vs-live Stripe secret selection on the
  public reservation Payment Element. The secret is populated by CDK from the
  `PublicWww*` CFN parameters, which themselves come from GitHub
  `vars.NEXT_PUBLIC_*` values; this packaging keeps the admin Lambda's
  environment-variable string under AWS's 4 KB hard limit. Lambdas read the
  payload via the existing Secrets Manager VPC interface endpoint with a
  five-minute in-process cache (`app.config.public_www`); existing tests that
  set `PUBLIC_WWW_*` env vars directly continue to work because the helper
  prefers env vars when present),
  `INVOICE_DISPLAY_TIMEZONE` (IANA id; **required** to issue AR invoices; GitHub `CDK_PARAM_INVOICE_DISPLAY_TIMEZONE`; separate from sales recap),
  `INVOICE_PAYMENT_TERMS_DAYS` (1–3 digit days; default `7` when unset/empty; invalid or `> 999` fails issuance; GitHub `CDK_PARAM_INVOICE_PAYMENT_TERMS_DAYS`),
  `DEFAULT_PHONE_REGION` (ISO 3166-1 alpha-2; CDK `DefaultPhoneRegion`; parses
  public `phone_country` / `attendeeCountry` when omitted), `SUPPORT_EMAIL` (contact-us
  **contact_inquiry** internal notifications only), `COGNITO_USER_POOL_ID`,
  `ADMIN_GROUP`, `AWS_PROXY_FUNCTION_ARN` (sales recap recipient resolution via Cognito group),
  `SALES_RECAP_DISPLAY_TIMEZONE` (optional IANA id for recap **Submitted at**; CDK `SalesRecapDisplayTimezone` parameter, empty = app default),
  `MAILCHIMP_*` welcome journey vars (see `aws-messaging.md`)
- **AR PDF template versions (DB `pdf_template_version` column, shared by invoices and receipts):** issued customer invoices set `INVOICE_PDF_TEMPLATE_VERSION` = `billing-invoice-v21`; receipts set `RECEIPT_PDF_TEMPLATE_VERSION` = `billing-receipt-v1`.
- **Invoice currency display:** `HKD` amounts render with the `HK$` prefix in AR invoice PDFs.
- **AR invoice footer (Option B):** when both legal/trading and registration are set, the centered footer is `{legal_name} | Proudly registered in Hong Kong | BR: {reg}` with `legal_name` = `PUBLIC_WWW_BUSINESS_LEGAL_NAME` or `PUBLIC_WWW_BUSINESS_NAME` (resolved from `PUBLIC_WWW_CONFIG_SECRET_ARN`), and with fallbacks: legal only → legal; registration only → `BR: {reg}`; both empty → no footer. The **"Proudly registered in Hong Kong"** fragment is fixed product copy (see `.cursorrules` exception).
- **Snapshot dates:** on issue, `customer_invoices.invoice_date` and `customer_invoices.due_date` are persisted (see `docs/architecture/database-schema.md`); the PDF uses these when present; draft previews compute dates in **UTC** when columns are null.
- Purpose:   asset metadata CRUD (admin asset list returns `linked_tag_names` for tag
  filters and accepts `tag_name` for any tag linked to assets in the requested
  `asset_type` scope; create/update accept optional `client_tag` for the
  `client_document` tag, forbidden when the asset is expense-linked), geographic area browsing, location CRUD
  and geocoding (`POST /v1/admin/locations/geocode` uses `NOMINATIM_USER_AGENT` and
  `NOMINATIM_REFERER` with the HTTP proxy to OpenStreetMap's geocoder; the
  `countrycodes` parameter is built from the root area `code` plus the sovereign
  country row's `code` when `geographic_areas.sovereign_country_id` is set),
  (list supports optional `area_id`, `search` on address, cursor pagination, and `total_count`),
  CRM contact/family/organization management with soft-archive, locations, tags,
  and family/organization membership rows,
  sales pipeline lead management (list/detail/create/update/notes/export/analytics),
  vendor management, expense invoice ingestion and listing (newest `invoice_date` first, undated last), amendment/void/pay/draft-delete flows
  (mark-paid requires vendor, invoice date, currency, and total), and admin-user
  listing for lead assignment and instructor-group listing for service instances
  (service list items may include nullable `training_details` for training courses
  and nullable `event_details` for events),
  grant management,
  stable share-link lifecycle (read/create/rotate/revoke + domain allowlist
  policy), share-link source-domain enforcement, conditional JWT
  authentication for restricted share-link resolutions, PATCH partial metadata
  updates on `/v1/admin/assets/{id}`, media lead capture with Turnstile
  verification (via `AwsApiProxyFunction`) and SNS event publishing on
  `/v1/assets/free/request`, Mailchimp webhook ingestion and contact sync-status
  reconciliation on `/v1/mailchimp/webhook`, native public contact-us on
  `/v1/contact-us` (Turnstile + Aurora contact upsert; sales lead for
  `contact_inquiry`, `community_newsletter`, and `event_notification` when no
  open lead exists; post-success SES + Mailchimp + recaps via
  `run_contact_us_post_success`),
  WhatsApp Cloud API webhook ingestion on `/v1/whatsapp/webhook`
  (including coexistence `history` chunks when Meta sends them),
  Messenger and Instagram webhook ingestion on `/v1/meta/webhook`,
  admin inbox import enqueue on `/v1/admin/meta/import-jobs` and
  `/v1/admin/whatsapp/import-jobs` (SQS `evolvesprouts-inbox-import-queue`;
  resolved by queue name so the admin Lambda env dict stays under 4 KB),
  Stripe PaymentIntent creation for
  inline public booking modal payments on `/v1/reservations/payment-intent`
  (card-only `payment_method_types[]=card`; wallet buttons are disabled in the
  public Payment Element; `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID` is not used).
  When the `STAGING_SITE_ORIGIN` field of `PUBLIC_WWW_CONFIG_SECRET_ARN` and `EVOLVESPROUTS_STRIPE_STAGING_SECRET_KEY`
  are set, requests whose `Origin` or `Referer` matches that staging site use
  the staging Stripe secret; otherwise the live `EVOLVESPROUTS_STRIPE_SECRET_KEY`
  is used (reservation submission uses the same selection for PaymentIntent retrieval).
  `POST /v1/reservations` (and `/www/v1/reservations`) accepts camelCase booking-modal
  fields, persists contact + program-enrollment lead (including discount metadata when
  applicable; referral-type codes are rejected). Requires `serviceKey`; `serviceInstanceSlug`
  pairs with it for **event-booking** and **my-best-auntie-booking**. **consultation-booking**
  and **intro-call-booking** resolve catalog `services` rows by `serviceKey` only (`serviceInstanceSlug`
  ignored when sent), derive `service_type`, allocate a dedicated booking `service_instances` row
  (generated slug, `eventbrite_sync_status = skipped`), attach session slots with `purpose_service_id`
  on `(purpose_service_id, starts_at)` uniqueness, then attach enrollment and payment rows.
  Other booking systems attach the enrollment directly to the resolved instance when capacity allows
  (or return **409** when the instance is full with waitlist disabled). Admin enrollment APIs validate
  discount code scope to `services.id` / `service_instances.id` as scoped on the code row; `PATCH`
  enrollments may update `enrolled_at` (ISO instant; omit to leave unchanged). Contact-only enrollments
  may be converted once via `promote_to_family_id` or `promote_to_organization_id` (mutually exclusive).
  Then sends
  booking confirmation (SES), optional Mailchimp subscribe, and a plain-text **sales recap**
  with extended booking context when provided, and signed upload/download URL generation in
  `backend/src/app/api/admin.py`.

### Health check
- Function: HealthCheckFunction
- Handler: backend/lambda/health/handler.py
- Trigger: API Gateway `GET /health`
- Auth: IAM
- Purpose: service health and configuration checks
- DB access: RDS Proxy with IAM auth (`evolvesprouts_app`)

### SES template manager (custom resource)
- Function: SesTemplateManagerFunction
- Handler: backend/lambda/ses_template_manager/handler.py
- Trigger: CloudFormation custom resource `SesEmailTemplates`
- Stack: nested stack `evolvesprouts-Messaging` (`backend/infrastructure/lib/messaging-stack.ts`)
- Purpose: create/update/delete SES stored email templates used by public
  transactional flows (contact, media download link, booking confirmation,
  intro-call confirmation) and the admin issued-invoice email
  (`evolvesprouts-invoice-{locale}`). Invoice send uses `SendRawEmail` so the
  issued PDF can be attached; stored templates keep catalog copy aligned.
  Pending FPS bookings may instead send booking confirmation via
  `SendRawEmail` (multipart HTML + inline PNG) when the client supplies a valid
  PNG data URL. Stored booking-confirmation templates expose `{{service_type_label}}`
  and `{{service_title_label}}` for the first details table row (localized service type
  from the resolved instance `service_type` when present, with generic “Service” fallback
  in the label column; title is the booking title). `{{service_row_label}}` remains in
  merge data as the course title for backward compatibility with older template revisions.
- VPC: **No**
- Permissions: SES `CreateTemplate`, `UpdateTemplate`, `DeleteTemplate`, `GetTemplate`

## Auth and security Lambdas

### Pre sign-up trigger
- Function: AuthPreSignUpFunction
- Handler: backend/lambda/auth/pre_signup/handler.py
- Trigger: Cognito User Pool PRE_SIGN_UP
- Purpose: validation and pre-sign-up hooks

### Define auth challenge
- Function: AuthDefineChallengeFunction
- Handler: backend/lambda/auth/define_auth_challenge/handler.py
- Trigger: Cognito User Pool DEFINE_AUTH_CHALLENGE
- Purpose: choose the next passwordless challenge step

### Create auth challenge
- Function: AuthCreateChallengeFunction
- Handler: backend/lambda/auth/create_auth_challenge/handler.py
- Trigger: Cognito User Pool CREATE_AUTH_CHALLENGE
- Purpose: generate OTP/magic link and send email
- Permissions: SES `SendEmail` / `SendRawEmail` on the verified From address identity
  and the derived domain identity ARN (`identity/<domain>` from `AuthEmailFromAddress`),
  so sending still works when SES authorizes by domain verification

### Verify auth challenge
- Function: AuthVerifyChallengeFunction
- Handler: backend/lambda/auth/verify_auth_challenge/handler.py
- Trigger: Cognito User Pool VERIFY_AUTH_CHALLENGE_RESPONSE
- Purpose: validate passwordless challenge response

### Post authentication
- Function: AuthPostAuthFunction
- Handler: backend/lambda/auth/post_authentication/handler.py
- Trigger: Cognito User Pool POST_AUTHENTICATION
- Purpose: update `custom:last_auth_time` after successful login

### Device attestation authorizer
- Function: DeviceAttestationAuthorizer
- Handler: backend/lambda/authorizers/device_attestation/handler.py
- Trigger: API Gateway request authorizer
- Purpose: verify device attestation JWTs for public asset endpoints

### Admin group authorizer
- Function: AdminGroupAuthorizerFunction
- Handler: backend/lambda/authorizers/cognito_group/handler.py
- Trigger: API Gateway request authorizer
- Purpose: verify JWT and check the user belongs to at least one staff Cognito group (`admin`, `manager`, or `instructor`)
- VPC: **No** (runs outside VPC to fetch JWKS from Cognito)
- Environment: `ALLOWED_GROUPS=admin,manager,instructor`

### User authorizer (any authenticated user)
- Function: UserAuthorizerFunction
- Handler: backend/lambda/authorizers/cognito_user/handler.py
- Trigger: API Gateway request authorizer
- Purpose: verify JWT for any authenticated Cognito user (no group requirement)
- VPC: **No** (runs outside VPC to fetch JWKS from Cognito)

### API token authorizer
- Function: ApiTokenAuthorizerFunction
- Handler: backend/lambda/authorizers/api_token/handler.py
- Trigger: API Gateway request authorizer
- Purpose: validate hashed `x-api-token` values against the `api_keys` table; pass `apiKeyId`, `scope` (`admin` / `user`), and `userSub=api-key:<id>` to handlers
- VPC: **Yes** (RDS Proxy + IAM as `evolvesprouts_admin`)
- Cache: 5 minutes (revoked tokens may remain usable until cache expiry)
- Concurrency: no per-function reserved concurrency in CDK (shared unreserved
  pool) so deploys remain valid when the account already reserves capacity on
  other Lambdas

## Deployment and maintenance Lambdas

### Migrations
- Function: EvolvesproutsMigrationFunction
- Handler: backend/lambda/migrations/handler.py
- Trigger: CloudFormation custom resource during deploy
- Purpose: run Alembic migrations and optional seed SQL
- DB access: direct cluster endpoint with password auth
- Audit: DML from Alembic, seed SQL, and `_sync_active_countries` sets
  `user_id = alembic` (also syncs `geographic_areas.active` from
  `ACTIVE_COUNTRY_CODES`)

### Import legacy CRM
- Function: ImportLegacyVenuesFunction (physical name `evolvesprouts-ImportLegacyVenuesFunction`)
- Handler: backend/lambda/imports/legacy_crm/handler.py — **entity dispatcher**; loads `app.imports` registry and runs the importer for `payload["entity"]`
- Supported entities: `venues`, `families`, `organizations`, `contacts`, `notes`, `link_contact_memberships`, `labels`, `event_services`, `event_instances`, `event_instance_tags`, `event_enrollments`, `event_discount_codes` (registry in `app.imports.entities`; workflow choice list must stay aligned)
- **`families` semantics:** Only legacy `family` rows with `kind='family'` **and** at least **two** non-deleted `person` rows sharing the same `family_id` become `families` rows (multi-contact households). Single-person legacy groups are imported as **contacts only** (no `families` row). Counter: `skipped_household_below_min_links`.
- **Dependency order (non-dry-run):** import `families` and `organizations` first when you want household/org membership links; then `contacts`, then `notes`. `DependencyNotMet` applies only to **`contacts`** → **`notes`** (contacts must exist in `legacy_import_refs`). `families` and `organizations` imports may be empty; **contacts always insert** from `person` rows. Membership (`family_members` / `organization_members`) is added only when the legacy `family_id` maps to a UUID in `legacy_import_refs` for `families` or `organizations`.
- **Events stack:** `venues`, `families`, `organizations`, `labels`, and `contacts` have no cross-dependency. Then `event_services` (optional deps: `venues`, `organizations`, `labels` — empty ref maps are allowed), `event_instances` (`DEPENDS_ON` includes `event_services`, `venues`, and `organizations` so partner-org refs are pre-loaded; `organizations` may be empty), `event_instance_tags` (`DEPENDS_ON` includes `event_instances`, `labels`, and `event_services` for `event_id`-scoped `event_label` rows), `event_enrollments` (PII), `event_discount_codes`. **Partner org fan-out:** a legacy `event` with `organization_id` produces one `service_instance_organizations` row per imported `event_date` instance when the legacy org id maps in `legacy_import_refs` for `organizations`; otherwise `partner_org_skipped_unmapped` increments (see response JSON / `diagnostics`). **`event_discount_codes`** has no `DEPENDS_ON` guard: scoped rows skip when refs are missing; global codes import anytime; the importer loads `event_services` / `event_instances` ref maps from the database when present. **Positional INSERTs:** when `CREATE TABLE` is absent, parsers try audit-column-first column counts before narrow fallbacks — keep full mysqldump DDL in the file when possible. **Timestamps:** mysqldump datetime values without a timezone are treated as UTC (same as other importers); if the source DB was local time, `enrolled_at` may appear shifted — compare against the legacy export, not wall-clock “now”.
- **`link_contact_memberships` (one-off backfill):** Re-reads the legacy `person` rows and inserts missing `family_members` / `organization_members` rows for contacts that were imported before their parent family/organization was in `legacy_import_refs`. Creates **no** new contacts/families/organizations; only links existing ones. Idempotent — existing memberships are counted and left untouched, and DB `UniqueConstraint` on `(family_id, contact_id)` / `(organization_id, contact_id)` prevents duplicates. `DEPENDS_ON=("contacts", "families", "organizations")`; `contacts` refs are required (guarded by `DependencyNotMet`), `families` / `organizations` are optional. Because `legacy_import_refs` is a soft pointer (no FK), the importer pre-filters each ref map to ids that still exist in `contacts` / `families` / `organizations` and counts the dropped rows as `stale_ref_rows_contacts` / `stale_ref_rows_families` / `stale_ref_rows_organizations`; persons skipped because their (previously mapped) contact or parent target was deleted are counted as `skipped_stale_contact_ref` / `skipped_stale_parent_ref` (distinct from `skipped_no_contact_mapping` / `skipped_no_parent_mapping` which indicate no mapping ever existed). Other diagnostics: `family_memberships_inserted`, `organization_memberships_inserted`, `family_memberships_existing`, `organization_memberships_existing`, `skipped_no_family_id`.
- **Dry-run previews:** When `dry_run` is true, the response includes `preview` and `row_details` for **all** entities (including PII entities), same as venues — so operators can review planned inserts. `preview_allowed` remains false for PII entities (workflow may still strip summary fields unless `dry_run` is true; see workflow `jq`).
- Trigger: direct `aws lambda invoke` (for example GitHub Actions after `dumps/<entity>/<run_id>/<entity>.sql` upload)
- Purpose: parse mysqldump text, write target CRM rows (`locations`, `contacts`, `notes`, events stack tables, etc.), record `legacy_import_refs` for idempotent re-imports
- DB access: RDS Proxy + IAM as `evolvesprouts_admin`; reads/writes `legacy_import_refs` for mapped ids
- Other: S3 read on import bucket; `HeadObject` size cap; temp SQL under `/tmp` with request id in the filename; **reserved concurrency 3** (parallel entity imports capped)
- Response JSON: `entity`, counts (`inserted`, `skipped_duplicate`, `skipped_excluded_key`, `skipped_no_area`, `skipped_location_no_area`, `skipped_no_dep`, `skipped_household_below_min_links`, `skipped_deleted`, `reused_existing_contact`, `skipped_invalid_title`, `skipped_invalid_range`, `skipped_invalid`, `skipped_location_unmapped`, `reused_existing_enrollment`, `partner_org_links_inserted`, `partner_org_skipped_unmapped`), `dry_run`, `preview_allowed` (false for `PII=True` importers in **non-dry-run** responses); when `dry_run` is true **or** `preview_allowed` is true, optional `preview` and `row_details`; optional `diagnostics` (e.g. contacts dependency ref counts, `skipped_membership_no_parent_ref`, event-instance partner-org counts)
- CloudWatch: completion log includes `import_row_details` (same structure as `row_details`) when `preview_allowed` and details exist
- Stack outputs: `ImportLegacyVenuesFunctionName` / `ImportLegacyFunctionName` (same value), `ImportDumpBucketName`
- Payload: `{ "entity": "<key>", "s3_bucket": "...", "s3_key": "...", "dry_run": <bool> [, "skip_legacy_keys": "<csv>"] }` — `s3_bucket` must match `IMPORT_DUMP_BUCKET_NAME`; optional `skip_legacy_keys` is a comma-separated list of legacy primary-key strings to skip. **Skip-key semantics:** all entities use the decimal string of the legacy integer primary key; `notes` uses legacy `note.id`.

**How to add a new entity**

1. Add `backend/src/app/imports/entities/<name>.py` implementing `LegacyImporter`, call `register(...)` at module bottom.
2. Import the module from `entities/__init__.py`.
3. Append the entity id to the workflow `entity` choice list in `.github/workflows/import-legacy-crm.yml`.
4. Add tests under `tests/imports/entities/` and extend handler/registry tests if needed.
5. Document the entity in this section and in `database-schema.md` if new tables are involved.

### Admin bootstrap
- Function: AdminBootstrapFunction
- Handler: backend/lambda/admin_bootstrap/handler.py
- Trigger: CloudFormation custom resource (optional)
- Purpose: create a bootstrap admin user and add to admin group
- VPC: No (Cognito public API only; no database access)

### API key rotation
- Function: ApiKeyRotationFunction
- Handler: backend/lambda/api_key_rotation/handler.py
- Trigger: EventBridge scheduled rule (every 90 days)
- Purpose: rotate the API Gateway API key to limit exposure from compromise
- Reliability: retries transient API Gateway and Secrets Manager failures with
  exponential backoff + jitter
- VPC: Yes
- Permissions: API Gateway key management, Secrets Manager read/write
- Environment:
  - `API_GATEWAY_REST_API_ID`: REST API ID
  - `API_GATEWAY_USAGE_PLAN_ID`: usage plan ID
  - `API_KEY_SECRET_ARN`: Secrets Manager ARN for key storage
  - `API_KEY_NAME_PREFIX`: prefix for key names
  - `GRACE_PERIOD_HOURS`: hours to keep old key active (default 24)

### Media request processor
- Function: MediaRequestProcessor
- Handler: backend/lambda/media_processor/handler.py
- Stack: nested stack `evolvesprouts-Messaging`
- Trigger: SQS queue (`evolvesprouts-media-queue`)
- Purpose: process media lead captures and fan out actions (including Mailchimp
  free-resource journey re-trigger on repeat requests during the transition
  period, and optional welcome journey for opted-in contacts)
- Actions: contact upsert in DB, idempotent sales lead creation, SES templated
  download-link email to the submitter, Mailchimp sync (merge fields + tag +
  optional free-resource Customer Journey trigger; consent-gated when
  `MAILCHIMP_REQUIRE_MARKETING_CONSENT=true`), optional welcome journey for
  `marketing_opt_in`, and SES **sales recap** on **new** media leads only (via
  proxy `ListUsersInGroup` to `ADMIN_GROUP`; duplicate re-downloads skip recap; not `SUPPORT_EMAIL`)
- DB access: RDS Proxy with IAM auth (`evolvesprouts_admin`)
- VPC: Yes
- Permissions: SES `SendEmail`, `SendRawEmail`, and `SendTemplatedEmail` (verified
  internal sender + `AuthEmailFromAddress` identities and derived domain ARNs),
  Secrets Manager read for Mailchimp API key,
  Lambda invoke permission for `AwsApiProxyFunction`
- Environment:
  - `DATABASE_SECRET_ARN`, `DATABASE_NAME`, `DATABASE_USERNAME`,
    `DATABASE_PROXY_ENDPOINT`, `DATABASE_IAM_AUTH`
  - `SES_SENDER_EMAIL`, `CONFIRMATION_EMAIL_FROM_ADDRESS`, `COGNITO_USER_POOL_ID`,
    `ADMIN_GROUP`, `AWS_PROXY_FUNCTION_ARN`, `SALES_RECAP_DISPLAY_TIMEZONE`
    (IANA timezone for media-lead recap **Submitted at**; CDK `SalesRecapDisplayTimezone`)
  - `MAILCHIMP_API_SECRET_ARN`, `MAILCHIMP_LIST_ID`,
    `MAILCHIMP_SERVER_PREFIX`
  - `MEDIA_DEFAULT_RESOURCE_KEY`
  - `ASSET_SHARE_LINK_BASE_URL`, `ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS`
    (same host allowlist as admin for auto-created share links),
    `MAILCHIMP_MEDIA_DOWNLOAD_MERGE_TAG` (optional Mailchimp merge field for stable
    `/v1/assets/email-download/{token}` download URL)
  - `MAILCHIMP_FREE_RESOURCE_JOURNEY_ID`, `MAILCHIMP_FREE_RESOURCE_JOURNEY_STEP_ID` (optional;
    Customer Journey API trigger after successful member sync; empty disables)
  - `MAILCHIMP_REQUIRE_MARKETING_CONSENT` (when `true`, gate legacy Mailchimp
    subscribe + free-resource journey on `marketing_opt_in`)
  - `MAILCHIMP_WELCOME_JOURNEY_ID`, `MAILCHIMP_WELCOME_JOURNEY_STEP_ID` (optional;
    shared welcome journey for opted-in contacts; empty disables)
  - `PUBLIC_WWW_CONFIG_SECRET_ARN` (Secrets Manager JSON object shared with the
    admin Lambda; provides `BASE_URL` for SES HTML shell logo/footer links and
    optional `INSTAGRAM_URL` / `LINKEDIN_URL` / `WHATSAPP_URL` /
    `BUSINESS_PHONE_NUMBER`. `wa.me/message/...` values are coerced to
    `wa.me/<digits>` for reliable email-client rendering. Lambdas read it via
    the existing Secrets Manager VPC interface endpoint with a five-minute
    in-process cache; see `app.config.public_www`.)

### Expense parser processor
- Function: ExpenseParserFunction
- Handler: backend/lambda/expense_parser/handler.py
- Stack: nested stack `evolvesprouts-Messaging`
- Trigger: SQS queue (`evolvesprouts-expense-parser-queue`)
- Purpose: process async invoice parse requests and enrich expense records
  using OpenRouter via `AwsApiProxyFunction`; when `vendor_id` is unset and the
  model returns `vendor_name`, attempts a unique match among **active** vendor
  organizations: case-insensitive exact trimmed name; else a single `ILIKE`
  substring hit when the vendor name contains the parsed string (only when the
  parsed string is long enough and not generic-only tokens); else, if the parsed
  string contains a specific vendor list name, the longest such match wins when
  unambiguous (covers legal invoice names vs shorter list labels). Weak matches
  never write `vendor_id`. Parsed vendor text is not stored on the expense row;
  only `vendor_id` is updated when a match is found.
  Parsed `subtotal` / `tax` / `total` accept common formatted strings (currency
  symbols, thousands separators, alternate keys such as `amount`), and infer
  `total` from line-item amounts when every line has an `amount` and top-level
  totals are missing.
  When `currency` is still unset, monetary strings that contain a bare `$` (not
  `HK$`, `S$`, etc.) and no other currency markers infer `USD`; the model may
  also return `$` as `currency`, which normalizes to `USD`.
- DB access: RDS Proxy with IAM auth (`evolvesprouts_admin`)
- VPC: Yes
- Permissions: S3 read for the assets bucket, Secrets Manager read for OpenRouter key,
  Lambda invoke permission for `AwsApiProxyFunction`
- Environment:
  - `DATABASE_SECRET_ARN`, `DATABASE_NAME`, `DATABASE_USERNAME`,
    `DATABASE_PROXY_ENDPOINT`, `DATABASE_IAM_AUTH`
  - `ASSETS_BUCKET_NAME`
  - `OPENROUTER_API_KEY_SECRET_ARN`, `OPENROUTER_CHAT_COMPLETIONS_URL`,
    `OPENROUTER_MODEL`, `OPENROUTER_MAX_FILE_BYTES`
  - `AWS_PROXY_FUNCTION_ARN`

### Bulk expense import processor
- Function: BulkExpenseImportFunction
- Handler: backend/lambda/bulk_expense_import/handler.py
- Stack: nested stack `evolvesprouts-Messaging`
- Trigger: SQS queue (`evolvesprouts-bulk-expense-import-queue`) with plain JSON bodies
  `{ "job_id": "<uuid>" }` (not SNS-wrapped)
- Purpose: run long-running OpenRouter **bulk** extraction for combined PDF imports
  queued by `POST /v1/admin/expenses/import-from-bulk-pdf`, then create expenses and
  mark the `bulk_expense_import_jobs` row `succeeded`, `succeeded_with_errors`, or `failed`
- DB access: RDS Proxy with IAM auth (`evolvesprouts_admin`)
- VPC: Yes
- Permissions: same OpenRouter + S3 + proxy invoke pattern as `ExpenseParserFunction`
- JSON robustness: every OpenRouter chat completion call sets
  `response_format={"type":"json_object"}`. When the model still returns text that
  fails `json.loads` (most often unescaped quotes inside line-item descriptions),
  the parser logs a redacted ±80-char snippet around the failure offset and
  retries once with a JSON-repair chat completion (no PDF re-attached, capped at
  60s). A second failure surfaces a snippet-bearing message instead of a bare
  `JSONDecodeError`. Once the response parses, the bulk parser tolerates several
  wrapper shapes — alias keys (`invoices`, `records`, `data`, `results`, `rows`,
  `items`, `expenses`, `transactions`, `charges`, `entries`), any single unknown
  list-of-dicts value, or a top-level dict that itself looks like one invoice
  (wrapped to a one-row import). An empty top-level object (`{}`, the model's
  only way of saying "nothing to extract" under JSON mode) is treated as zero
  rows. When the model returns no usable text at all (empty `content`, refusal,
  `finish_reason=length` truncation, content-filter block, or top-level error
  in the OpenRouter envelope), the parser raises a diagnostic message naming
  the cause and including `finish_reason` / `completion_tokens` rather than
  feeding empty text to `json.loads`.
- Call pattern: the bulk parser issues exactly **one** OpenRouter chat
  completion per import (mirroring the single-invoice parser at
  `parse_invoice_from_assets`), with the same system prompt and the
  configured PDF engine. **No JSON mode**; **no engine fallback chain**.
  This is the original synchronous call shape from PR #1624 / commit
  `b6f8990b` that worked before this path moved to async &mdash; layered
  fixes (JSON mode, multi-engine retries) were tried in subsequent
  iterations and rolled back because they introduced more failure modes
  than they fixed. Unescaped-quote `JSONDecodeError` cases (the original
  symptom that prompted JSON mode) are still handled, by the
  `_loads_with_repair` pathway instead.
- Transient retry (every chat completion): each `_openrouter_chat_completion`
  call retries up to **2 additional times** (3 attempts total) with
  exponential backoff (2s, 4s) on transient upstream failures &mdash; HTTP
  status `408`, `425`, `429`, `500`, `502`, `503`, `504`, AND on 2xx
  responses whose envelope contains an `error.code` in the same set
  (OpenRouter sometimes returns 200 with `code=504` when an upstream model
  call timed out). `Retry-After` headers are honored, capped to 5s.
  Non-retryable statuses (4xx other than 408/425/429) propagate
  immediately. The same retry policy applies to the JSON-repair sub-call.
- Single-invoice fallback: when the one bulk attempt produces no usable
  rows for any reason (empty model response, refusal, JSON parse failure,
  HTTP error including 4xx/5xx after retries, or zero rows after coercion),
  the bulk parser falls back to `parse_invoice_from_assets` on the same
  attachment and returns its result wrapped as a one-element list. If the
  fallback also fails, both errors are surfaced together in one message so
  neither failure is hidden.
- 4xx error formatting: OpenRouter error bodies are condensed to their
  `error.message` + `error.code` before being raised or logged so the
  persisted bulk-import job row stays readable and does not echo unrelated
  fields like `user_id` or the full response metadata.
- Timeout / budget: **600s** Lambda timeout with **720s** SQS visibility;
  the OpenRouter bulk call caps at **240s** plus an optional **60s**
  JSON-repair retry, so DB writes stay inside the Lambda window.
- Concurrency: no per-function reserved concurrency in CDK (shared unreserved pool) so
  deploys remain valid when the account already reserves capacity on other Lambdas
- Environment:
  - `BULK_IMPORT_LAMBDA_TIMEOUT_SECONDS` (mirrors Lambda timeout for stale `processing` handling)
  - `DATABASE_SECRET_ARN`, `DATABASE_NAME`, `DATABASE_USERNAME`,
    `DATABASE_PROXY_ENDPOINT`, `DATABASE_IAM_AUTH`
  - `ASSETS_BUCKET_NAME`
  - `OPENROUTER_API_KEY_SECRET_ARN`, `OPENROUTER_CHAT_COMPLETIONS_URL`,
    `OPENROUTER_MODEL`, `OPENROUTER_MAX_FILE_BYTES`
  - `AWS_PROXY_FUNCTION_ARN`

### Inbound invoice email processor
- Function: InboundInvoiceEmailProcessor
- Handler: backend/lambda/inbound_invoice_email/handler.py
- Trigger: SQS queue (`evolvesprouts-inbound-invoice-email-queue`) fed by SES
  receipt-rule notifications through SNS
- Purpose: convert inbound invoice email attachments (or synthetic body text
  when there are no supported files) into `assets`, `expenses`, and
  `expense_attachments` rows, then enqueue the existing expense parser workflow
- DB access: RDS Proxy with IAM auth (`evolvesprouts_admin`)
- VPC: Yes
- Permissions: S3 read/write for the assets bucket (including the
  `inbound-email/raw/` prefix), SNS publish to the expense parser topic
- Environment:
  - `DATABASE_SECRET_ARN`, `DATABASE_NAME`, `DATABASE_USERNAME`,
    `DATABASE_PROXY_ENDPOINT`, `DATABASE_IAM_AUTH`
  - `ASSETS_BUCKET_NAME`
  - `EXPENSE_PARSE_TOPIC_ARN`
  - `INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS` (optional comma-separated
    substrings; empty disables filtering; see `InboundInvoiceAllowedSenderPatterns`
    CDK parameter / GitHub var `CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS`)

### Inbox import processor
- Function: InboxImportFunction
- Handler: backend/lambda/inbox_import/handler.py
- Trigger: SQS queue (`evolvesprouts-inbox-import-queue`) with plain JSON bodies
  (`{"job_id": "<uuid>"}`)
- Purpose: process admin-queued Meta Graph conversation backfills (last 20
  message bodies per Instagram/Messenger thread; conversation list and
  per-thread messages are separate slim Graph calls that shrink `limit`
  when Graph rejects the payload) and WhatsApp Business App
  `.txt`/`.zip` export parses into the existing conversation tables. Creates
  missing contacts; does not create new sales leads.
- DB access: RDS Proxy with IAM auth (`evolvesprouts_admin`)
- VPC: Yes
- Timeout / budget: **600s** Lambda timeout with **720s** SQS visibility
- Permissions: S3 read on the assets bucket, Lambda invoke permission for
  `AwsApiProxyFunction`
- Environment:
  - `DATABASE_SECRET_ARN`, `DATABASE_NAME`, `DATABASE_USERNAME`,
    `DATABASE_PROXY_ENDPOINT`, `DATABASE_IAM_AUTH`
  - `AWS_PROXY_FUNCTION_ARN`
  - `ASSETS_BUCKET_NAME`
  - `META_PAGE_ACCESS_TOKEN` (CDK parameter `MetaPageAccessToken` /
    GitHub secret `CDK_PARAM_META_PAGE_ACCESS_TOKEN`; Graph Page or
    system-user token, not the webhook verify string). Conversations
    use a Page token; a system-user token is exchanged via
    `GET /{page-id}?fields=access_token`.
  - `META_PAGE_ID`, `META_INSTAGRAM_USER_ID`
  - `META_GRAPH_API_BASE_URL`, `META_GRAPH_API_VERSION`
  - `WHATSAPP_EXPORT_BUSINESS_NAMES`
  - `INBOX_IMPORT_LAMBDA_TIMEOUT_SECONDS`

### Eventbrite sync processor
- Function: EventbriteSyncProcessor
- Handler: backend/lambda/eventbrite_sync_processor/handler.py
- Trigger: SQS queue (`evolvesprouts-eventbrite-sync-queue`)
- Purpose: process async Eventbrite synchronization requests for event service instances
  and upsert Eventbrite event/ticket metadata while keeping DB as source of truth
- DB access: RDS Proxy with IAM auth (`evolvesprouts_admin`)
- VPC: Yes
- Permissions: Secrets Manager read for Eventbrite token, Lambda invoke permission
  for `AwsApiProxyFunction`
- Environment:
  - `DATABASE_SECRET_ARN`, `DATABASE_NAME`, `DATABASE_USERNAME`,
    `DATABASE_PROXY_ENDPOINT`, `DATABASE_IAM_AUTH`
  - `AWS_PROXY_FUNCTION_ARN`
  - `EVENTBRITE_API_BASE_URL`
  - `EVENTBRITE_ORGANIZATION_ID`
  - `EVENTBRITE_TOKEN_SECRET_ARN`

### AWS / HTTP proxy
- Function: AwsApiProxyFunction
- Handler: backend/lambda/aws_proxy/handler.py
- Trigger: Lambda-to-Lambda invocation (from in-VPC Lambdas)
- Purpose: generic proxy for AWS API calls and outbound HTTP requests
  that cannot be made from inside the VPC
- Timeout: 90s (aligned with `ExpenseParserFunction`, which invokes this Lambda for OpenRouter).
  Outbound HTTP `timeout` is capped at 60s so Graph inbox import can wait
  longer than the previous 30s urllib cap without exceeding this Lambda.
- VPC: **No** (runs outside VPC for internet access)
- Allow-lists:
  - `ALLOWED_ACTIONS`: comma-separated `service:action` pairs for AWS
    API calls (e.g. `cognito-idp:list_users`, `cognito-idp:list_users_in_group`)
  - `ALLOWED_HTTP_URLS`: comma-separated URL prefixes for outbound HTTP
    requests (e.g. `https://api.example.com/v1/`)
- Security: only invocable by Lambdas granted `lambda:InvokeFunction`;
  IAM role scoped to specific AWS actions; all requests validated
  against the allow-lists before execution
- Why: Cognito disables PrivateLink when ManagedLogin is configured on
  the User Pool, so a VPC endpoint cannot be used.  This proxy provides
  a reusable channel for any service that is unreachable via PrivateLink.
- Client: in-VPC Lambdas import `app.services.aws_proxy.invoke` (for
  AWS calls) or `app.services.aws_proxy.http_invoke` (for HTTP calls)
