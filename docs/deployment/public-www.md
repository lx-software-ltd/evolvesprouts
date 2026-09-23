# Public WWW deployment

`public_www` is a static website hosted in S3 and served by CloudFront.

## Environment model

Public WWW uses a single CloudFormation stack:

- **Public Website stack**: `evolvesprouts-public-www`

Inside the stack, production and staging use separate S3 + CloudFront assets:

- Production URL: `https://www.evolvesprouts.com`
- Staging URL: `https://www-staging.evolvesprouts.com`

The release process is **staging first**:

1. Push to `main` deploys to staging.
2. CI stores the exact built artifact at
   `s3://<staging-bucket>/releases/<release_id>/`.
3. Manual promotion **still requires a matching staging release id** (for
   traceability), but CI **rebuilds** the static site with the **production**
   GitHub Environment variables and syncs that output to the production bucket.

Staging and production can therefore use different `NEXT_PUBLIC_*` values (for
example Stripe publishable keys) while keeping the same git revision as the
promoted staging release.

## Prerequisites

- ACM certificate in `us-east-1` covering:
  - `www.evolvesprouts.com`
  - `www-staging.evolvesprouts.com`
- CloudFront aliases configured for both domains

## CDK parameters

Provide these parameters in `backend/infrastructure/params/production.json`:

- `PublicWwwDomainName`: `www.evolvesprouts.com`
- `PublicWwwCertificateArn`: ACM certificate ARN for production
- `PublicWwwStagingDomainName`: `www-staging.evolvesprouts.com`
- `PublicWwwStagingCertificateArn`: ACM certificate ARN for staging
- `PublicWwwApiBaseUrl`: `<FROM_GITHUB_VAR: NEXT_PUBLIC_API_BASE_URL>`
- `PublicWwwMediaRequestApiBaseUrl`: `<FROM_GITHUB_VAR: NEXT_PUBLIC_API_BASE_URL>`
- `WafWebAclArn`: optional CloudFront WAF ACL ARN (us-east-1)

Public WWW API configuration is provided at build time via:

- GitHub variable `NEXT_PUBLIC_API_BASE_URL`
- GitHub variable `NEXT_PUBLIC_WWW_PROXY_ALLOWED_HOSTS`
- GitHub secret `NEXT_PUBLIC_WWW_CRM_API_KEY`
- GitHub variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- GitHub variable `NEXT_PUBLIC_STAGING_STRIPE_PUBLISHABLE_KEY` (staging
  environment; test `pk_test_…` for the public booking modal)
- GitHub variable `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (production environment;
  live `pk_live_…`; used when rebuilding during promotion)
- If `NEXT_PUBLIC_STAGING_STRIPE_PUBLISHABLE_KEY` is unset in the staging
  environment, staging builds fall back to `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- GitHub variable `NEXT_PUBLIC_FPS_MERCHANT_NAME` (or secret fallback)
- GitHub variable `NEXT_PUBLIC_FPS_MOBILE_NUMBER` (or secret fallback)
- GitHub variable `NEXT_PUBLIC_GTM_ID`
- GitHub variable `NEXT_PUBLIC_GTM_ALLOWED_HOSTS` (optional comma-separated
  hostname allowlist for runtime GTM gating)
- GitHub variable `NEXT_PUBLIC_EMAIL`
- GitHub variable `NEXT_PUBLIC_FOUNDER_NAME` (founder display name on `llms.txt`)
- GitHub variable `NEXT_PUBLIC_WHATSAPP_URL`
- GitHub variable `NEXT_PUBLIC_INSTAGRAM_URL`
- GitHub variable `NEXT_PUBLIC_LINKEDIN_URL`
- GitHub variable `NEXT_PUBLIC_BUSINESS_NAME` (trading name; public site and invoice PDF **From** block)
- GitHub variable `NEXT_PUBLIC_BUSINESS_LEGAL_NAME` (legal entity; **Admin Lambda** invoice PDF footer only; the public site does not render it today)
- GitHub variable `NEXT_PUBLIC_BUSINESS_ADDRESS`
- GitHub variable `NEXT_PUBLIC_BUSINESS_PHONE_NUMBER`
- GitHub variable `NEXT_PUBLIC_BUSINESS_REGISTRATION` (business registration / BR for invoice PDF footers)
- GitHub variable `CDK_PARAM_INVOICE_DISPLAY_TIMEZONE` (passes through backend `InvoiceDisplayTimezone` to Admin Lambda `INVOICE_DISPLAY_TIMEZONE` for AR invoice calendar dates; required to issue invoices)
- GitHub variable `CDK_PARAM_INVOICE_PAYMENT_TERMS_DAYS` (due-date offset for issued invoices; see `docs/architecture/setup.md`)

`NEXT_PUBLIC_SITE_ORIGIN` is resolved automatically in CI from
`backend/infrastructure/params/production.json` (`PublicWwwDomainName`) to keep
the website canonical origin aligned with infrastructure domain parameters.
When `NEXT_PUBLIC_GTM_ALLOWED_HOSTS` is unset, GTM runtime gating defaults to
the hostname resolved from `NEXT_PUBLIC_SITE_ORIGIN`.

