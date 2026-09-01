# AWS Messaging Architecture

## Overview

Media leads, expense parsing, and related workloads are processed asynchronously using SNS + SQS messaging. This provides reliable, decoupled processing with automatic retries and dead letter queue support.

Most media and expense-parser pipelines (plus the SES template manager custom resource) are defined in a **nested CloudFormation stack** (`MessagingNestedStack` in `backend/infrastructure/lib/messaging-stack.ts`) so the root `evolvesprouts` stack stays under CloudFormation’s 500-resource limit. The shared `SqsEncryptionKey` KMS key remains in the root stack and is passed into that nested stack (and reused by inbound invoice queues in the root). Eventbrite sync uses a separate nested stack (`EventbriteSyncNestedStack` in `api-stack.ts`). Inbox history import (Meta Graph + WhatsApp export) uses `InboxImportNestedStack` in `api-stack.ts` (`evolvesprouts-inbox-import-queue`).

### Two-phase deploy (named resources → nested stack)

CloudFormation cannot move resources with fixed physical names (`queueName`, `topicName`, `functionName`) into a nested stack in one update without name collisions. Deploy in order:

1. **Phase 1** (commit that strips those physical names from the root-stack messaging resources): the stack replaces them with auto-generated names, freeing the original names.
2. **Phase 2** (nested `Messaging` stack): recreates the pipelines with the original explicit names inside the nested stack.

Between phases, drain SQS queues and DLQs where possible; expect brief SNS topic ARN churn and possible failed media publishes during replacement.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ASYNC PIPELINES (SNS → SQS → Lambda)                    │
│                                                                             │
│  Producer ──▶ SNS Topic ──▶ SQS Queue ──▶ Processor Lambda                 │
│                  │              │              │                            │
│                  │         (reliable      (DB, Mailchimp,                  │
│                  │          delivery)      SES, Eventbrite, …)            │
│                  ▼                                                          │
│            Dead letter queue (failed messages after retries)                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Public website transactional confirmations (SES)

The public website contact form, booking modal (`/www/v1/contact-us`,
`/www/v1/reservations`), and media download flow send **customer-facing**
confirmation or download-link emails
through **Amazon SES templated send** (`SendTemplatedEmail`). Templates are
stored in SES and upserted at deploy time by a **CloudFormation custom
resource** (`SesTemplateManagerFunction`) so runtime Lambdas only reference
template names. **Deploy ordering:** ship the stack that upserts SES templates
(or run the template manager custom resource) **before** or together with
Lambda code that references new template merge fields (for example subject
placeholders); otherwise `SendTemplatedEmail` can fail with missing-variable
errors until templates catch up.

- **From address**: `CONFIRMATION_EMAIL_FROM_ADDRESS` on the relevant Lambdas,
  sourced from the stack `AuthEmailFromAddress` parameter (SES-verified
  customer-facing mailbox, for example `hello@`).
- **Internal notifications**: plain-text **recap** emails for public forms use
  `SES_SENDER_EMAIL` as the From address and deliver to every verified **email**
  attribute on users in the Cognito **admin** group (via `ListUsersInGroup`
  through `AwsApiProxyFunction`; `COGNITO_USER_POOL_ID`, `ADMIN_GROUP`, and
  `AWS_PROXY_FUNCTION_ARN` on `MediaRequestProcessor`). The stack parameter
  `SupportEmail` maps to `SUPPORT_EMAIL` on the admin API Lambda only: it
  receives **contact-us** submissions with `signup_intent=contact_inquiry` (full
  inquiry form), not media or reservation recaps. Reservation recaps still go to
  `ADMIN_GROUP` emails; the intro-call booking recap body may include a support
  email line for operators when `SUPPORT_EMAIL` is configured.
- **Mailchimp** remains separate: optional marketing subscribe + journey
  triggers run only when the user opts in; failures are logged and do not
  change the HTTP response for public form routes.
- **Shared HTML shell footer** (`footer_block_html`): after the thank-you line,
  rule, and optional social links, a centered copyright line is appended using
  the **UTC year at send time** (`© <year> Evolve Sprouts. All rights reserved.`).
