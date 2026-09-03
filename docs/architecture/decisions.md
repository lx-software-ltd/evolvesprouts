# Architecture Decisions

This document captures the agreed architecture decisions for the
Flutter mobile app, Next.js admin console, and AWS serverless backend.

## 1) Admin Web Router

**Decision:** Use Next.js App Router (React Server Components).

**Why:**
- Modern Next.js architecture (RSC, streaming, Suspense).
- Better performance and SSR defaults.
- Improved DX (layouts, loading, error boundaries).
- Best TypeScript support and forward compatibility.

**Canonical structure:**
- `apps/admin_web/src/app/...` with route groups and nested layouts.

## 2) Infrastructure as Code

**Decision:** AWS CDK (TypeScript) + CDK Pipelines.

**Why:**
- TypeScript-first IaC aligned with the frontend stack.
- Full AWS construct coverage and strong integration.
- Programmatic abstractions (loops, conditions, helpers).
- Self-mutating pipelines with approval gates and rollbacks.

**Canonical structure:**
- `backend/infrastructure/` contains CDK app, stacks, and pipeline.
- Deploy workflows detect and reuse existing database resources and VPCs
  to avoid replacements.
- Imports use environment variables for existing resource identifiers,
  including security groups and Secrets Manager references.

## Database schema (Aurora PostgreSQL)

**Decisions:**
- Geographic filtering uses `locations.area_id` (FK to `geographic_areas`).
- Times are stored in UTC.
- DB changes are versioned with Alembic.
- Lambda connections use RDS Proxy for connection pooling.
- RDS Proxy uses IAM authentication; Lambda generates IAM tokens.
- IAM DB roles `evolvesprouts_app` (read) and `evolvesprouts_admin` (write)
  are created via migrations and granted `rds_iam`.
- DB connections enforce TLS and use small pools tuned for Lambda.
- Migrations Lambda uses password auth directly against the cluster endpoint.

**Core tables:**
- `locations`
- `geographic_areas`
- `assets`
- `asset_access_grants`
- `audit_log`

**Migrations:**
- Alembic config and migrations live in `backend/db/`.
- Seed data lives in `backend/db/seed/seed_data.sql`.

## Unified CRM notes storage

**Decision:** Store all CRM notes (standalone contact notes, lead-attached notes, and
legacy mysqldump imports) in a single `notes` table with explicit FK columns to
contacts, families, organizations, and sales leads.

**Why:** The previous split (`crm_notes` vs polymorphic `notes` + `note_entity_links`)
duplicated concepts and complicated imports. One table keeps the model coherent,
lets legacy import target the same storage as interactive CRM notes, and preserves
`legacy_import_refs` mapping (legacy `note.id` → first inserted row when a note
links multiple contacts).

**Migration:** `0028_unify_notes_storage` backfills polymorphic contact-linked rows,
drops the old polymorphic tables, renames `crm_notes` → `notes`, and adds nullable
`took_at` for legacy provenance (not exposed in the admin API).

## API Contracts

**Decisions:**
- OpenAPI contracts live under `docs/api/` and are the single source
  of truth for all API endpoint details (paths, methods, parameters,
  request/response schemas, authentication requirements).
- Currently wired API Gateway contract: [`docs/api/admin.yaml`](../api/admin.yaml).
- Public endpoint contract: [`docs/api/public.yaml`](../api/public.yaml).
- API client generation is handled via generalized scripts in
  `scripts/codegen/`.
- **Do not duplicate endpoint details in architecture docs.** Always
  link to the OpenAPI specs instead.

## Lambda Implementation

**Decisions:**
- Lambda entrypoints live under `backend/lambda/**`.
- Shared application code lives under `backend/src/app`.
- Python dependencies are listed in `backend/requirements.txt`.
- Database migrations and seed are executed during CDK deploy
  via a custom resource Lambda.
- Lambda packaging is deterministic (no bytecode) to reduce no-op deploys.

## AR invoice PDFs (FPS QR)

**Decision:** Customer AR invoice PDFs (`billing-invoice-v21`) use a two-page layout when payment instructions apply (positive total with bank details and/or an HKD FPS QR). The first page ends with terms, a centred bold line directing readers to the next page, and a bottom footer plus `page/total` page numbers. The second **Payment Options** page uses two bullet sections (`• By Bank Transfer:` and `• By FPS scanning the following QR code:`), with the bullet glyph hanging at column 0 and only "Bank Transfer" / "FPS" in bold. Bank-account lines and the FPS logo + QR row are nested one tab-stop (12 mm) further right than the bullet headings; the FPS logo box is sized to match the QR (35 mm wide) so the logo + QR cluster stays within the left half of the page rather than extending toward the right margin. Each section's payment-confirmation line ("Please send the payment confirmation...") sits flush with its bullet heading text (no further indent), separated from the bank account lines by double line-height gaps before and after. The page closes with a centred bold **Thank you!** separated from the previous block by a triple-sized vertical gap. Optional `PUBLIC_WWW_BILLING_EMAIL` (GitHub `NEXT_PUBLIC_BILLING_EMAIL`, propagated through `deploy-backend.yml` to the CDK `PublicWwwBillingEmail` parameter) is interpolated into payment-confirmation copy. Non-HKD invoices, missing FPS configuration, or failed FPS payload builds skip the QR while still emitting the bank-only block when bank fields are set. **Zero-total** invoices (``total == 0``) omit the due date and payment instructions and end with a single centred bold **Nothing to pay, thank you!** after totals (same cue band as the payable refer line), with no second page. **Negative** totals omit the due date and omit payment instructions and that acknowledgement line.

**Why:** Keeps payment instructions consistent with the FPS path customers already see while avoiding misleading due dates or bank/FPS prompts on zero-amount documents, and gives zero-balance invoices a concise acknowledgement without an empty trailing page.

## Authentication

**Decisions:**
- Public asset routes use API key + device attestation; admin asset
  routes require Cognito `admin` group; user asset routes require
  any valid JWT.
- Admin and manager groups are created via CDK.
- Admin bootstrap user can be created with CDK parameters.
- Authentication is passwordless: email custom challenge (OTP + optional magic
  link) and federated sign-in via Google (OIDC).
- Device attestation validates JWTs against a JWKS URL configured in CDK
  parameters.
- Hosted UI uses OAuth code flow with callback/logout URLs supplied via CDK
  parameters.
- API keys are rotated every 90 days by a scheduled Lambda.
- API Gateway stage caching is disabled; public website cacheability is driven
  by Lambda `Cache-Control` headers and the `public_www` CloudFront `www/*`
  cache policy (see architecture overview).
  Checkov rule CKV_AWS_120 ("API Gateway caching enabled") is suppressed at the
  stage level via CDK template metadata with a justified comment; re-enabling a
  cache cluster would require removing that suppression and opting individual
  methods into `cachingEnabled: true`.
- See the OpenAPI specs for per-endpoint authentication requirements:
  [`docs/api/admin.yaml`](../api/admin.yaml).

## AWS / HTTP Proxy

**Decision:** Use a generic proxy Lambda outside the VPC instead of per-service
Lambdas or NAT Gateway.

**Why:**
- Cognito disables PrivateLink when ManagedLogin is configured on the User Pool,
  so a `cognito-idp` VPC endpoint cannot be used.
- A NAT Gateway is expensive (~$45/month per AZ) for occasional API calls.
- A per-service Lambda (e.g. dedicated Cognito Lambda) duplicates routing,
  auth, and business logic.

**How:**
- `AwsApiProxyFunction` runs outside the VPC and accepts two request types:
  - `type: "aws"` – executes a boto3 call (e.g. `cognito-idp:list_users`)
  - `type: "http"` – makes an outbound HTTP request to an external API
- Requests are validated against environment-variable allow-lists:
  - `ALLOWED_ACTIONS` for AWS API calls (`service:action` pairs)
  - `ALLOWED_HTTP_URLS` for HTTP requests (URL prefixes)
- In-VPC Lambdas invoke the proxy via Lambda-to-Lambda (requires a Lambda VPC
  endpoint).
- Client helpers in `backend/src/app/services/aws_proxy.py`:
  - `invoke(service, action, params)` for AWS calls
  - `http_invoke(method, url, headers, body, timeout)` for HTTP calls
- Current consumers include Cognito admin operations, Turnstile verification,
  Mailchimp sync, and expense invoice parsing (OpenRouter).

