# Architecture Overview

This document describes the current architecture for the mobile app,
admin console, and backend services.

## High-level diagram

```
Flutter Mobile / Next.js Admin
        |
        v
    Cognito (Auth)
        |
        v
    API Gateway
        |
        v
      Lambda (Python)
        |
        v
     RDS Proxy
        |
        v
 Aurora PostgreSQL (Serverless v2)
```

## Components

### Mobile app (Flutter)
- Users browse public and granted assets delivered via presigned URLs.
- Uses generated Dart API client from OpenAPI specs.
- Device attestation uses Firebase App Check (Play Integrity / App Attest).

### Admin console (Next.js App Router)
- Admin users manage assets and access grants.
- **Locations:** CRM contacts, families, organisations, and Services venues all edit shared `locations` rows through the same inline location editor (`InlineLocationEditor`). Saving a location updates that row for every record that references it.
- **CRM organisations:** Contacts → Organisations lists only CRM relationship types (vendors and partners are excluded by default on `GET /v1/admin/organizations` and the organisation picker). Partner organisations are edited under **Services → Partners**; vendors under **Finance → Vendors**.
- Hosted on Amplify Hosting (release jobs triggered in CI).

### Public website (Next.js static export)
- Public marketing site in `apps/public_www`.
- Training form and poll pages in `apps/training` (static export at `training.evolvesprouts.com`, not indexed).
  Form answers persist via `PUT /www/v1/forms/{form_slug}/answers` against the shared
  DynamoDB table `evolvesprouts-poll-responses` (content-driven JSON per form under
  `apps/training/src/content/forms/`). Poll answers persist via
  `PUT /www/v1/polls/{poll_slug}/answers` and live per-question aggregates load via
  `GET /www/v1/polls/{poll_slug}/questions/{question_id}/results` (content-driven JSON
  per poll under `apps/training/src/content/polls/`).
- First-party marketing paths are defined once in `apps/public_www/src/lib/public-www-routes.ts` and
  imported by `apps/public_www/src/lib/routes.ts` and the admin Website QR presets so public and admin
  stay aligned.
- Referral links for scoped discounts use query parameters (`ref` / `discount`)
  on locale-prefixed course URLs; the backend matches `service_key` to
  `services.service_key` in Aurora for validate/redeem scope checks.
  Instance-scoped discount redemption uses the public `service_instances.slug` sent as
  `service_instance_slug` (validate) and `serviceInstanceSlug` (reservations) for **events**
  and **MBA**; consultation tiers and intro-call identify catalog rows by `service_key` only on those routes.
  The public calendar feed (`GET /v1/calendar/public`) exposes the same `slug` field for events and
  training courses; finished **event** instances remain listed for roughly 90 days after their last session ends. Family consultation venue copy for the booking modal lives in
  `apps/public_www/src/content/family-consultations.json` (per tier `service_key`).
- Hosted on S3 + CloudFront in one stack with separate staging and
  production assets.
- Deploys to staging first, then promotes immutable release artifacts to
  production.
- Placeholder public routes (currently `/privacy`, `/terms`, and
  `/services/workshops`) remain reachable for users but are marked
  `noindex,follow` in page metadata and excluded from sitemap entries.

### Backend
- API Gateway currently exposes REST endpoints for:
  - `GET /health`
  - asset/admin routes under `/v1/admin/assets/*`,
    `/v1/user/assets/*`, and `/v1/assets/public/*`
- For route inventory and authentication requirements, see:
  - [`docs/api/admin.yaml`](../api/admin.yaml) — currently wired routes
  - [`docs/api/public.yaml`](../api/public.yaml) — public endpoint contract
    (public asset routes plus public_www-consumed `/www/*` routes)
- Lambda functions in `backend/lambda/` call into shared code in
  `backend/src/app`.
- See [`docs/architecture/lambdas.md`](lambdas.md) for a full function inventory.
- A generic AWS/HTTP proxy Lambda (`AwsApiProxyFunction`) runs outside
  the VPC and provides a channel for in-VPC Lambdas to call services
  that are unreachable via PrivateLink (e.g. Cognito with ManagedLogin).
  Requests are gated by allow-lists (`ALLOWED_ACTIONS` for AWS API
  calls, `ALLOWED_HTTP_URLS` for outbound HTTP).  See
  `backend/src/app/services/aws_proxy.py`.
- Asynchronous messaging (SNS + SQS) is used for manager access requests
  organization suggestions, and inbound invoice email processing. See
  [`docs/architecture/aws-messaging.md`](aws-messaging.md).
- SQLAlchemy models map to Aurora PostgreSQL.
- Alembic manages schema migrations, executed via a custom resource Lambda
  during deploy.
- Cognito User Pool secures admin/manager routes; any-user routes require
  only a valid JWT. Passwordless email challenges and federated sign-in
  with Google are supported.
- API keys are rotated automatically every 90 days via a scheduled Lambda.
- The org-wide sales plan of the day is generated every morning at 06:00 HKT.