`evolvesprouts-public-www` CloudFront proxies `https://{www-domain}/www/*`
to the host resolved from `PublicWwwApiBaseUrl` (derived from
`NEXT_PUBLIC_API_BASE_URL`) with caching disabled for those requests.
`POST /www/v1/assets/free/request` is routed by a path-specific CloudFront behavior
to the execute-api origin resolved from `PublicWwwMediaRequestApiBaseUrl`, with
URI rewrite to `/v1/assets/free/request`.
Set `NEXT_PUBLIC_API_BASE_URL` to `/www` in runtime client config to
keep browser API calls same-origin and avoid cross-origin CORS preflight
failures.

## CI/CD workflows

### Deploy to staging (automatic)

Workflow: `.github/workflows/deploy-public-www.yml`

- Trigger: push to `main` for `apps/public_www/**` or `scripts/**`
- Target stack: `evolvesprouts-public-www`
- Target environment: `staging`
- Release ID: `github.sha`
- Behavior:
  - deploy current artifact to staging root
  - store immutable snapshot in `releases/<release_id>/`
  - preserve existing `_next/static` hashed assets to avoid stale HTML
    requesting deleted chunks
  - re-apply `/www/*` CloudFront proxy allowlist behavior
  - invalidate staging CloudFront (including `/_next/static/*` to clear
    stale asset error responses)

### Smoke test staging website

Workflow: `.github/workflows/smoke-public-www-staging.yml`

- Trigger:
  - Manual (`workflow_dispatch`) with optional scope:
    - `all` (default)
    - `pages`
    - `api`
- Target URL:
  - resolved from `PublicWwwStagingDomainName` in
    `backend/infrastructure/params/production.json`
- Required secret:
  - `NEXT_PUBLIC_WWW_CRM_API_KEY`
- Optional variables for API endpoint fallbacks:
  - `NEXT_PUBLIC_API_BASE_URL` (used by smoke as
    `SMOKE_CRM_API_BASE_URL` and `SMOKE_MEDIA_API_BASE_URL`)
- Behavior:
  - runs `npm run smoke:staging` in `apps/public_www`
  - verifies page health via sitemap-driven URL checks (with staging-origin URL
    remapping)
  - verifies public API endpoints:
    - `GET /www/v1/calendar/public`
    - `GET /www/v1/assets/free?limit=100`
    - `POST /www/v1/contact-us`
    - `POST /www/v1/discounts/validate`
    - `POST /www/v1/assets/free/request`
    - `POST /www/v1/reservations`
    - `POST /www/v1/reservations/payment-intent`
  - when same-origin `/www/*` checks return `404`, retries API checks through
    configured fallback API base URLs before failing

### Promote to production (manual)

Workflow: `.github/workflows/promote-public-www.yml`

- Trigger: manual (`workflow_dispatch`)
- Inputs:
  - `promotion_mode=latest_staging` to promote the most recent staging build
  - `promotion_mode=release_id` with `release_id=<id>` to promote a specific
    staging release
  - `promotion_mode=maintenance_on` to deploy a static maintenance page to
    production and block `https://www.evolvesprouts.com/www/*` at CloudFront
- Required for promotion builds (not `maintenance_on`): `AssetDownloadCustomDomainName`
  in `backend/infrastructure/params/production.json` (same source as staging
  deploys for `NEXT_PUBLIC_ASSET_SHARE_BASE_URL`).