**Security:**
- IAM role scoped to specific AWS actions on specific resources.
- Allow-lists prevent the proxy from being used for unintended operations.
- Only Lambdas explicitly granted `lambda:InvokeFunction` can call the proxy.

## Flutter Amplify Configuration

**Decisions:**
- Amplify config is passed via `--dart-define=AMPLIFY_CONFIG=...`.
- API name is set with `--dart-define=AMPLIFY_API_NAME=...`.

## 3) CI/CD Authentication

**Decision:** GitHub Actions OIDC + IAM role assumption.

**Why:**
- No long-lived AWS keys stored in GitHub.
- Short-lived credentials with automatic rotation.
- Fine-grained IAM permissions and auditability.

## 4) Mobile Distribution

**Decision:** Android AAB + iOS App Store Connect/TestFlight.

**Why:**
- Google Play requires AAB for production.
- App Store Connect + TestFlight for production and beta.

**Notes:**
- CI uploads AAB to Play Console when service account secrets are set.
- Android signing uses a keystore injected at build time in CI.
- Android signing templates live in `apps/evolvesprouts_app/android/`.
- CI uploads IPA to TestFlight when App Store API keys are set.
- iOS signing uses Fastlane match with a private certificates repo.
- Fastlane config lives in `apps/evolvesprouts_app/ios/fastlane`.
- iOS export settings are templated at
  `apps/evolvesprouts_app/ios/ExportOptions.plist.template`
  and generated in CI.

## 5) Amplify Usage

**Decision:** Use Amplify for client SDKs and hosting where appropriate.

**Notes:**
- Amplify SDKs are used for auth/API integration on client apps.
- Infrastructure is provisioned via CDK for stronger control.
- Admin web hosting is triggered via GitHub Actions using
  `aws amplify start-job`.
- Promotions from staging to production are handled via the
  `amplify-promote` workflow.
- The `amplify-promote` workflow uses the production environment to
  support GitHub approval gates.

## 6) Public Website Release Promotion (S3 + CloudFront)

**Decision:** Use immutable artifact promotion from staging to production for
`apps/public_www`.

**Why:**
- Guarantees production receives the exact artifact validated on staging.
- Avoids drift between staging verification and production rollout.
- Supports deterministic rollback by re-promoting a previous release ID.

**Notes:**
- Public Website stack: `evolvesprouts-public-www`
- Staging URL: `www-staging.evolvesprouts.com`
- Production URL: `www.evolvesprouts.com`
- The stack owns separate staging and production S3 + CloudFront assets.
- Pushes to `main` deploy to staging and store artifact snapshots under
  `releases/<release_id>/`.
- Staging deploys update `releases/latest-release-id.txt` to track the most
  recent validated staging build.
- Manual promotion copies `releases/<release_id>/` from staging bucket to
  production bucket root and invalidates production CloudFront.
- Promotion workflow supports either an explicit `release_id` or
  `latest_staging` mode.
- Staging adds `X-Robots-Tag: noindex, nofollow, noarchive` at CloudFront.

## 7) Lockfile Enforcement

**Decision:** Lockfiles are required and validated in CI.

**Notes:**
- Flutter: `pubspec.lock`
- Node.js: `package-lock.json`
- iOS: `Podfile.lock`
- CI workflow: `.github/workflows/check-lockfiles.yml`

## 8) Dependency Updates

**Decision:** Use Dependabot for automated dependency updates.

**Why:**
- Automatic security vulnerability alerts and patches.
- Small, frequent updates are easier to review than large version jumps.
- PR-based workflow integrates with existing CI checks.
- Low maintenance overhead once configured.

**Configuration (`.github/dependabot.yml`):**
- GitHub Actions, npm, pip, and pub ecosystems covered.
- Weekly schedule (Mondays) to reduce PR noise.
- Dependencies grouped by category (AWS CDK, Firebase, database, etc.).
- Major version updates ignored to require manual review.
- PRs labeled by ecosystem (`dependencies`, `ci`, `backend`, `mobile`, `infrastructure`).

**Dependabot commands:**
- `@dependabot merge` - Merge when CI passes.
- `@dependabot ignore this major version` - Stop updates for this major version.
- `@dependabot ignore this dependency` - Stop all updates for this dependency.

## 9) GitHub Rulesets

**Decision:** Protect `main` branch and release tags with GitHub rulesets.

**Why:**
- Prevents accidental direct pushes to production branch.
- Enforces code review before merging.
- Ensures CI checks pass before deployment.
- Protects release tags from modification or deletion.

**Branch protection for `main`:**
- Require pull request with at least 1 approval.
- Require `lint` and `test` status checks to pass.
- The `lint` workflow includes `.cursorrules` contract validation via
  `scripts/validate-cursorrules.sh`.
- Require branches to be up to date before merging.
- Block force pushes and deletions.

**Tag protection:**
- Protect `v*` tags from deletion and modification.

**Verification:**
- Weekly CI workflow (`.github/workflows/verify-rulesets.yml`) validates configuration.
- See `docs/architecture/github-rulesets.md` for setup instructions.

## 10) Web Analytics (Google Tag Manager)

**Decision:** Use Google Tag Manager with a runtime hostname allowlist gate.

**Why:**
- GTM provides a single container for GA4 and future marketing tags without
  code changes.
- Runtime hostname check preserves the immutable artifact promotion model --
  the same HTML serves staging and production.
- Zero analytics footprint on non-production hosts (no `dataLayer`, no network
  requests, no tracking).

**How:**
- The GTM container ID is baked into the HTML at build time via
  `NEXT_PUBLIC_GTM_ID` (stored as a GitHub Actions variable).
- An optional host allowlist is provided via `NEXT_PUBLIC_GTM_ALLOWED_HOSTS`
  (comma-separated hostnames). When unset, the gate defaults to the hostname
  from `NEXT_PUBLIC_SITE_ORIGIN`.
- `apps/public_www/public/scripts/init-gtm.js` reads `data-gtm-id` and
  `data-gtm-allowed-hosts` from the `<html>` element and checks
  `window.location.hostname`.
- GTM initializes only when the current hostname is in the configured
  allowlist.
- The build-time CSP injection (`inject-csp-meta.mjs`) conditionally adds
  Google domains to `script-src` and `connect-src` when GTM is detected in
  the build output.

**Security:**
- No `<noscript>` iframe is rendered (avoids analytics hits from JS-disabled
  clients on staging).
- CSP Google domain allowlists are only included when the GTM bootstrap
  script is present in the HTML.

## 11) Asset Download Delivery and Stable Share Links

**Decision:** Use CloudFront-signed URLs for asset downloads and keep stable
share URLs as database-backed bearer tokens.

**Why:**
- S3 presigned URLs have strict validity limits and do not satisfy long-lived
  sharing requirements.
- Stable links must remain constant while still supporting revoke/rotate
  controls after accidental exposure.
- CloudFront signed URLs provide cryptographic validation while allowing
  long expiry windows.

**How:**
- `asset_share_links` stores one stable token per asset.
- Admin APIs create/reuse, rotate, and revoke each asset token.
- Public route `/v1/assets/share/{token}` resolves the token and redirects to
  a fresh CloudFront-signed URL for the underlying S3 object.
- Public route `/v1/assets/email-download/{token}` uses the same token lookup and
  redirect but omits the Referer/Origin allowlist check for email client flows.
- API Gateway enforces an API key on these routes and the media CloudFront
  behaviors inject `x-api-key` at origin so browser users do not need to
  provide credentials directly.
- Each share link stores an admin-managed `allowed_domains` list; resolution on
  `/v1/assets/share/{token}` is denied unless Referer/Origin matches one of the
  configured domains.
- Share links that resolve to `restricted` assets also require a valid Cognito
  JWT on both paths, preserving the "restricted means logged-in" rule.
- CloudFront public key material is configured in infrastructure; matching
  private key material is stored in AWS Secrets Manager and loaded by Lambda.

## 12) Admin Web Section Ordering (superseded)

**Status:** Superseded by "Admin web table-first, expand-in-place layout"
below. Kept for history because several screens still render the older
editor-above-list layout until they are migrated.

**Original decision:** In admin web screens, edit/create sections appeared above
list sections so the edit context was visible before browsing/filtering lists.

## Admin web table-first, expand-in-place layout