- **Booking confirmation** (`evolvesprouts-booking-confirmation-{locale}`): table
  shows **Service**, optional **Details** (My Best Auntie: cohort + age group;
  consultation: focus + level; omitted for generic event bookings), a single
  **Date & time** line (when the venue looks like Hong Kong and
  `primary_session_start_iso` is present, formatted as `16 April @ 18:00 HKT` in
  `Asia/Hong_Kong`; otherwise the submitted schedule labels are used). When the
  reservation payload includes `primary_session_end_iso` (or camelCase
  `primarySessionEndIso` on native routes) alongside the start,
  MIME booking confirmations may use it for the calendar attachment end time.
  **Location**
  as `venue, address` when both are provided, customer-facing **Payment method**
  (FPS / Credit Card / Bank Transfer), HKD totals with thousands separators, a
  horizontal rule before the closing note, a single **WhatsApp** + **FAQ** sentence
  with CTA links, and FPS pay instructions only when payment is pending and
  `payment_method` is `fps_qr` (plus a short “already paid” disclaimer).

## Components

Pipelines are documented below by domain (media, expenses, Eventbrite sync, inbound invoice email). Each uses SNS fan-out to an encrypted SQS queue, a processor Lambda, and a DLQ with a CloudWatch alarm.

## Message formats (by pipeline)

Payload shapes are defined by the publisher for each topic (for example
`media_request.submitted` on the media topic, `expense.parse_requested` on the
expense parser topic). See the corresponding Lambda handlers and OpenAPI specs
for fields.

Example shape (illustrative only):

```json
{
  "event_type": "<domain>.<action>",
  "...": "pipeline-specific fields"
}
```

## Eventbrite sync flow

Event service instances use a dedicated SNS/SQS pipeline so admin edits can
return quickly while Eventbrite synchronization runs asynchronously with retry
and DLQ support.

### SNS Topic: `evolvesprouts-eventbrite-sync-events`

- Receives sync events from admin service-instance create/update/delete flows.
- Fans out to subscribed SQS queue.

### SQS Queue: `evolvesprouts-eventbrite-sync-queue`

- Subscribes to Eventbrite sync SNS topic.
- 120 second visibility timeout.
- 3 retry attempts before DLQ.
- KMS encryption using the shared queue key.

### Dead Letter Queue: `evolvesprouts-eventbrite-sync-dlq`

- Receives Eventbrite sync messages that fail processing 3 times.
- 14 day retention for investigation.
- CloudWatch alarm triggers when messages appear.

### Lambda dead letter queue: `evolvesprouts-eventbrite-sync-processor-lambda-dlq`

- Holds payloads for **Lambda invocation failures** (for example unhandled exceptions
  surfaced as failed async invokes) for `EventbriteSyncProcessor`.
- Distinct from `evolvesprouts-eventbrite-sync-dlq`, which is the **SQS redrive**
  target after repeated receive/delete cycles on the main queue.
- 14 day retention; KMS encryption uses the same shared queue key as other Eventbrite
  sync queues.

### Processor Lambda: `EventbriteSyncProcessor`

- Triggered by `evolvesprouts-eventbrite-sync-queue`.
- Loads event instances from DB and computes an idempotency payload hash.
- Upserts Eventbrite event and ticket classes through `AwsApiProxyFunction`.
- Updates `service_instances` Eventbrite sync metadata fields
  (`eventbrite_sync_status`, `eventbrite_last_*`, ticket-class map, retry count).

## Media messaging flow

Media leads use a dedicated SNS/SQS pipeline to keep website submissions
responsive while decoupling downstream processing.

### SNS Topic: `evolvesprouts-media-events`

- Receives media lead events from `POST /v1/assets/free/request`.
- Fans out to subscribed SQS queue.

### SQS Queue: `evolvesprouts-media-queue`

- Subscribes to media SNS topic.
- 60 second visibility timeout.
- 3 retry attempts before DLQ.
- KMS encryption using the shared queue key.

### Dead Letter Queue: `evolvesprouts-media-dlq`

- Receives media messages that fail processing 3 times.
- 14 day retention for investigation.
- CloudWatch alarm triggers when messages appear.

### Processor Lambda: `MediaRequestProcessor`

- Triggered by `evolvesprouts-media-queue`.
- Upserts contact and inserts idempotent lead rows.
- Resolves media asset IDs by matching `resource_key` against `assets.resource_key`.
- Applies a resource-specific tag (`public-www-media-<resource_key>`) to the contact.
- Sends the **download link** to the submitter via **SES templated email**
  (`evolvesprouts-media-download-{locale}`) using `CONFIRMATION_EMAIL_FROM_ADDRESS`.
  The template includes follow-on guidance plus a highlighted “hands-on support”
  box; shell data supplies `my_best_auntie_url` (training course page) and
  `free_intro_call_url` (`https://wa.me/<digits>?text=...` when a business phone
  or digit `wa.me` path is configured; otherwise the localized contact page).