## Data model

Key entities:
- `locations` (district used for filtering)
- `geographic_areas`
- `assets`
- `asset_access_grants`
- `inbound_emails` (SES/S3 invoice email tracking and idempotency)
- `audit_log` (automatic change tracking via triggers)

All times are stored in UTC.
See [`docs/architecture/database-schema.md`](database-schema.md) for full table details.

## Database and migrations

- Aurora PostgreSQL Serverless v2.
- RDS Proxy with IAM auth for Lambda connections.
- Alembic migrations live under `backend/db/`.
- Seed data stored in `backend/db/seed/seed_data.sql`.
- Migrations run via a custom resource Lambda using password auth.
- Application traffic uses IAM auth via the proxy and the `evolvesprouts_app` role.
- Deployments reuse existing DB clusters, proxies, and VPCs when detected.

## CI/CD

- GitHub Actions with OIDC for AWS access.
- Deploy workflows for mobile, admin web, backend, public website, and iOS.
- CDK bootstrap workflow for initial environment setup.
- Lockfile checks for Flutter, Node, and iOS.
- Amplify promotion workflow with gating (staging -> main).
- Public website promotion workflow with immutable artifact promotion
  (staging -> production).
- Public website CI validates content, lint, tests, static build, and
  production-only npm dependency audit (`npm audit --omit=dev`).
- Dependabot enabled for automated dependency updates (see below).
- Infrastructure tests validate CDK templates for new and imported
  database resources.

## Dependency Management

Dependabot is configured (`.github/dependabot.yml`) to automatically create
pull requests for dependency updates:

| Ecosystem | Directory | Scope |
|-----------|-----------|-------|
| GitHub Actions | `/` | CI workflow action versions |
| npm | `/backend/infrastructure` | CDK and TypeScript dependencies |
| pip | `/backend` | Python Lambda dependencies |
| pub | `/apps/evolvesprouts_app` | Flutter/Dart dependencies |

**Configuration:**
- Weekly updates (Mondays) to reduce PR noise.
- Related dependencies grouped into single PRs (AWS, Firebase, database, etc.).
- Major version updates ignored (require manual review).
- PRs labeled by ecosystem for easy filtering.

## Security

- No long-lived AWS credentials in GitHub.
- IAM auth for RDS Proxy, TLS enforced on DB connections.
- Secrets stored in GitHub Secrets or AWS Secrets Manager.
- Public asset routes require an API key plus device attestation (JWKS-validated).
- Admin API routes protected by the admin group authorizer require membership in
  at least one of the Cognito groups `admin`, `manager`, or `instructor`.
- The admin web app shows the dashboard only for the same staff groups; other
  signed-in pool users see an access-denied screen with sign out.
- User routes (when exposed) require any valid Cognito JWT (no group requirement).
- API keys are rotated every 90 days via a scheduled Lambda.
- The org-wide sales plan of the day is generated every morning at 06:00 HKT.
- Optional CDK parameters can bootstrap an initial admin user.
- Passwordless email sign-in uses Cognito custom auth triggers.
- Hosted UI enables Google IdP via OAuth.
- Database audit logging tracks all data changes (see [`audit-logging.md`](audit-logging.md)).
- See [`docs/architecture/security.md`](security.md) for full security guidelines.

## Observability

- CloudWatch logs for all Lambda functions (KMS encrypted, 90-day retention).
- X-Ray tracing enabled for API Gateway.
- CloudWatch alarms for DLQ messages (manager request processing failures).
- Structured JSON logging with request ID correlation.
- Client-side analytics via Google Tag Manager on the public website
  (production only; gated at runtime by hostname allowlist).
- GA4/GTM taxonomy and implementation details are documented in
  [`analytics-ga4-gtm-runbook.md`](analytics-ga4-gtm-runbook.md).
- Full marketing stack documentation (GCP, GTM, GA4, Google Ads, Search
  Console, social media, and lead generation) is in
  [`marketing-stack.md`](marketing-stack.md).
- Infrastructure map (Cloudflare, AWS, VPC, database, deployments) is in
  [`infrastructure-map.md`](infrastructure-map.md).

## Caching

- API Gateway stage caching is disabled; allowlisted `GET` traffic on the
  `public_www` CloudFront distribution is edge-cached on the `www/*` behavior
  using origin `Cache-Control` headers (custom cache policy caps TTL at 15 minutes).
- **Known limitation:** JSON responses still include CORS `Vary: Origin` while the
  cache policy does not vary the cache key by `Origin`. Same-origin `public_www`
  traffic is unaffected; cross-origin callers against `/www/*` could theoretically
  see a mismatched `Access-Control-Allow-Origin` if that pattern is introduced.
  Fixing this means either omitting CORS on these routes, or adding `Origin` to the
  CloudFront cache key (lower hit rate).
- Client-side caching with stale-while-revalidate in Flutter (planned).
- Cloudflare proxies production public website and API traffic at the edge.