**Decision:** Every admin CRUD screen renders filters, then the table, with no
listing title, inside one untitled white card. Selecting a row expands an
editor directly beneath that row (one open at a time, animated, URL-synced,
framed on all four sides by one 2px rule); creating a record inserts a draft
row with its editor open. Editors have no title or subtitle and no Cancel button (one
primary action; collapsing the row is how the operator leaves), fields are laid
out 1, 2, or 4 per row with white-background controls, and Operations-column
controls are icon-only buttons of one size with a border, white background, and
tooltip, collapsing to a three-dots overflow menu beyond two actions.

Shared primitives in `apps/admin_web/src/components/ui/`:

| Concern | Primitive |
|---------|-----------|
| Filters above the table, trailing labelled create control (`New contact`) | `AdminFilterBar`, `AdminFilterField`, `AdminCreateButton` |
| Table shell with skeleton, empty, and load-more states | `AdminRecordTable` |
| Row that expands into an editor | `AdminExpandableRow` (+ `useExpandedRecord` hook) |
| Editor body and single action row | `AdminEditorPanel`, `AdminEditorActions` |
| 1 / 2 / 4 fields per row | `AdminFieldGrid`, `AdminField` |
| Sub-accordions inside an editor | `AdminDisclosure` |
| Operations column | `AdminRowActions`, `AdminIconButton`, `AdminIconLink` |
| Animated show/hide | `AdminExpandRegion` + motion tokens in `globals.css` |
| Unsaved-edit guard when switching rows | `AdminDiscardChangesDialog` |
| In-flight API call from a button (spinner + `Saving…`) | `Button loading`, `AdminEditorActions isSaving`, `ConfirmDialog confirmLoading` |

Editor hooks in `apps/admin_web/src/hooks/` shared by the migrated screens:
`useEntityPanelEditorShell` owns the expanded row, dirty flag, and confirm
dialog (`editorMode` and `selectedId` derive from the expanded id);
`useExpandedRecordForm` applies the row to field state once per expansion,
fetches deep-linked records missing from the loaded pages and returns them as
a pinned row, and collapses unresolvable ids.

**Why:**
- The editor-above-list layout pushed the data the operator came for below the
  fold and forced a scroll on every row selection. Opening the editor in place
  keeps the surrounding rows visible for context and removes the jump.
- Titles on listing cards and editors duplicated the nav label and cost
  vertical space on every screen.
- Operations columns had drifted across screens (text buttons, mixed sizes,
  filled backgrounds). One icon-only control size with a tooltip and an
  overflow menu beyond two actions keeps rows scannable and stops the column
  widening as actions are added.
- One open row plus URL sync gives deep-linkable edit state (`?record=<id>`)
  and a single place to guard unsaved changes.
- A Cancel button in the editor duplicated the collapse affordances (chevron,
  row click, other row) and, on the draft row, implied a second way to lose
  work; the unsaved-edit guard already covers every exit path.
- The white card around filters and table restores a clear content boundary
  on the grey page background; the 2px `slate-300` frame around an open record
  (top and sides on the summary row, sides and bottom on the detail region)
  makes its extent legible when the next row follows immediately and lets the
  summary row read as the card's title bar. The frame is drawn with inset
  box-shadows on the summary cells and the detail region rather than borders:
  in a collapsed-border table only half of an outer row border is visible (the
  other half is clipped by the scroll wrapper), which left the summary row's
  edge a pixel or two inside the detail's edge.
- Tables must read on a phone without horizontal scrolling. Columns carry a
  priority (`primary` always, `secondary` from `md`, `tertiary` from `lg`) and
  the identifying cell surfaces the most useful hidden value as a meta line
  while its column is hidden, so no `min-w-*` is set on record tables. Cell
  content must not set a nowrap minimum width either: meta lines and long free
  text use `wrap-anywhere`, and the Operations header label is `sr-only` below
  `md`, because a single `truncate` (nowrap) email or an `OPERATIONS` heading
  was enough to push nested notes and members tables past a 390px viewport.
- The create control spells out its label (`New contact`, `New note`) at
  every breakpoint and matches the filter input height so the toolbar reads as
  one band; a bare `+` was easy to miss and did not say what it created. On
  phones it takes its own full-width line above the filters.
- A button that starts an API call shows the shared in-flight state (disabled,
  `aria-busy`, spinning ring plus `Saving…` or an action-specific label) so the
  operator sees that something is moving. This lives in `Button` itself rather
  than per-screen ternaries so no screen can forget it.
- `AdminTabStrip` uses a white active control with a uniform 1px border inside
  a `slate-100` tray (hover previews the same surface) and lays the controls
  out two per row on phones; the earlier ghost/secondary button pair had too
  little contrast to show which view was active.

**Notes:**
- The overflow control is an anchored popover menu, not a full-screen modal,
  so the operator keeps the row in view; it traps focus and closes on `Escape`
  and outside click.
- Exceptions to the field grid or editor shape are allowed only where the data
  model forces them and must be commented at the site (for example the contact
  phone number renders region + national number as two controls in one field).
- Every admin screen is now on this pattern: Contacts (contacts, families,
  organisations tabs), Tags, Calendar manual blocks, Audit (audit logs and
  API keys), Assets, Finance (expenses, vendors, tax, client invoices and
  payments), Sales (pipeline, WhatsApp / Instagram / Messenger inboxes,
  configuration, analytics filters), Services (catalogue, instances with
  nested enrollments, discount codes, venues, partners, certificates), and
  Website (QR codes, form and poll answers). Tool panels with no table (the
  Mailchimp tab, Website QR codes) follow the same shape: untitled `Card`,
  `AdminEditorPanel` / `AdminDisclosure` content, no manual refresh. The
  legacy `AdminEditorCard`, `PaginatedTableCard`, `AdminTableToolbar`, and
  `AdminCollapsibleSection` primitives (and the `ContactNotesPanel` card
  layout that was their last consumer) were deleted once the migration
  completed, so the standard is enforced by the absence of the old
  building blocks rather than by review alone.