- Syncs subscriber/tag to Mailchimp through `AwsApiProxyFunction` (during a
  **transition** period this may still run for all submissions; when
  `MailchimpRequireMarketingConsent` is `true`, subscribe + free-resource journey
  run only when `marketing_opt_in` is true). When users opt in, a **separate**
  shared welcome journey may be triggered (empty journey env vars disable it).
- Sends an SES **sales recap** email (internal sender) to all verified emails on
  users in the Cognito group named by `ADMIN_GROUP` (today the admin group) on
  **first** media lead creation only (duplicate re-downloads skip the recap; not
  `SUPPORT_EMAIL`).

## Expense parsing flow

Expense invoice parsing uses a dedicated SNS/SQS pipeline to avoid blocking
admin API requests while files are parsed by OpenRouter.

### SNS Topic: `evolvesprouts-expense-parser-events`

- Receives parse events from admin expense APIs (`create`, `reparse`, `amend`).
- Fans out to subscribed SQS queue.

### SQS Queue: `evolvesprouts-expense-parser-queue`

- Subscribes to expense parser SNS topic.
- 180 second visibility timeout.
- 3 retry attempts before DLQ.
- KMS encryption using the shared queue key.

### Dead Letter Queue: `evolvesprouts-expense-parser-dlq`

- Receives expense parser messages that fail processing 3 times.
- 14 day retention for investigation.
- CloudWatch alarm triggers when messages appear.

### Processor Lambda: `ExpenseParserFunction`

- Triggered by `evolvesprouts-expense-parser-queue`.
- Loads attachment metadata from `expense_attachments` + `assets`.
- Fetches file bytes from S3 and calls OpenRouter via `AwsApiProxyFunction`.
- Updates `expenses` parse status and extracted fields.

## Bulk combined-PDF import flow

Admin `POST /v1/admin/expenses/import-from-bulk-pdf` enqueues work on a **direct**
SQS queue (no SNS) so OpenRouter can run longer than API Gateway limits while the
admin UI polls `GET /v1/admin/expenses/bulk-import-jobs/{job_id}` or lists recent
jobs via `GET /v1/admin/expenses/bulk-import-jobs`.

**Deduplication:** the queue is a standard SQS queue (at-least-once delivery). Each
message carries a unique `job_id`. The worker uses `bulk_expense_import_jobs.status`
(and `updated_at` for abandoned `processing` rows) to stay idempotent across
redeliveries. Retrying the **HTTP** enqueue creates a **new** `job_id` and therefore a
new import run—clients should not assume SQS deduplicates duplicate POST retries.

### SQS Queue: `evolvesprouts-bulk-expense-import-queue`

- Receives JSON messages `{ "job_id": "<uuid>" }` from `EvolvesproutsAdminFunction`.
- **720** second visibility timeout (above the **600** second worker Lambda timeout so
  a single invocation can finish before redelivery).
- 3 retry attempts before DLQ.
- KMS encryption using the shared queue key.

### Dead Letter Queue: `evolvesprouts-bulk-expense-import-dlq`

- Receives bulk import messages that fail processing 3 times.
- 14 day retention for investigation.
- CloudWatch alarm triggers when messages appear.

### Processor Lambda: `BulkExpenseImportFunction`

- Triggered by `evolvesprouts-bulk-expense-import-queue`.
- Loads `bulk_expense_import_jobs` rows, validates the PDF asset, calls OpenRouter
  bulk extraction via `AwsApiProxyFunction`, then creates one expense per parsed row.
- Uses the same OpenRouter + S3 + Secrets wiring as `ExpenseParserFunction`, with a
  **600** second Lambda timeout (`BULK_IMPORT_LAMBDA_TIMEOUT_SECONDS`) and a shorter
  OpenRouter client timeout so asset validation and DB writes retain headroom.
- Does **not** set per-function reserved concurrency (uses the account unreserved pool)
  so stacks stay deployable when other Lambdas already reserve capacity.

## Inbound invoice email flow