- Behavior:
  - `latest_staging` / `release_id`:
    - resolve `release_id` from the staging bucket marker or workflow input
    - verify that `releases/<release_id>/` exists in the staging bucket
    - run `npm ci` + `npm run build` in `apps/public_www` with **production**
      GitHub Environment variables (including `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
    - sync `apps/public_www/out` to the production bucket (not a copy of the
      staging S3 artifact)
    - restore `/www/*` CloudFront proxy allowlist behavior
    - fully invalidate production CloudFront
  - `maintenance_on`:
    - deploy static maintenance artifact from `apps/public_www/maintenance/`
      to production root (no Next.js build required)
    - include `/images/evolvesprouts-logo.svg` from `apps/public_www/public/`
    - include `/favicon.ico` from `apps/public_www/public/`
    - set `Cache-Control: no-store` on maintenance files
    - switch `/www/*` CloudFront behavior to a maintenance block function
      returning `503 Service Unavailable`
    - fully invalidate production CloudFront

### Rollback

Rollback uses the same promotion workflow by promoting a previous `release_id`.

## Maintenance mode

Use maintenance mode when production must show a minimal static fallback page.

Maintenance artifact source:

- `apps/public_www/maintenance/index.html`
- `apps/public_www/maintenance/404.html`
- `apps/public_www/maintenance/styles.css`
- `apps/public_www/maintenance/robots.txt`
- `apps/public_www/maintenance/images/*.png`
- `apps/public_www/public/favicon.ico` (copied into maintenance output at deploy time)

Characteristics:

- Static HTML + CSS only (no JavaScript)
- Logo + maintenance text + contact methods (email, WhatsApp, Instagram)
- Maintenance contact values are injected from GitHub environment variables:
  - `NEXT_PUBLIC_EMAIL`
  - `NEXT_PUBLIC_WHATSAPP_URL`
  - `NEXT_PUBLIC_INSTAGRAM_URL`
- `/www/*` API proxy blocked at CloudFront while maintenance is enabled

### Enable maintenance mode (production)

Manual workflow:

- Run `.github/workflows/promote-public-www.yml`
- Select `promotion_mode=maintenance_on`

Local equivalent:

```bash
PUBLIC_WWW_STACK_NAME=evolvesprouts-public-www \
PUBLIC_WWW_ENVIRONMENT=production \
PUBLIC_WWW_MAINTENANCE_MODE=true \
NEXT_PUBLIC_EMAIL=hello@example.com \
NEXT_PUBLIC_WHATSAPP_URL=https://wa.me/message/EXAMPLE \
NEXT_PUBLIC_INSTAGRAM_URL=https://instagram.com/example \
bash scripts/deploy/deploy-public-www.sh
```

### Disable maintenance mode (production)

Recommended:

- Run `.github/workflows/promote-public-www.yml`
- Select `promotion_mode=latest_staging`

Alternative:

- Run `.github/workflows/promote-public-www.yml`
- Select `promotion_mode=release_id`
- Provide a known-good staged release ID

Disabling maintenance mode restores the standard `/www/*` CloudFront allowlist
function and promotes the selected staged release to production.

## Local build and deploy

```bash
cd apps/public_www
npm ci
npm run build
```

From repo root, deploy to production assets in the Public Website stack:

```bash
bash scripts/deploy/deploy-public-www.sh
```

Deploy to staging assets and persist an immutable release snapshot:

```bash
PUBLIC_WWW_STACK_NAME=evolvesprouts-public-www \
PUBLIC_WWW_ENVIRONMENT=staging \
PUBLIC_WWW_RELEASE_ID=$(git rev-parse HEAD) \
bash scripts/deploy/deploy-public-www.sh
```

Promote a release from staging to production:

```bash
PUBLIC_WWW_STACK_NAME=evolvesprouts-public-www \
PUBLIC_WWW_PROMOTE_RELEASE_ID=<release_id> \
bash scripts/deploy/deploy-public-www.sh
```

Promote the latest staged release (runner equivalent of
`promotion_mode=latest_staging`):

```bash
STAGING_BUCKET="$(aws cloudformation describe-stacks \
  --stack-name evolvesprouts-public-www \
  --query "Stacks[0].Outputs[?OutputKey=='PublicWwwStagingBucketName'].OutputValue" \
  --output text)"
LATEST_RELEASE_ID="$(aws s3 cp \
  "s3://$STAGING_BUCKET/releases/latest-release-id.txt" - | tr -d '\r\n')"
PUBLIC_WWW_STACK_NAME=evolvesprouts-public-www \
PUBLIC_WWW_PROMOTE_RELEASE_ID="$LATEST_RELEASE_ID" \
bash scripts/deploy/deploy-public-www.sh
```

## Figma token sync in CI/CD

`public_www` uses the Token Studio pipeline for design tokens:

- `figma/token-studio/` stores Token Studio design tokens (tracked in git)
- `figma/files/` stores raw Figma API payloads (gitignored)

The staging deploy workflow does **not** call the Figma API directly.
It consumes Token Studio artifacts already committed by
`.github/workflows/figma-token-studio-sync.yml`.

`npm run build` runs `figma:build:studio` to generate CSS custom
properties from committed Token Studio tokens, then `next build`
to produce the static site.

For the full Figma pipeline architecture, see
[docs/architecture/public-www-figma-pipeline.md](../architecture/public-www-figma-pipeline.md).

The token sync workflow reads these GitHub values for OAuth 2.0 auth:

- Secrets:
  - `FIGMA_OAUTH_CLIENT_ID`
  - `FIGMA_OAUTH_CLIENT_SECRET`
  - `FIGMA_OAUTH_REFRESH_TOKEN`
- Variables:
  - `PUBLIC_WWW_FIGMA_FILE_KEY`
  - `PUBLIC_WWW_FIGMA_TOKEN_ROOT_NODE` (scopes extraction to a frame)
  - `PUBLIC_WWW_FIGMA_OAUTH_TOKEN_URL` (optional override; exposed to
    scripts as `FIGMA_OAUTH_TOKEN_URL`)

## SEO behavior

- Production remains indexable.
- Staging sends `X-Robots-Tag: noindex, nofollow, noarchive` from CloudFront.
- A visible `Staging` badge is rendered in the top-right corner for staging
  hostnames.

`public_www` intentionally does **not** use SPA fallback rewrites. CloudFront
returns normal 404 responses for unknown routes, which preserves crawler
semantics for indexing.

For branded not-found UX on static export, CloudFront custom error responses
map S3 403/404 origin misses to `/404.html` while preserving HTTP 404 status.