- Variations the migrated screens establish:
  - **Read-only records** (audit log entries, issued API keys) expand into a
    detail panel laid out on the same `AdminFieldGrid` with `readOnly`
    inputs or plain values; there is no save action. A table with no
    row-scoped actions (audit logs) omits the Operations column entirely
    rather than rendering an empty one.
  - **Create-only records** (API keys, access grants) get a draft row and
    editor like any other record, but existing rows open read-only or, when
    there is nothing more to show than the summary cells (grants), stay
    plain rows with an empty expand cell so the columns line up.
  - **One-shot secrets** (the API key token shown once after creation) render
    in a status banner above the table, not inside the row, so they survive
    the draft row closing.
  - **Sub-accordions on complex editors** (Assets: Share link, Access grants)
    keep the main field grid short; the grants disclosure hosts a nested
    `AdminRecordTable embedded` with its own `New grant` draft row and Revoke
    in Operations, the same shape as contact notes.
  - Nested draft rows use their own id (`note-draft`, `grant-draft`) instead
    of `DRAFT_RECORD_ID` so test ids and panel ids never collide with the
    parent table's draft row.
  - Filters apply on change everywhere, including audit logs: selects commit
    immediately and the free-text actor filter is debounced through
    `usePaginatedList` `debounceKeys`. The earlier Apply / Clear pair and the
    record ID filter (which was only valid together with a table) were
    removed so the four remaining filters sit on one line.
  - Short single-value notes (calendar block note) use a one-line `Input`;
    `Textarea` is reserved for multi-paragraph content such as contact notes.
  - **Two record tables on one view** (client invoices and payments) each
    own a `useExpandedRecord` with a distinct parameter (`?invoice=`,
    `?payment=`) so a deep link can open one row in each.
  - **Imports attached to a table** (combined-PDF expenses, WhatsApp chat
    export) are an `AdminDisclosure` between the filter bar and the table,
    collapsed by default, with the form on `AdminFieldGrid`, the submit on
    `Button loading`, and the latest job status inside the accordion. A
    one-click import (Meta `Import recent history`) is a `Button` in the
    filter bar's trailing slot; its status banner renders above the table.
    The earlier `<details>`-based `AdminCollapsibleSection` and the toolbar
    button with a hand-rolled `Importing…` ternary are gone from these
    screens.
  - **Read-only threads** (inbox conversations) expand into the message list
    beneath the row (`?conversation=<id>`), newest first, and omit the
    Operations column because the only link (the contact) lives in the Name
    cell. Party deep links (`?contact=`, `?family=`, `?organization=`)
    auto-expand the first conversation once per party through
    `useAutoExpandPartyConversation`; collapsing does not re-open it. All
    three inboxes share `InboxConversationsTable` and
    `InboxConversationThread`.
  - **Lead editor**: the pipeline row expands into contact and lead fields on
    the 4-column grid, then disclosures for Notes, AI suggestion, Activity,
    and Conversation. Notes, AI, and Conversation mount their content only
    when opened, so expanding a lead costs one detail request; Activity shows
    the event count (or `Loading…`) in its summary. The bulk toolbar appears
    between the filters and the table once rows are checked, the checkbox
    cell stops row toggling, and a deep-linked lead outside the loaded pages
    is fetched and pinned above the list.
  - **Many-valued toggle filters** (the seven funnel-stage chips) take their
    own full-width line (`basis-full`) above the other filters instead of
    wrapping among them; the remaining filters keep to one line.
  - **Analytics** keeps its KPI and chart cards but its header became an
    untitled `Card` holding an `AdminFilterBar` (preset, from, to); the
    manual Refresh button is gone because the analytics query re-runs as the
    range changes.
  - **Lazy full records** (service catalogue): the list row carries the
    summary and the editor needs the full service, so the detail is fetched
    when the row expands and `AdminEditorSkeleton` fills the expansion until
    it arrives. Rows that are not open never fetch their detail, and the
    table never waits on one.
  - **Duplicate as draft** (services, instances): the Duplicate row action
    opens the draft row seeded from the source through
    `useDuplicateDraftTemplate`, so the copy is edited and saved with the
    normal create editor. The template is staged before the draft opens so
    the dirty-row prompt can still cancel it, and it is dropped as soon as
    any other row is expanded so a later `New …` starts blank.
  - **Instances** keep the server-side scope filters (service, type, related
    party) and narrow lifecycle status and free text on the client
    (`filterInstancesForTable`, default `Not completed`) so those apply
    instantly to loaded pages; an expanded instance the client filter would
    hide is pinned above the rows. The Service field is `readOnly` once an
    instance exists. **Enrollments** are a lazy disclosure on the instance
    editor (count from `capacityEnrolledCount` in the summary) hosting a
    nested `AdminRecordTable embedded` with its own draft row and in-row
    editor (`InstanceEnrollmentsSection`); party deep links open that
    disclosure and select the party's enrollment once. Section state lives in
    `useServiceCatalogSection` / `useInstancesSection` (`?service=`,
    `?instance=`) composed by `useServicesPage`.
  - **Certificates** issue through a draft row (`Issue certificate`) whose
    form cascades service → instance → completed enrollment with a debounced
    PDF preview; issued rows expand read-only, and Download, Void, and Delete
    sit in Operations.
  - **Discount codes** collapse Link/QR and Delete into the overflow menu
    behind Copy; **venues** and **partners** expand into editors with
    Location (and Tags) as disclosures.
  - **Read-only answer tables** (Website form and poll answers) use the form
    or poll picker as the only filter, put `Export answers` and `Clear
    answers` in the filter bar's trailing slot, and expand each row into the
    full answer on the field grid with no Operations column. The QR tool is
    an untitled `Card` with `AdminEditorPanel` fields on a 4-column grid.
- Below `md`, `AdminDataTableHeadCell` / `AdminDataTableCell` set
  `overflow-wrap: anywhere`. The auto table layout cannot shrink a column
  below its longest unbreakable token, so a single `snake_case` table name,
  UUID, or unspaced key name would otherwise widen the table past its card
  and force sideways scrolling on a phone even when column priorities are
  correct. Counting those break opportunities in the min-content width keeps
  every record table at its container width; desktop layout is unchanged.
- Read-only editor values (for example the contact's Mailchimp sync status)
  render as a `readOnly` `Input` so the field grid keeps one control shape.
- Nested record lists inside an open editor (contact notes, family and
  organisation members) reuse the same table-first pattern through
  `AdminRecordTable embedded` (no inner card): a `New note` / `New member`
  control opens a draft row with the composer or picker, clicking a row opens
  its editor beneath it, and Delete / Remove stay in Operations. There is no
  always-on composer and no edit icon. The `AdminExpandRegion` grid pins its
  column track (`minmax(0, 1fr)`) so a nested table only animates in height
  and never changes width while it opens.
- Contact editor field exceptions: the phone number renders as a 40/60
  prefix / national number split inside one field; the Source row is
  Source (1/4), Source detail (1/4), Job title (1/2, `contacts.job_title`),
  with referral fields on their own row at 2 columns each when the source is
  `referral`.

## Admin web server state on TanStack Query

**Decision:** `@tanstack/react-query` v5 owns all admin web server state. A
single `QueryClient` (`getAdminQueryClient()` in
`src/lib/admin-query-client.ts`, provided by `AdminQueryProvider` in the root
layout) is configured with `staleTime` 30 s, `gcTime` 10 min, no automatic
retries, and no refetch on window focus. All keys come from the
`adminQueryKeys` factory in `src/lib/admin-query-keys.ts`. `usePaginatedList`
wraps `useInfiniteQuery`; the `useShared*` catalog hooks wrap `useQuery`; the
former module-level `admin-catalog-store` is removed.

**Why:**
- Each page previously refetched its list and reference data on every mount,
  and the Lambda round trip (VPC + RDS Proxy, ~300-900 ms warm, several seconds
  cold) made section switches feel slow. Cached queries render the last known
  page immediately and revalidate in the background.
- The hand-rolled list hook and catalog store re-implemented request
  de-duplication, abort, and invalidation with subtle differences. One library
  gives the same semantics everywhere and a standard devtools surface.
- List fetchers are exported module-level functions so the sidebar can
  `prefetchInfiniteQuery` a section on hover/focus
  (`usePrefetchAdminSection`), warming the cache before navigation.
- Decrypted Cognito tokens are cached in memory with a single-flight refresh
  (`src/lib/auth.ts`), so concurrent queries on a page share one refresh
  instead of racing.

**Notes:**
- No retries: the admin API surfaces validation and auth errors as final; a
  retry would only delay the message.
- Mutations invalidate by key prefix (`adminQueryKeys.<resource>.lists()`)
  rather than refetching a specific page.
- Tests reset the client per test via `resetAdminQueryClientForTests()` in
  `tests/setup.ts`.

## Admin Lambda `Server-Timing`

**Decision:** The admin Lambda emits a `Server-Timing` header on every
response with `app;dur=<handler ms>` and, on the first invocation of a
container, `cold;dur=<ms since module import>`. CORS exposes the header
(`Access-Control-Expose-Headers`), and the admin web API client logs
browser-measured duration next to the server value in non-production builds.

**Why:** Slow-page reports could not distinguish network/CDN, cold start,
handler time, and client rendering. The header separates the server share so
performance work can be aimed at the right layer without adding tracing
infrastructure.

## CI/CD Variables and Secrets

**GitHub Variables**
- `AWS_ACCOUNT_ID`
- `AWS_REGION`
- `CDK_STACKS` (optional; `all stacks`, `backend`, `admin web`, or `public website`)
- `CDK_BOOTSTRAP_QUALIFIER` (optional)
- `CDK_PARAM_FILE` (optional path to CDK parameter JSON)
- `NEXT_PUBLIC_API_BASE_URL` (Admin and Public WWW API base URL)
- `NEXT_PUBLIC_WWW_PROXY_ALLOWED_HOSTS` (Public WWW hostname allowlist for same-origin `/www` proxy rewrites)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Public WWW Turnstile site key)
- `NEXT_PUBLIC_FPS_MERCHANT_NAME` (Public WWW FPS merchant label)
- `NEXT_PUBLIC_FPS_MOBILE_NUMBER` (Public WWW FPS recipient number)
- `NEXT_PUBLIC_GTM_ID` (Google Tag Manager container ID, e.g. `GTM-XXXXXXX`)
- `NEXT_PUBLIC_GTM_ALLOWED_HOSTS` (optional comma-separated hostname
  allowlist for GTM runtime gating; defaults to `NEXT_PUBLIC_SITE_ORIGIN` host)
- `NEXT_PUBLIC_EMAIL` (maintenance page email)
- `NEXT_PUBLIC_WHATSAPP_URL` (maintenance page WhatsApp link)
- `NEXT_PUBLIC_INSTAGRAM_URL` (maintenance page Instagram link)
- `AMPLIFY_APP_ID`
- `AMPLIFY_BRANCH`
- `ANDROID_RELEASE_TRACK`
- `IOS_BUNDLE_ID`
- `APPLE_TEAM_ID`
- `IOS_PROVISIONING_PROFILE` (optional)
- `FIREBASE_API_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_ANDROID_APP_ID`
- `FIREBASE_IOS_APP_ID`
- `FIREBASE_IOS_BUNDLE_ID`
- `FIREBASE_STORAGE_BUCKET` (optional)
- `FIREBASE_APP_CHECK_DEBUG` (optional; "true" for debug providers)

