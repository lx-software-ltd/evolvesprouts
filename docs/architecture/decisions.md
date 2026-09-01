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

## 12) Admin Web Section Ordering

**Decision:** In admin web screens, edit/create sections must appear above list
sections.

**Why:**
- Keeps primary task flow consistent with the established Siutindei admin
  interaction pattern.
- Makes the edit context visible before browsing/filtering lists.
- Reduces visual jumps when switching selected items.

**Notes:**
- Apply this ordering to newly built admin pages and when refactoring existing
  screens.
- Service management follows this pattern by rendering Service detail before the
  Services list.

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
open SalesLead on first inbound when none exists. Admin reads live at
`GET /v1/admin/whatsapp/conversations` (Sales → WhatsApp tab).

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
traffic stays on `/v1/whatsapp/webhook`). Persist threads in unified
`meta_conversations` / `meta_messages` keyed by `(channel, platform_user_id)`.
Create a Contact plus open SalesLead on first inbound when none exists.
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
  still fails at `limit=1`. Nested `messages.limit(20)` on a wide
  conversation page exceeds Graph payload limits.
  Meta only returns message **bodies** for the last 20 messages per thread.
  Persist through the same `store_meta_message` path as webhooks (unique
  `platform_message_id`). Create placeholder contacts when missing. Do **not**
  create new Sales leads.
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