Inbound invoice emails use SES receipt rules plus the existing expense parser
topic so machine-only mailbox traffic can land directly in the expenses domain.

### Receiving address

- Public-facing mailbox stays `invoices@evolvesprouts.com` in iCloud Mail.
- iCloud forwards invoice mail to the SES-managed address on
  `inbound.evolvesprouts.com`.
- SES receipt rules match the inbound recipient and store the raw `.eml` in
  `AssetsBucket` under a reserved prefix.

### Raw email storage: `AssetsBucket` prefix `inbound-email/raw/`

- Stores the original raw email payload for replay/debugging inside the existing
  private assets bucket.
- Uses a reserved prefix so raw `.eml` objects stay separated from normal asset
  objects while still reusing the existing private bucket controls.

### SNS Topic: `evolvesprouts-inbound-invoice-email-events`

- Receives SES S3-action notifications for matching inbound emails.
- Fans out to the subscribed SQS queue.

### SQS Queue: `evolvesprouts-inbound-invoice-email-queue`

- Subscribes to the inbound invoice SNS topic.
- 60 second visibility timeout.
- 3 retry attempts before DLQ.
- KMS encryption using the shared queue key.

### Dead Letter Queue: `evolvesprouts-inbound-invoice-email-dlq`

- Receives inbound invoice messages that fail processing 3 times.
- 14 day retention for investigation.
- CloudWatch alarm triggers when messages appear.

### Processor Lambda: `InboundInvoiceEmailProcessor`

- Triggered by `evolvesprouts-inbound-invoice-email-queue`.
- Loads the raw email object from the inbound-email S3 bucket.
- Parses MIME headers and extracts supported invoice attachments, or—when
  there are no supported attachments—extracts visible text from the email body
  (`text/plain` preferred, otherwise stripped `text/html`) and stores it as a
  synthetic `text/plain` asset for parsing.
- When `INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS` is set (non-empty), rejects
  messages whose SES envelope `source` and RFC822 `From` both miss every
  comma-separated substring (case-insensitive); those rows are recorded as
  failed in `inbound_emails` without creating expenses.
- Creates `assets`, `expenses`, and `expense_attachments` rows.
- Tracks idempotency in the `inbound_emails` table using SES `messageId`.
- Reuses the existing `expense.parse_requested` topic after the expense row
  is created so `ExpenseParserFunction` performs the OpenRouter extraction.

## API behavior

HTTP request and response contracts for admin and public APIs live in
[`docs/api/public.yaml`](../api/public.yaml) and
[`docs/api/admin.yaml`](../api/admin.yaml). Publishers (for example
`POST /v1/assets/free/request` for media) validate input, write durable rows or
enqueue work, and return success responses appropriate to each route.

## Error handling

| Scenario | Behavior |
|----------|----------|
| SNS publish fails | Caller logs or surfaces an error; the client can retry |
| Processor fails | SQS retries up to 3 times |
| All retries fail | Message moves to DLQ, alarm triggers |
| Email send fails | Logged but doesn't fail processing (where best-effort) |

## Idempotency

Each pipeline defines its own idempotency (for example `inbound_emails` for
inbound invoice email, lead/contact keys for media). SQS may deliver more than
once, so consumers should use stable keys or database constraints where needed.

Inbound invoice processing uses the SES `mail.messageId` value stored in
`inbound_emails.ses_message_id` to prevent duplicate expense creation across
SQS retries or mailbox forwarding duplicates.

## Files

| File | Description |
|------|-------------|
| `backend/infrastructure/lib/api-stack.ts` | CDK infrastructure |
| `backend/src/app/api/admin.py` | API handler with SNS publish and public calendar feed routing |
| `backend/lambda/media_processor/handler.py` | SQS media request processor |
| `backend/lambda/bulk_expense_import/handler.py` | SQS bulk combined-PDF import processor |
| `backend/lambda/ses_template_manager/handler.py` | CloudFormation custom resource — upsert SES email templates |
| `backend/lambda/inbound_invoice_email/handler.py` | SQS inbound invoice email processor |
| `backend/src/app/services/inbound_invoice_ingest.py` | Expense + asset creation from inbound email |

## Environment Variables

### API Lambda