**GitHub Secrets**
- `AMPLIFY_API_KEY` (mobile API key injected at build time)
- `CDK_PARAM_GOOGLE_CLIENT_SECRET`
- `CDK_PARAM_PUBLIC_API_KEY_VALUE`
- `CDK_PARAM_ADMIN_BOOTSTRAP_TEMP_PASSWORD` (optional)
- `NEXT_PUBLIC_WWW_CRM_API_KEY` (Public WWW browser API key)
- `APPSTORE_API_KEY_JSON` (recommended single JSON secret with issuer_id,
  key_id, private_key)
- `GOOGLE_PLAY_SERVICE_ACCOUNT`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `APPSTORE_API_KEY_JSON`
- `APPSTORE_ISSUER_ID`
- `APPSTORE_API_KEY_ID`
- `APPSTORE_API_PRIVATE_KEY`
- `MATCH_GIT_URL`
- `MATCH_PASSWORD`
- `FASTLANE_USER`
- `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`

**CDK Parameters (via `CDK_PARAM_FILE`)**
- `PublicApiKeyValue` (API key required for public asset routes)
- `DeviceAttestationJwksUrl`, `DeviceAttestationIssuer`, `DeviceAttestationAudience`
- `AssetDownloadCloudFrontPublicKeyPem`
- `AssetDownloadCloudFrontPrivateKeySecretArn`

## Public website: remove legacy CRM API bridge

**Decision:** Retire `/v1/legacy/*` proxy routes and the `LEGACY_PUBLIC_API_*`
configuration. `public_www` calls native Aurora-backed handlers:
`POST /v1/contact-us`, `POST /v1/reservations`, and existing
`POST /v1/discounts/validate`.

**Why:**
- Single source of truth in Aurora for contacts and sales leads.
- Fewer moving parts (no outbound legacy HTTP from the admin Lambda).
- Aligns transactional email and Mailchimp hooks with persisted data.

**Non-production safety:** `DEPLOYMENT_STAGE` gates outbound SES, Mailchimp, and
SNS media publishes in non-production environments (see `deployment.py` and CDK
`DEPLOYMENT_STAGE` on the admin and media-processor Lambdas). The API stack
defaults this to `production`; override with **`CDK_DEPLOYMENT_STAGE=staging`**
at synth time for explicit non-prod stacks.

## Replace service-key env map with `services.service_key`

**Decision:** Store optional lowercase referral keys on `services.service_key` with a
case-insensitive unique index (with `service_tier`), and resolve public `service_key`
values against Aurora instead of a Lambda JSON env map.

**Why:** The database already owns service identity; the key is a first-class admin
field and avoids deploy-time JSON drift. Public discount validate/redeem paths
query `ServiceRepository.get_by_service_key` in-session.

## Vendors API merged into organizations

**Decision:** Retire dedicated `/v1/admin/vendors` routes. Vendor rows remain
`organizations` rows with `relationship_type=vendor`. The admin console and API
clients list and edit them via `GET|POST|PATCH /v1/admin/organizations` with
`relationship_type=vendor` on list queries where needed.

**Why:** One resource model avoids duplicate CRUD paths, matches the database,
and simplifies OpenAPI and CDK wiring. Shared contact/family/organization helpers
live in `admin_entities_helpers.py` and `admin_entities_serializers.py` for
cross-entity reuse; organization-specific modules use neutral `admin_organizations*.py`
names.

**Payload shape:** The organizations create/update schemas are a superset of the
legacy vendor-only API. The Finance vendors UI is expected to send only
`organization_type: other`, `relationship_type: vendor`, `name`, `website`, and
`active` for vendor rows; the backend does not enforce a narrower vendor-only
subset for authenticated callers.

**CRM default list:** Unfiltered `GET /v1/admin/organizations` (and the picker
when `relationship_type` is omitted) excludes vendor and partner rows so
Contacts → Organisations matches picker and member-assignment rules; Services
passes `relationship_type=partner` for the Partners table; Finance passes
`relationship_type=vendor` for the vendors table.

## Phone numbers on CRM contacts (region + national)

**Decision:** Store phone numbers on `contacts` as ISO 3166-1 alpha-2
`phone_region` plus digit-only `phone_national_number` (E.164 national
significant number). Do not persist E.164; derive it at read time with
`phonenumbers` so stored fields cannot drift from a cached E.164 column.

**Default region:** Public and importer parsing use `DEFAULT_PHONE_REGION` from
Lambda environment (CDK parameter `DefaultPhoneRegion`, default `HK` in stack
parameters) when the client omits an explicit region.

**Why:** Matches libphonenumber guidance (store structured parts, format for
display/API), keeps validation and search aligned with one source of truth,
and avoids denormalised E.164 maintenance.

**Migration caveat:** Alembic backfill uses ``is_possible_number`` so legacy
strings are not dropped unnecessarily. Read-time E.164 / international formatting
accepts the same possible-or-valid gate so admin and exports stay consistent with
stored rows.

**Rollback:** After upgrade, rows that could not be parsed have NULL phone fields
and the legacy ``phone`` string is gone; downgrade cannot reconstruct them.

**Search indexing:** Btree / composite indexes accelerate exact region + national
match and anchored-prefix ``ILIKE``; substring ``ILIKE '%…%'`` remains a sequential
scan at CRM scale (by design).

## Partner organisations on event instances

**Decision:** Store ordered partner organisation links for event-type
`service_instances` in a dedicated junction table `service_instance_organizations`
(`service_instance_id`, `organization_id`, `sort_order`). Admin create/update sends
`partner_organization_ids` (UUID array); the API rejects unknown organisation ids with
HTTP 400. The admin organisation picker may filter with `relationship_type=partner`
while still listing only active (non-archived) organisations; already-linked partners
remain visible in the UI when archived because the instance response includes
`partner_organizations` with an `archived` flag.

**Why:** Event instances need explicit partner attribution without overloading
Eventbrite fields; a normalised M2M table supports ordering and future relationship
metadata without schema churn today.

## Drop Calendly integration from services schema

**Decision:** Remove `consultation_details.calendly_url` and
`consultation_instance_details.calendly_event_url` (migration `0034_drop_calendly_fields`)
and strip the corresponding fields from the admin OpenAPI contract (version bump to
0.3.0). Product no longer persists Calendly URLs in Aurora.

**Why:** Calendly-specific columns coupled the data model to one vendor; dropping them
simplifies consultation services/instances and avoids maintaining unused PII-adjacent
URLs. **Data loss:** upgrade drops stored values; downgrade re-adds nullable columns only.

**Same contract bump (0.3.0):** Admin instance ``event_ticket_tiers`` request entries may
omit ``price`` / ``currency`` / ``name`` when the server fills from ``event_details``
defaults; ``PUT`` updates that touch other fields on an event instance must still
include ``event_ticket_tiers`` (or nested tier fields) so tier rows are not skipped
silently. Multi-tier instances accept a single-tier payload only when one tier's
``name`` matches the service event category (otherwise the client must send the full
array, one object per tier).

## Public calendar and booking use instance slugs, not instance UUIDs

**Decision:** The public calendar feed (`GET /v1/calendar/public`) exposes each offering’s
stable **`slug`** from `service_instances.slug` (required on emitted rows; UUIDs are not
returned). Session slots use dense 1-based **`part`** ordinals after `(sort_order, starts_at)`
ordering. Public discount validation accepts optional **`service_instance_slug`** (not
`service_instance_id` or `service_id`); when supplied it pairs with `service_key` for identity.
Public reservations accept optional **`serviceInstanceSlug`** for the same pattern on **event**
and **MBA** bookings; **consultation** and **intro-call** bookings omit it and use **`serviceKey`**
against catalog `services` rows instead.

**Why:** Public clients should not handle Aurora primary keys; slugs are human-meaningful
and align static content fixtures with the API contract.

