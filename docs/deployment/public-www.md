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
- `PublicWwwApiBaseUrl`: `<FROM_GITHUB_VAR: PUBLIC_WWW_API_BASE_URL>`
- `PublicWwwMediaRequestApiBaseUrl`: `<FROM_GITHUB_VAR: PUBLIC_WWW_MEDIA_REQUEST_API_BASE_URL>`
- `PublicWwwEdgeVerifySecret`: `<FROM_GITHUB_SECRET: CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY>`
- `PublicWwwEdgeVerifySecretPrevious`: `<FROM_GITHUB_SECRET: CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY_PREVIOUS>`
- `PublicWwwStagingEdgeVerifySecret`: `<FROM_GITHUB_SECRET: CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY>`
- `PublicWwwStagingEdgeVerifySecretPrevious`: `<FROM_GITHUB_SECRET: CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY_PREVIOUS>`
- `WafWebAclArn`: optional CloudFront WAF ACL ARN (us-east-1). It is empty,
  and neither distribution attaches a WebACL.

`PublicWwwEdgeVerifySecret` and `PublicWwwStagingEdgeVerifySecret` are the
origin-lock values compared with `x-proxy-verify`. Each `Previous` parameter
is accepted during rotation. Both values empty leaves that distribution
open.

`deploy-backend.yml` runs in the `production` GitHub environment on
`workflow_dispatch`, on `repository_dispatch` of type `deploy-backend`, and
on a push to `main` that changes `backend/**`, `scripts/**`,
`apps/public_www/src/content/landing-pages/**`,
`apps/public_www/src/content/eventbrite-banners/**`, or
`.github/workflows/deploy-backend.yml`. The stack list is the workflow
input, otherwise the `CDK_STACKS` repository variable, otherwise
`all stacks`, which includes this stack. Create
`CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY` and
`CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY_PREVIOUS` as repository secrets or
production-environment secrets. A secret that exists only in the `staging`
environment is not visible, the parameter stays empty, and the lock stays
off. The same applies to `CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY` and
`CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY_PREVIOUS`.

Deploy passes these four parameters even when the secrets are unset, so
clearing a pair and deploying turns that distribution's lock off. A deploy
that cannot see a previously set secret also turns it off. After a
successful deploy of this stack, the job summary lists
`PublicWwwEdgeVerifyEnabled` and `PublicWwwStagingEdgeVerifyEnabled` before
and after, and the log warns when either goes from `true` to anything else.

The deploy that publishes this check updates the three production
viewer-request functions (path rewrite, `www/*`, and
`www/v1/assets/free/request`) even while both production secrets are empty.
The check returns the request unchanged in that case, so responses stay as
they are. CloudFormation updates the four functions on a distribution one
after another.

Order for staging: set the Worker binding
`PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET`, then set
`CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY` to the same value and deploy.
Setting the parameter first refuses `www-staging.evolvesprouts.com`.

Order for production. Leave both production secrets empty until the Trace
check below has passed. The Cloudflare dashboard is where the rule is
applied.

1. In the zone `evolvesprouts.com`, open Workers routes and confirm no
   route matches `www.evolvesprouts.com`. A Worker on that hostname can replace
   the request and drop `x-proxy-verify`. The apex name redirects to `www`
   at Cloudflare and is not a CloudFront alias, so the rule matches
   `www.evolvesprouts.com` only.
2. Add the request-header transform rule from
   `scripts/cloudflare/public_www_edge_policy.json`. It sets
   `x-proxy-verify` on `www.evolvesprouts.com`.
3. Use the zone Trace tool on `https://www.evolvesprouts.com/en/`. The rule
   has to set `x-proxy-verify` on the request that leaves Cloudflare. When
   a Worker route matches that hostname, the same trace has to show the
   header still present on the fetch toward CloudFront.
4. Set `CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY` to that same value, as a
   repository secret or a production-environment secret, and deploy
   `evolvesprouts-public-www`.
5. Request `https://www.evolvesprouts.com/en/` with a query string that
   Cloudflare has not cached, and expect 200. A page Cloudflare still has cached is
   served there and never reaches CloudFront, so it stays 200 even when the
   origin would return 403. Then request the hostname in stack output
   `PublicWwwDistributionDomain` with no `x-proxy-verify` header and expect
   403 with `x-cache: FunctionGeneratedResponse from cloudfront`. That
   hostname never passes through the Cloudflare rule, so 403 there means
   the lock is enforcing.

Setting the secret before the rule refuses `www.evolvesprouts.com`. Turning
the lock back off is another deploy of this stack with both production
secrets empty. That deploy publishes the functions again.

To rotate that secret:

1. Set `CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY_PREVIOUS` to the value the
   Worker sends now, and `CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY` to the
   new value.
2. Deploy this stack. Both values are accepted, so the current Worker
   header still passes.
3. Set the Worker binding `PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET` to the
   new value.
4. Clear `CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY_PREVIOUS`.
5. Deploy this stack again.

The Worker sends one value. Doing step 3 before step 2, or step 4 before
step 3, refuses `www-staging.evolvesprouts.com`. Production rotation is the
same five steps, with the Cloudflare rule in place of the Worker binding
and `CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY` in place of the staging secret.

`lighthouse-public-www.yml` audits `http://localhost:9000` unless its
page-path input is a full URL, so the lock does not affect the default run.
A manual run pointed at either CloudFront hostname gets 403 once that
distribution's lock is on. The staging smoke goes through
`www-staging.evolvesprouts.com` and needs the Worker header once the staging
lock is on.

Public WWW API configuration is provided at build time via:

- GitHub variable `NEXT_PUBLIC_WWW_API_BASE_URL` (public-site build API base;
  falls back to `NEXT_PUBLIC_API_BASE_URL`. Use `/www` for same-origin calls)
- GitHub variable `NEXT_PUBLIC_API_BASE_URL` (admin and other direct clients;
  set this to `ApiCustomDomainUrl` at API cutover)
- GitHub variables `PUBLIC_WWW_API_BASE_URL` and
  `PUBLIC_WWW_MEDIA_REQUEST_API_BASE_URL` (CloudFront origins; backend deploy
  falls back to `NEXT_PUBLIC_API_BASE_URL` when unset)
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
to the host resolved from `PublicWwwApiBaseUrl` (GitHub variable
`PUBLIC_WWW_API_BASE_URL`) with caching disabled for those requests.
`POST /www/v1/assets/free/request` is routed by a path-specific CloudFront behavior
to the origin resolved from `PublicWwwMediaRequestApiBaseUrl`, with
URI rewrite to `/v1/assets/free/request`.
Point both origin variables at `ApiCustomDomainUrl`. The execute-api
hostname does not accept calls.
Set `NEXT_PUBLIC_WWW_API_BASE_URL` (or `NEXT_PUBLIC_API_BASE_URL`) to `/www`
in the public-site build to keep browser API calls same-origin and avoid
cross-origin CORS preflight failures.

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
  - probe landing page calendars at `NEXT_PUBLIC_API_BASE_URL`. That
    variable stays an absolute URL. The site build reads
    `NEXT_PUBLIC_WWW_API_BASE_URL`, which may be the relative `/www` path.

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
- Optional secret:
  - `STAGING_BYPASS_SECRET` (same value as the staging Worker). Smoke sends
    it only to the staging host. The run stays green while the secret is
    unset and responses stay on that host. A redirect to another host fails
    the run and names this secret.
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