| Variable | Description |
|----------|-------------|
| `MEDIA_REQUEST_TOPIC_ARN` | SNS topic ARN for media events (required) |
| `EXPENSE_PARSE_TOPIC_ARN` | SNS topic ARN for expense parser events (required) |
| `BULK_EXPENSE_IMPORT_QUEUE_URL` | SQS queue URL for async bulk combined-PDF imports (admin enqueue) |
| `EVENTBRITE_SYNC_TOPIC_ARN` | SNS topic ARN for Eventbrite sync events (required for Eventbrite DB-sync) |
| `CONFIRMATION_EMAIL_FROM_ADDRESS` | SES-verified from address for customer-facing templated emails on legacy public routes (`EvolvesproutsAdminFunction`) |
| `PUBLIC_WWW_CONFIG_SECRET_ARN` | Secrets Manager JSON object whose `BASE_URL` field is the HTTPS origin of the public website (Contact Us FAQ anchor in contact confirmation templates: `/{locale}/contact-us#contact-us-faq`); see `app.config.public_www`. Other fields supply social URLs / business info / AR-invoice content for the admin Lambda. |
| `MAILCHIMP_API_SECRET_ARN` | Mailchimp API key secret (marketing subscribe after opt-in on legacy routes) |
| `MAILCHIMP_LIST_ID` | Mailchimp audience ID |
| `MAILCHIMP_SERVER_PREFIX` | Mailchimp API host prefix |
| `MAILCHIMP_WELCOME_JOURNEY_ID` | Optional shared welcome journey ID (empty disables) |
| `MAILCHIMP_WELCOME_JOURNEY_STEP_ID` | Optional welcome journey entry step ID (empty disables) |
| `SES_SENDER_EMAIL` | Verified SES sender for internal sales recap emails |
| `SALES_RECAP_DISPLAY_TIMEZONE` | IANA timezone id for **Submitted at** in sales recap bodies. CDK passes the stack parameter `SalesRecapDisplayTimezone` (deploy maps GitHub var `CDK_PARAM_SALES_RECAP_DISPLAY_TIMEZONE` via `production.json`). Empty string uses the app built-in default. Invalid values log a warning and fall back to the same default. |
| `SUPPORT_EMAIL` | Inbox for full **contact_inquiry** contact-us notifications only |
| `COGNITO_USER_POOL_ID` | User pool used with `ADMIN_GROUP` to resolve sales recap recipient emails |
| `ADMIN_GROUP` | Cognito group whose verified emails receive public-form **sales** recaps (default `admin`; today this is the admin group) |
| `AWS_PROXY_FUNCTION_ARN` | Invoked for `cognito-idp:ListUsersInGroup` from the in-VPC admin Lambda |

### Processor Lambda