**Scope checks:** `POST /v1/discounts/validate` and `POST /v1/reservations` accept
`service_key` always; `service_instance_slug` / `serviceInstanceSlug` pair-resolution remains
required for **event** and **MBA** bookings. Consultation-tier and intro-call reservations resolve
catalog rows by `service_key` only (`family-consultation-essentials`, `family-consultation-deep-dive`,
`intro-call`) and omit instance slug on the wire (ignored when present). Discount validate mirrors
the split: slug omitted validates against `services.id` only; instance-scoped promo codes still require
a slug. Unknown instance slug or a key that does not match the instance's parent service returns **404**
with structured rejection reasons on slug-mode requests; unknown `service_key` in slug-less validate
requests returns **404** `unknown_service_key`.

## Display-only capacity left override on service instances

**Decision:** `service_instances.capacity_left_override` (nullable integer ≥ 0) soft-caps how
many spots remain are shown in admin and in public `spaces_left` when `max_capacity` is set.
Authoritative booking capacity and `InstanceStatus.FULL` reconciliation stay on
`max_capacity` vs capacity-counted enrollments only. Public `spaces_total` continues to mirror
`max_capacity`. It is valid for `spaces_left` to be `0` while `is_fully_booked` is false when
the instance is not `full` but an operator sets override `0` to signal “sold out” messaging
without blocking further enrollments; reviewers must not “fix” that divergence.

**Why:** Operators sometimes need marketing or staged-release messaging separate from internal
seat accounting without changing stored capacity or enrollment rules.

## Public calendar blockers and consultation half-day contract

**Decision:** `GET /v1/calendar/blockers` (and `/www/v1/calendar/blockers`) merge
`calendar_manual_blocks` with published **event** and **training_course** session slots
that intersect nominal local windows (09:00–12:00 → `am`, 14:00–18:00 → `pm`) in
`CALENDAR_BLOCKERS_WALL_TIMEZONE` (default `Asia/Hong_Kong`). Session-derived eligibility
reuses the same SQL predicates as `ServiceInstanceRepository.list_public_offerings`
(via `public_calendar_blocker_instance_predicates`), excluding feed-only filters
(active session cutoff, finished-event lookback, slug/service_key/limit).

**Public `purpose`:** Only `consultation_booking` is allowed in this release; other
values return **400**.

**Wall-clock alignment:** The public website picker uses `PUBLIC_SITE_IANA_TIMEZONE`
(`site-datetime.ts`). The API merge uses `CALENDAR_BLOCKERS_WALL_TIMEZONE` (default
`Asia/Hong_Kong`). **Operations must keep these identical** (same zone string); if the env
is set to a different zone than the site build constant, AM/PM boundaries and blocker
rows can disagree between UI and API.

**Caching:** Responses for `purpose=consultation_booking` use `Cache-Control: no-store`
so CloudFront does not retain stale blocker lists after admin edits.

**Reservations (`bookingSystem=consultation-booking`):** Each `primarySessionStartIso`
and every `sessionSlots[].startIso` must classify to **morning** (local hour before 12)
or **afternoon** (local hour 14 or later) in the wall zone; local hours **12–13**
return **400** (`primarySessionStartIso` or the corresponding `sessionSlots[n].startIso`
field). Sub-minute times are allowed within those bands. Blocked half-days reject with
the same user-facing message; structured logs distinguish classification vs blocked.

**Client / CDN:** The public website requests blockers with `from` / `to` derived in
**the site IANA zone** (same calendar as the consultation modal), aligned to the Monday
of the current week and `to` = `from + 119` days so the URL (and CloudFront cache key when
applicable) stays stable for seven days. The CRM GET client uses
`bypassGetCache` on this request so in-memory GET caching does not hide fresh blockers
when reopening the booking modal. When `NEXT_PUBLIC_WWW_CRM_API_KEY` is unset at
runtime, the client cannot call the API and treats the outcome as a fetch failure
(empty slots + user-visible warning; server validation remains authoritative).

**TOCTOU:** Between validation and commit another writer may add a conflicting session;
enrollment is not serialised against the calendar blocker rows. Mitigations are short
TTL on any cacheable reads and `no-store` for the consultation purpose.

**CloudFront path allowlist:** The viewer function matches the path segment **exactly**
(e.g. `/www/v1/calendar/blockers`); trailing slash variants are not allowlisted.

## Per-booking service instances for consultations and intro calls

**Status:** Superseded by **Tier-per-service catalog (drop template instance row)** below.
Retained for history.

**Decision:** Public `consultation-booking` and `intro-call-booking` submissions resolve the
**template tier** `service_instances` row by slug (`serviceInstanceSlug`), row-lock it,
allocate a new **booking instance** child (`parent_instance_id`, `is_template = false`)
with a generated unique slug, attach session slots on that child with denormalized
`template_instance_id`, and insert exactly one `enrollments` row on the booking instance.
Concurrent bookings against the same tier + same start instant collide on the partial unique
index `(template_instance_id, starts_at)` where `template_instance_id` is not null.

**Why:** Event and training reservations remain modeled as enrollments on long-lived
scheduled instances; consultation packages and the free intro tier instead behave like
catalog templates with many logical bookings, each needing its own instance container,
schedule rows, and enrollment without sharing one overcrowded tier row.

**Exclusions:** `event-booking` and `my-best-auntie-booking` keep attaching enrollments to
the resolved scheduled instance (no child row allocation).

**Stripe idempotency:** When a per-booking submission is retried with the same
``stripe_payment_intent_id`` after a prior successful allocation, the handler short-circuits
persistence and does not create an additional ``PROGRAM_ENROLLMENT`` sales lead; the first
successful request still records the lead.

## Tier-per-service catalog (drop template instance row)

**Decision:** Each consultation package tier is its own `services` catalog row
(`family-consultation-essentials`, `family-consultation-deep-dive`); intro-call keeps a single
`services` row (`intro-call`). `service_instances` no longer mixes catalog templates with booking
containers: public reservations row-lock the catalog `services` row, allocate one booking
`service_instances` row per submission (generated slug, `eventbrite_sync_status = skipped`),
and attach `instance_session_slots.purpose_service_id` → that catalog service for concurrency
control on `(purpose_service_id, starts_at)`. `consultation_instance_details`, `is_template`,
`parent_instance_id`, and `template_instance_id` are removed in migrations `0062_eventbrite_skipped`
+ `0063_tier_per_service` (**hard cutover**, lossy downgrade after production writes).

**Why:** Eliminates dual-purpose instance rows (tier vs occurrence), simplifies admin Services UX
(two visible consultation tiers instead of template + booking forest), and aligns public identity with
`serviceKey` for consultations/intro-call while keeping slug-based resolution for events/MBA.

## Public calendar availability is slot-based for all purposes

**Decision:** Replace legacy half-day blocker listing and separate intro-call slot routes with a single
`GET /v1/calendar/availability` contract (`purpose` required). Ship as a **hard cutover** (no overlap window,
no legacy field aliases). Consultation availability enumerates **discrete** Mon–Fri half-day slots
(AM `09:00–12:00`, PM `14:00–18:00` local `Asia/Hong_Kong` / `CALENDAR_BLOCKERS_WALL_TIMEZONE`) with a
**two calendar day** minimum lead; intro-call keeps **two hour** lead and the existing 15-minute slot / 30-minute
cadence. **Strict reservation validation** rejects consultation submissions whose starts are not exactly 09:00 or 14:00
local on weekdays before manual-block checks.