| Variable | Description |
|----------|-------------|
| `DATABASE_SECRET_ARN` | Database credentials secret |
| `DATABASE_PROXY_ENDPOINT` | RDS Proxy endpoint |
| `SES_SENDER_EMAIL` | Verified SES sender address (sales recap + download emails) |
| `SALES_RECAP_DISPLAY_TIMEZONE` | Same as API Lambda: from `SalesRecapDisplayTimezone` / `CDK_PARAM_SALES_RECAP_DISPLAY_TIMEZONE`; empty uses app default. |
| `COGNITO_USER_POOL_ID` | User pool for resolving `ADMIN_GROUP` emails (media lead sales recaps) |
| `ADMIN_GROUP` | Cognito group whose verified `email` attributes receive media lead sales recaps |
| `MAILCHIMP_API_SECRET_ARN` | Existing secret ARN for Mailchimp API key |
| `MAILCHIMP_LIST_ID` | Mailchimp list ID |
| `MAILCHIMP_SERVER_PREFIX` | Mailchimp server prefix (for example `us21`) |
| `MEDIA_DEFAULT_RESOURCE_KEY` | Default resource key used when request payload omits `resource_key` |
| `ASSET_SHARE_LINK_BASE_URL` | HTTPS base for Mailchimp download URLs at `/v1/assets/email-download/{token}` (media processor; asset download domain) |
| `ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS` | Comma-separated Referer/Origin hostnames allowed for new share links (media processor; same value as admin) |
| `MAILCHIMP_MEDIA_DOWNLOAD_MERGE_TAG` | Mailchimp merge field tag for that email-download URL (e.g. `MMDLURL`; empty disables) |
| `MAILCHIMP_FREE_RESOURCE_JOURNEY_ID` | Mailchimp Customer Journey ID for `.../journeys/{id}/steps/.../actions/trigger` (empty disables) |
| `MAILCHIMP_FREE_RESOURCE_JOURNEY_STEP_ID` | Journey step ID paired with `MAILCHIMP_FREE_RESOURCE_JOURNEY_ID` (empty disables) |
| `CONFIRMATION_EMAIL_FROM_ADDRESS` | SES-verified from address for media download link email to the submitter |
| `MAILCHIMP_REQUIRE_MARKETING_CONSENT` | When `true`, gate legacy Mailchimp subscribe + free-resource journey on `marketing_opt_in` |
| `MAILCHIMP_WELCOME_JOURNEY_ID` | Optional shared welcome journey ID for opted-in media leads (empty disables) |
| `MAILCHIMP_WELCOME_JOURNEY_STEP_ID` | Optional welcome journey entry step ID (empty disables) |
| `PUBLIC_WWW_CONFIG_SECRET_ARN` | Secrets Manager JSON object shared with the admin Lambda; supplies `BASE_URL` (HTTPS origin of the public website) for SES HTML shell logo/footer links and optional `INSTAGRAM_URL` / `LINKEDIN_URL` / `WHATSAPP_URL` / `BUSINESS_PHONE_NUMBER` for the same shell. Loaded once per cold start and cached for five minutes (`app.config.public_www`). |
| `AWS_PROXY_FUNCTION_ARN` | Lambda ARN for AWS proxy (`ListUsersInGroup` for sales recap recipients) |
| `OPENROUTER_API_KEY_SECRET_ARN` | Existing secret ARN for OpenRouter API key |
| `OPENROUTER_CHAT_COMPLETIONS_URL` | OpenRouter chat completion URL |
| `OPENROUTER_MODEL` | OpenRouter model identifier |
| `OPENROUTER_MAX_FILE_BYTES` | Attachment size limit for parser |
| `ASSETS_BUCKET_NAME` | Existing private assets bucket for expense attachments |
| `EXPENSE_PARSE_TOPIC_ARN` | SNS topic ARN for expense parser events |
| `EVENTBRITE_API_BASE_URL` | Eventbrite API base URL for sync processor |
| `EVENTBRITE_ORGANIZATION_ID` | Eventbrite organization ID used for event upserts |
| `EVENTBRITE_TOKEN_SECRET_ARN` | Secrets Manager ARN for Eventbrite API token JSON |

## Stack Outputs

| Output | Description |
|--------|-------------|
| `MediaTopicArn` | SNS topic ARN for media events |
| `MediaQueueUrl` | SQS queue URL for media processing |
| `MediaDLQUrl` | Dead letter queue URL for failed media requests |
| `ExpenseParserTopicArn` | SNS topic ARN for expense parser events |
| `ExpenseParserQueueUrl` | SQS queue URL for expense parser processing |
| `ExpenseParserDLQUrl` | Dead letter queue URL for failed expense parser jobs |
| `BulkExpenseImportQueueUrl` | SQS queue URL for async bulk combined-PDF imports |
| `BulkExpenseImportDLQUrl` | Dead letter queue URL for failed bulk import jobs |
| `EventbriteSyncTopicArn` | SNS topic ARN for Eventbrite sync events |
| `EventbriteSyncQueueUrl` | SQS queue URL for Eventbrite sync processing |
| `EventbriteSyncDLQUrl` | Dead letter queue URL for failed Eventbrite sync jobs (SQS redrive) |
| `EventbriteSyncProcessorLambdaDLQUrl` | Dead letter queue URL for failed EventbriteSyncProcessor Lambda invocations |
| `InboundInvoiceRecipientAddress` | SES-managed recipient address for invoice automation |
| `InboundInvoiceRawEmailPrefix` | Reserved object-key prefix for raw inbound invoice emails |
| `InboundInvoiceTopicArn` | SNS topic ARN for inbound invoice email events |
| `InboundInvoiceQueueUrl` | SQS queue URL for inbound invoice email processing |
| `InboundInvoiceDLQUrl` | Dead letter queue URL for failed inbound invoice emails |
| `InboundInvoiceMxTarget` | MX target for the SES inbound subdomain |

## Monitoring

- **DLQ Alarm**: Triggers when messages land in DLQ
- **CloudWatch Logs**: Both API and processor Lambda log to CloudWatch
- **X-Ray**: Tracing enabled for request flow visibility