**Manual calendar blocks:** Rows scoped to `consultation_booking` block consultation half-day
slots **and** intro-call slots whose UTC interval overlaps the consultation half-day window
(intro-call availability merges both purposes' manual blocks). Rows scoped to `intro_call_booking`
block intro-call slots only and do **not** affect consultation half-day availability. This
asymmetry is intentional: a consultation manual block (admin-driven home-visit unavailability)
covers any in-office bookings during the same wall-clock window, whereas an intro-call manual
block targets the operator's intro-call calendar without disabling consultations.

**Why:**
- One envelope (`slots` + `meta`) reduces drift between consultation UX and intro-call UX.
- Discrete consultation slots align picker behavior with reservation validation.
- Cache policy remains purpose-specific (`no-store` for consultations; shared-cache friendly for intro-call GET success).

## Intro-call public slot cadence

**Decision:** Free intro-call candidate starts advance on a **30-minute** wall-clock grid
(Mon–Fri 09:00–17:30 `Asia/Hong_Kong` by default); each offered interval remains **15 minutes**
long (`end = start + 15m`) so copy stays aligned with call length while halving the number of
start times versus a 15-minute grid. Reservations resolve the intro-call catalog **service** by
`service_key` (`intro-call`); booking rows use generated instance slugs.

**Maintenance note (section backgrounds):** Some public sections pair a white surface with
the light watermark treatment by registering the same class name in two CSS selector lists
(watermark variables vs solid background). Prefer a single utility class when refactoring.

## Invoice settlement projection (not a lifecycle status)

**Decision:** “Paid” for customer AR is modeled as a **derived settlement state** from
`payment_allocations`, cached on `customer_invoices` as `amount_allocated`, `balance_due`, and
`paid_at`. The `billing_invoice_status` enum on invoices remains **draft | issued | void** only;
we do **not** add a `paid` lifecycle label. `isPaid` in admin API responses means issued, positive
total, and zero `balance_due`. Historical `paid_at` backfill uses `updated_at` as a best-effort
timestamp where full coverage can be inferred from allocations.

**Why:** Keeps authoring lifecycle separate from payment coverage, avoids conflating void/issued
with settlement, and makes open-balance queries index-friendly without scanning allocations each time.

**Exclusions:** Multi-currency per invoice, credit notes, and allocation-delete APIs are out of scope;
any future allocation delete endpoint must call `recompute_invoice_settlement` in the same transaction.

When `paid_at` transitions (``None`` ↔ timestamp) on an issued invoice that already has a canonical PDF in S3, the issued PDF is re-rendered with a diagonal **PAID** watermark on every page; `issued_pdf_sha256` and `pdf_template_version` are updated in the same database transaction as settlement recompute. Consumers of `issued_pdf_sha256` as an integrity digest should expect the hash to change when settlement flips the paid watermark on or off (the bytes legitimately changed).

## WhatsApp Cloud API webhooks on Admin Lambda

**Decision:** Ingest Meta WhatsApp Cloud API webhooks on the existing
`EvolvesproutsAdminFunction` at public `GET`/`POST /v1/whatsapp/webhook`,
the same pattern as Mailchimp. Do **not** add a dedicated WhatsApp Lambda.
Verify `GET` with `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `POST` with HMAC
`X-Hub-Signature-256` using `META_APP_SECRET`. Persist inbound `messages`
and coexistence `smb_message_echoes` (phone-app replies) into
`whatsapp_conversations` / `whatsapp_messages`, and create a Contact plus
open SalesLead on first inbound or first outbound when none exists. Live
webhooks move that open lead to `contacted` on the first outbound message
and to `engaged` after three inbound messages on the same thread. History
and export backfills still skip new leads and do not change funnel stage.
Admin reads live at `GET /v1/admin/whatsapp/conversations` (Sales → WhatsApp
tab).

**Why:**
- Same in-VPC Aurora access and operational surface as other CRM writes.
- Coexistence means outbound replies are echoes, not Cloud API sends.
- HMAC + verify token keep the public route fail-closed without API keys.

## Hashed API tokens for public WhatsApp reads

**Decision:** Issue hashed API tokens (`esk_…`) stored in `api_keys` and
validated by a VPC request authorizer on `x-api-token`. Scopes are `admin`
(full access on token-protected routes) and `user` (GET only). WhatsApp
conversation reads live at `GET /v1/public/whatsapp/conversations` and
`GET /v1/public/whatsapp/conversations/{id}/messages` and omit phone numbers
and `wa_id`. CRM contacts live at `GET|POST /v1/public/contacts` and
`GET|PATCH|DELETE /v1/public/contacts/{id}` with the admin contact payload
(including PII). Notes, services, and Mailchimp jobs stay on Cognito admin
routes. Admins create and revoke tokens from Audit → API keys.

**Why:**
- Matches the Siutindei hashed-key pattern without colliding with the
  website `x-api-key`.
- Authorizer cache (5 minutes) plus handler-level GET-only enforcement for
  `user` tokens keeps revocation bounded and writes fail-closed.
- Public conversation payloads stay useful for integrations without exposing
  WhatsApp numbers.

## Messenger and Instagram webhooks on Admin Lambda

**Decision:** Ingest Meta Messenger and Instagram Direct webhooks on the
existing `EvolvesproutsAdminFunction` at public `GET`/`POST /v1/meta/webhook`.
Reuse `META_APP_SECRET` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN` from the same
Meta app. Dispatch on `object`: `page` is Messenger (`facebook`),
`instagram` is Instagram Direct. Skip `whatsapp_business_account` (that
traffic stays on `/v1/whatsapp/webhook`). Skip Instagram threads whose
counterparty username or chat name matches the last path segment of the
configured public Instagram profile URL (`PUBLIC_WWW_INSTAGRAM_URL` /
`NEXT_PUBLIC_INSTAGRAM_URL`, for example `evolvesprouts` from
`https://www.instagram.com/evolvesprouts`) so the business account is
not imported as a contact. Persist threads in unified
`meta_conversations` / `meta_messages` keyed by `(channel, platform_user_id)`.
Create a Contact plus open SalesLead on first inbound or first outbound
when none exists. Live webhooks move that open lead to `contacted` on the
first outbound message and to `engaged` after three inbound messages on the
same thread. Graph history import still skips new leads and does not change
funnel stage.
On Instagram inbound, persist `sender.username` on `contacts.instagram_handle`
(lowercase, no leading `@`) when it is a username rather than IGSID, and reuse
an existing contact with that handle, including archived rows. Messenger has
no handle field. Missing webhook usernames stay unmatched (no Graph lookup).
Do not store IGSID/PSID on `contacts.instagram_handle`. Admin reads live at
`GET /v1/admin/meta/conversations` (Sales → Instagram / Messenger tabs).
Token reads live at `GET /v1/public/meta/conversations` and omit Page-scoped
user ids and page ids.

**Why:**
- Same HMAC family and Admin Lambda surface as WhatsApp.
- One table pair keeps listing, search, and redaction shared.
- Public payloads stay useful without exposing Meta scoped ids.
- LinkedIn Pages messaging is partner-only and remains out of scope.

## Inbox history import (Graph + WhatsApp export)

**Decision:** Add an admin-triggered async inbox import worker
(`InboxImportFunction` on `evolvesprouts-inbox-import-queue`) instead of
pulling history inline on the admin Lambda. Jobs live in `inbox_import_jobs`.

- **Instagram / Messenger:** `POST /v1/admin/meta/import-jobs` lists Page
  conversations through the Graph Conversations API via `AwsApiProxyFunction`.
  List threads with slim participant fields
  (`participants.limit(5){id,name,username}`) separately from paged
  `GET /{conversation-id}/messages` (`from{id,name,username}`, 5 per page,
  last 20 bodies). Retry a path with a smaller `limit` when Graph returns
  `Please reduce the amount of data you're asking for`; skip a thread that
  still fails at `limit=1`. Skip a thread (and stop paging after the
  first list page) when the outbound Graph proxy times out (`502
  TimeoutError`) so one slow Instagram call does not fail the job.
  Commit after each thread so earlier imports survive a later timeout.
  Nested `messages.limit(20)` on a wide conversation page exceeds Graph
  payload limits.
  Skip Instagram threads whose participant username matches the last path
  segment of `PUBLIC_WWW_INSTAGRAM_URL` / `NEXT_PUBLIC_INSTAGRAM_URL`.
  Meta only returns message **bodies** for the last 20 messages per thread.
  Persist through the same `store_meta_message` path as webhooks (unique
  `platform_message_id`). Pass participant `username` as `instagram_handle`
  so history import reuses CRM contacts the same way live ingest does.
  Create placeholder contacts when missing. Do **not** create new Sales leads.
- **WhatsApp Cloud API:** there is no GET history endpoint. Continue live
  webhook ingest, and persist coexistence `history` webhook chunks when Meta
  sends them (still no new leads). Older chats come from a Business App
  `.txt` / `.zip` export via `POST /v1/admin/whatsapp/import-jobs`.
- Graph import uses a dedicated Page / system-user access token
  (`MetaPageAccessToken` / GitHub secret `CDK_PARAM_META_PAGE_ACCESS_TOKEN`)
  as `META_PAGE_ACCESS_TOKEN` on `InboxImportFunction`. The WhatsApp
  webhook verify string is only for `hub.verify_token` and is not a Graph
  Bearer token. `/{page-id}/conversations` requires a Page token; the
  worker exchanges a system-user token with
  `GET /{page-id}?fields=access_token` when Graph does not already return
  one. Page / IG ids and Graph origin come from CDK parameters (GitHub
  vars), not hardcoded values. The token is a `noEcho` CfnParameter
  passed as Lambda env (same pattern as `WhatsappWebhookVerifyToken`); do
  not create a separate Secrets Manager secret for it (that caused a
  CloudFormation cycle on the shared secrets KMS key).

**Why:**
- Graph and zip parsing exceed API Gateway timeouts.
- Reusing persist + unique message ids keeps webhook and import idempotent.
- Historical inbound must not flood the Sales pipeline with `NEW` leads.

## Helper Detector for automated sales leads

**Decision:** Persist a `helper_detector_enabled` flag on the singleton
`sales_settings` row (default off). When enabled, automated new-lead paths
(WhatsApp/Meta ingest, public contact/reservations, media free-guide) call
OpenRouter through the same chat-completion pipeline as the invoice expense
parser. Clear Filipino or Bahasa (Indonesian/Malay) name/username signals set
funnel stage to `unqualified` (an open stage). Contact type becomes `helper`
only when it is currently `other`. Manual admin lead create does not run the
detector.

**Why:**
- Sales ops need a Config toggle without redeploying.
- Reusing the OpenRouter expense-parser path keeps secrets, proxy, retries, and
  model env vars consistent.
- Fail-open keeps webhook and form latency bounded when the model is slow or
  unavailable.

## Sales plan of the day (dashboard)

**Decision:** Persist org-wide sales daily plans in `sales_daily_plans` and
generate them on demand through the same async OpenRouter + SQS worker pattern
as per-lead AI suggestions. The admin dashboard card loads the newest saved
plan, shows a 24-hour (plus pipeline/inbox watermark) stale flag, and only
regenerates when the operator clicks Generate / Refresh insight. Optional
`operator_input` on refresh is stored on the new plan. The last five plans
(and their refinements) are sent back as memory on the next generation. All
rows are kept until Sales → Configuration resets memory
(`DELETE /v1/admin/leads/daily-plan`).

**Why:**
- Operators need a saved plan they can reopen without paying for another model
  call, and they need prior insights plus refinements to steer the next run.
- Org-wide context (pipeline, unanswered threads, catalogue) exceeds API
  Gateway time limits, so generation stays off the request path.
- Reusing the lead-AI OpenRouter / proxy / job-timing pattern keeps secrets and
  failure handling consistent.
- Reset is an explicit admin action so memory is durable until the operator
  clears it.

## API route module conventions

**Decision:** Every route module under `backend/src/app/api/**` follows the same
dispatch shape and stays under 500 lines:

- Sub-routers call `split_route_parts(path)` and reject unknown prefixes with
  `route_has_prefix(parts, "admin", "<resource>")` from `app.api.admin_request`
  (re-exported by `app.api.shared_request` for public/user routes).
- Unmatched paths return `not_found(event)` and unsupported methods return
  `method_not_allowed(event)` from `app.utils.responses`; handlers do not build
  these `json_response` bodies inline.
- Payload validation helpers are defined once in `app.api.validators` and
  `app.utils.validators`; `app.api.admin_validators` re-exports them and adds
  only admin-specific parsers (service instance slugs, partner keys, Instagram
  handles).
- When a route module grows past 500 lines, split by responsibility into a
  sibling module named `<module>_<concern>.py` (for example
  `admin_expenses_bulk_import.py`, `admin_billing_payments_serializers.py`,
  `admin_services_type_details.py`, `public_polls_validation.py`). Moved names
  become public (no leading underscore) so cross-module imports and test
  monkeypatches target the module that owns them.

**Why:** Sub-routers were repeating the same three-clause prefix check and
literal 404/405 payloads, and validators had drifted into two copies. One
helper per concern keeps route handling greppable and stops the duplicates from
diverging again.

## Admin API contract conventions

**Decision:** The admin API (`docs/api/admin.yaml`) follows one set of contract
rules, and handlers accept exactly what the spec documents:

- **List pagination.** Browsable admin lists (contacts, families,
  organizations, leads, expenses, assets, locations, audit logs, invoices,
  payments, certificates, conversations, and similar) are cursor-paginated and
  return `{ "items": [...], "next_cursor": string | null }`. Page size comes
  from `parse_limit(event)` with the shared defaults in
  `app.api.admin_request` (`DEFAULT_LIST_LIMIT = 25`, `MAX_LIST_LIMIT = 100`);
  route modules do not define their own default or maximum. Small reference
  sets (users, instructors, geographic areas, tags, discount codes, form and
  poll slugs) and picker endpoints (`/families/picker`,
  `/organizations/picker`, `/billing/enrollments/recent-for-invoicing`) return
  a bounded set instead and may carry their own cap. The admin web mirrors the
  paginated shape with `ADMIN_LIST_PAGE_SIZE` / `ADMIN_API_MAX_LIST_LIMIT` in
  `apps/admin_web/src/lib/admin-list-query.ts` and `usePaginatedList`.
- **Key casing.** Query parameters are `snake_case` (`invoice_id`,
  `export_version`, `record_id`). Request and response body keys use the casing
  documented for that schema; handlers read only the documented key and do not
  accept an undocumented `camelCase`/`snake_case` alias.
- **Endpoint surface.** An admin endpoint exists only when the admin console
  (or another documented consumer) calls it. Detail `GET /{id}` routes whose
  data is already present in the list response are not kept "for completeness";
  remove the handler, OpenAPI entry, and tests together.
- **Method semantics.** A known path with an unsupported method returns
  `405 Method Not Allowed`; only unknown paths return `404`.
- **Audit writes.** Mutating billing handlers open the session with
  `session_with_audit(user_sub, request_id)` from `app.db.audit` (trigger rows)
  and add `AuditService.log_custom` only for business events that triggers
  cannot express (see `audit-logging.md`).

**Why:** The contract had accumulated per-module page sizes, dual-cased
parameters, and detail endpoints with no caller. Standardising on one set of
rules keeps the generated admin web types small, makes the console's list hooks
interchangeable, and stops each new route from re-deciding these details.

## Data access and serializer ownership

**Decision:** Query construction lives in `backend/src/app/db/repositories/**`
and response shaping lives in one serializer module per domain; API route
modules orchestrate the two.

- **Repositories own `select()`.** Each aggregate has a `BaseRepository`
  subclass (`TagRepository`, `CustomerInvoiceRepository`,
  `CustomerPaymentRepository`, `EnrollmentRepository`, ...). List methods take
  `limit` plus cursor parts and return newest-first rows; callers over-fetch by
  one to detect another page. Cross-entity lookups that support one handler
  (for example allocation / receipt / refund linkage behind payment delete
  eligibility, or the six-table tag usage union) are repository methods, not
  inline statements in the handler. Filter clauses that need a session to
  build (party filters) are passed in as a `ColumnElement`.
- **Shared eager loads are named.** When several handlers need the same
  relationship graph, the repository module exposes it once (for example
  `billing_party_load_options()`), so the load set cannot drift between the
  invoicing picker and payment labels.
- **Contact naming.** `contact_full_name()` (in `app.db.models.contact`) is
  the single implementation of "first + last, or `None`"; `contact_label()`
  (in `app.api.admin_entities_serializers`) adds the email fallback used by
  picker rows, membership rows, and certificate labels. Serializers do not
  join name parts inline.
- **Conversation routes share one helper module.** `app.api.inbox_common`
  holds the WhatsApp/Meta search, `last_message_at` cursor, datetime, and
  channel parsers for both admin and token-authenticated public routes; the
  public serializers differ only in the fields they expose.

**Why:** Billing and tag handlers had grown their own `select()` statements,
the public conversation routes carried private copies of the admin cursor
helpers, and contact names were joined in eight places with slightly different
fallbacks. Putting each concern in one module keeps the handlers readable,
lets repository tests assert the compiled SQL directly, and makes new routes
extend an existing repository instead of re-deriving queries.

## Keeping Documentation Up to Date

**Decision:** Architecture documentation in `docs/architecture/` describes
high-level design, patterns, and decisions. API endpoint details (paths,
methods, parameters, schemas) are documented exclusively in the OpenAPI
specs under `docs/api/`. Architecture docs must link to the OpenAPI specs
rather than duplicating endpoint information.

When making changes:
1. Update the relevant OpenAPI spec if adding/changing endpoints.
2. Update `docs/architecture/lambdas.md` if adding/changing Lambda functions.
3. Update `docs/architecture/database-schema.md` if adding/changing tables.
4. Update other architecture docs if design decisions or patterns change.
