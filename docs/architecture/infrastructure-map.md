# Infrastructure Map — Cloudflare + AWS

This document maps the full backend infrastructure: how traffic flows from
the internet through Cloudflare and AWS to serve the website, API, and
supporting services.

## Traffic flow overview

```
                              Internet
                                 │
                    ┌────────────▼────────────┐
                    │       Cloudflare         │
                    │     (DNS + Edge Proxy)   │
                    └──┬─────────┬─────────┬──┘
                       │         │         │
              ┌────────▼──┐ ┌───▼────┐ ┌──▼──────────┐
              │  Public   │ │  API   │ │   Media      │
              │  Website  │ │        │ │   Downloads  │
              └─────┬─────┘ └───┬────┘ └──┬───────────┘
                    │           │          │
         ┌──────────▼──┐  ┌────▼────┐  ┌──▼──────────────┐
         │ CloudFront  │  │  API    │  │ CloudFront       │
         │ (S3 origin) │  │ Gateway │  │ (S3 signed URLs) │
         └─────────────┘  └────┬────┘  └─────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Lambda (Python)    │
                    │   (in VPC)           │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    RDS Proxy        │
                    │    (IAM auth)       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Aurora PostgreSQL   │
                    │  (Serverless v2)     │
                    └─────────────────────┘
```

## Cloudflare

Cloudflare sits in front of all public-facing services as a DNS provider
and edge proxy. It is managed manually through the Cloudflare dashboard
(no infrastructure-as-code).

### DNS records

| Record | Domain | Target | Proxy |
|---|---|---|---|
| CNAME | `www.evolvesprouts.com` | CloudFront distribution (public website) | Yes |
| CNAME | `www-staging.evolvesprouts.com` | CloudFront distribution (staging) | Yes |
| CNAME | `api.evolvesprouts.com` | API Gateway custom domain | No (grey cloud) |
| CNAME | `admin.evolvesprouts.com` | CloudFront distribution (admin web) | Yes |
| CNAME | `training.evolvesprouts.com` | CloudFront distribution (training web) | Yes |
| CNAME | `media.evolvesprouts.com` | CloudFront distribution (asset downloads) | Yes |
| CNAME | `auth.evolvesprouts.com` | Cognito custom domain CloudFront | No |
| MX | `evolvesprouts.com` | iCloud Mail | N/A |
| MX | `inbound.evolvesprouts.com` | `10 inbound-smtp.ap-southeast-1.amazonaws.com` | N/A |

### Cloudflare Turnstile (CAPTCHA)

Bot protection for public forms (media download, reservations).

| Component | Details |
|---|---|
| **Frontend widget** | `apps/public_www/src/components/shared/turnstile-captcha.tsx` loads `challenges.cloudflare.com/turnstile/v0/api.js` |
| **Backend verification** | `backend/src/app/services/turnstile.py` verifies tokens via `challenges.cloudflare.com/turnstile/v0/siteverify` |
| **CDK parameter** | `TurnstileSecretKey` (noEcho) |
| **Frontend env var** | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| **Backend env var** | `TURNSTILE_SECRET_KEY` (from CDK param) |

### Cloudflare account credentials

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| `CLOUDFLARE_API_TOKEN` | API token for DNS management (used by deployment workflows if needed) |

## AWS account

| Field | Value |
|---|---|
| Account ID | `588024549699` |
| Primary region | `ap-southeast-1` (Singapore) |
| CloudFront/ACM region | `us-east-1` (required by CloudFront) |
| IAM deploy role | `GitHubActionsRole` (OIDC, no long-lived credentials) |

## CDK stacks

All infrastructure is defined as code in `backend/infrastructure/` using
AWS CDK (TypeScript).

| Stack | File | Purpose |
|---|---|---|
| `evolvesprouts` | `lib/api-stack.ts` | Backend: API Gateway, Lambdas, Aurora, RDS Proxy, Cognito, SNS/SQS, S3, CloudFront |
| `evolvesprouts-admin-web` | `lib/admin-web-stack.ts` | Admin console: S3 + CloudFront |
| `evolvesprouts-public-www` | `lib/public-www-stack.ts` | Public website: S3 + CloudFront (prod + staging) |

**Entry point**: `backend/infrastructure/bin/app.ts`
**Parameters**: `backend/infrastructure/params/production.json`
**Resource prefix**: `evolvesprouts-`

## Public website (www.evolvesprouts.com)

### Architecture

```
Cloudflare (www.evolvesprouts.com)
        │
        ▼
CloudFront distribution
        │
        ├─▶ Default: S3 bucket (static Next.js export)
        │
        ├─▶ /www/v1/*: API Gateway (CRM API routes)
        │     └─▶ Viewer-request allowlist gates method/path pairs
        │
        └─▶ /www/v1/assets/free/request: API Gateway (media lead capture)
              └─▶ Path rewrite: /www/v1/assets/free/request → /v1/assets/free/request
```

### Stack: `evolvesprouts-public-www`

| Resource | Name/ID |
|---|---|
| S3 bucket (production) | Output: `PublicWwwBucketName` |
| S3 bucket (staging) | Output: `PublicWwwStagingBucketName` |
| CloudFront (production) | Output: `PublicWwwDistributionId` |
| CloudFront (staging) | Output: `PublicWwwStagingDistributionId` |
| Domain (production) | `www.evolvesprouts.com` (param: `PublicWwwDomainName`) |
| Domain (staging) | `www-staging.evolvesprouts.com` (param: `PublicWwwStagingDomainName`) |

### Security headers (CloudFront response policy)

`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Content-Security-Policy`, `Permissions-Policy`

CSP is split: CloudFront enforces `base-uri`, `object-src`, `frame-ancestors`;
page-level CSP with hashed inline scripts is injected at build time by
`apps/public_www/scripts/inject-csp-meta.mjs`.

### Staging protections

- `X-Robots-Tag: noindex, nofollow, noarchive` header on CloudFront
- Client-side `show-staging-badge.js` adds `noindex` meta tag and visual badge

## API (api.evolvesprouts.com)

### Architecture

```
Cloudflare (api.evolvesprouts.com) — proxy disabled
        │
        ▼
API Gateway (evolvesprouts-api)
  │
  ├─▶ /health ──────────────▶ HealthCheckFunction (VPC)
  │
  ├─▶ /v1/admin/* ──────────▶ AdminFunction (VPC)
  │     Authorization: AdminGroupAuthorizer (Cognito admin group)
  │
  ├─▶ /v1/user/* ───────────▶ AdminFunction (VPC)
  │     Authorization: UserAuthorizer (any Cognito JWT)
  │
  ├─▶ /v1/assets/public/* ──▶ AdminFunction (VPC)
  │     Authorization: DeviceAttestationAuthorizer + API Key
  │
  ├─▶ /v1/assets/free/request ─▶ AdminFunction (VPC) ──▶ SNS ──▶ SQS ──▶ MediaProcessor
  │     Authorization: API Key + Turnstile
  │
  ├─▶ /v1/calendar/public ─▶ AdminFunction (VPC)
  │
  ├─▶ /v1/mailchimp/webhook ▶ AdminFunction (VPC)
  │     Authorization: None (Mailchimp callback)
  │
  └─▶ /www/v1/* ────────────▶ AdminFunction (VPC)
       Authorization: API Key (via CloudFront origin header)
       Routes: /www/v1/calendar/public, /www/v1/discounts/validate,
               /www/v1/reservations, /www/v1/reservations/payment-intent,
               /www/v1/contact-us
```

### API Gateway configuration

| Setting | Value |
|---|---|
| API name | `evolvesprouts-api` |
| Type | Regional REST API |
| Stage | `prod` |
| Tracing | X-Ray enabled |
| Access logging | JSON format to CloudWatch |
| Caching | Disabled at stage; edge-cached at CloudFront for `/www/*` GETs |
| Custom domain | `api.evolvesprouts.com` (param: `ApiCustomDomainName`) |

### CORS

Origins derived from `PublicWwwDomainName`, `PublicWwwStagingDomainName`,
and `AdminWebDomainName` CDK parameters. No wildcard origins.

### API Key

| Resource | Purpose |
|---|---|
| `PublicWwwApiKey` | Authenticates public website → API requests |
| `PublicWwwUsagePlan` | Rate limiting for public API usage |
| `ApiKeyRotationFunction` | Rotates API key every 90 days (EventBridge schedule) |

## Database

### Architecture

```
Lambda (in VPC)
      │
      ▼
RDS Proxy (evolvesprouts-db-proxy)
  │   IAM auth, TLS required
  │
  ▼
Aurora PostgreSQL Serverless v2 (evolvesprouts-db-cluster)
  │   PostgreSQL 16.4
  │   0.5–2 ACU
  │
  Writer instance (evolvesprouts-db-writer)
```

### Details

| Field | Value |
|---|---|
| Engine | Aurora PostgreSQL 16.4 (Serverless v2) |
| Cluster | `evolvesprouts-db-cluster` |
| Writer | `evolvesprouts-db-writer` |
| Capacity | 0.5–2 ACU |
| Database name | `evolvesprouts` |
| Access | RDS Proxy with IAM auth (runtime); direct cluster endpoint with password (migrations) |
| Monitoring | Enhanced monitoring (60s interval) |
| Logs | PostgreSQL logs exported to CloudWatch |

### Database users

| User | Access | Used by |
|---|---|---|
| `postgres` | Full admin | Migration Lambda (direct cluster connection) |
| `evolvesprouts_admin` | Read-write | AdminFunction, processors, bootstrap, API key rotation |
| `evolvesprouts_app` | Read-only | HealthCheckFunction |

### Migrations

- Tool: Alembic (`backend/db/alembic/versions/`)
- Seed data: `backend/db/seed/seed_data.sql`
- Execution: `EvolvesproutsMigrationFunction` (CloudFormation custom resource)
- Trigger: Migration hash change during `cdk deploy`

## Lambda functions

All functions use Python 3.12, KMS-encrypted environment variables,
90-day CloudWatch log retention, and dedicated DLQs.

### Application functions (in VPC)

| Function | Handler | Trigger | Purpose |
|---|---|---|---|
| AdminFunction | `lambda/admin/handler.py` | API Gateway | All admin, public, and CRM API routes |
| HealthCheckFunction | `lambda/health/handler.py` | API Gateway | Health check with DB connectivity test |
| MigrationFunction | `lambda/migrations/handler.py` | CloudFormation | Alembic migrations + seed data |
| AdminBootstrapFunction | `lambda/admin_bootstrap/handler.py` | CloudFormation | Initial admin user creation in Cognito |
| ApiKeyRotationFunction | `lambda/api_key_rotation/handler.py` | EventBridge (90 days) | API key rotation |
| SalesDailyPlanFunction | `lambda/sales_daily_plan/handler.py` | SQS | Org-wide sales plan of the day (OpenRouter) |
| SalesDailyPlanSchedulerFunction | `lambda/sales_daily_plan_scheduler/handler.py` | EventBridge (06:00 HKT) | Enqueue daily sales plan job |
| MediaRequestProcessor | `lambda/media_processor/handler.py` | SQS | Process media leads → DB + Mailchimp + SES |
| InboundInvoiceEmailProcessor | `lambda/inbound_invoice_email/handler.py` | SQS | Store inbound invoice attachments as expenses and enqueue parsing |

### Auth functions (not in VPC)

| Function | Handler | Trigger |
|---|---|---|
| AuthPreSignUpFunction | `lambda/auth/pre_signup/handler.py` | Cognito PRE_SIGN_UP |
| AuthDefineChallengeFunction | `lambda/auth/define_auth_challenge/handler.py` | Cognito DEFINE_AUTH_CHALLENGE |
| AuthCreateChallengeFunction | `lambda/auth/create_auth_challenge/handler.py` | Cognito CREATE_AUTH_CHALLENGE |
| AuthVerifyChallengeFunction | `lambda/auth/verify_auth_challenge/handler.py` | Cognito VERIFY_AUTH_CHALLENGE |
| AuthPostAuthFunction | `lambda/auth/post_authentication/handler.py` | Cognito POST_AUTHENTICATION |

### Authorizer functions (not in VPC)

| Function | Handler | Purpose |
|---|---|---|
| DeviceAttestationAuthorizer | `lambda/authorizers/device_attestation/handler.py` | Validates `x-device-attestation` JWT |
| AdminGroupAuthorizerFunction | `lambda/authorizers/cognito_group/handler.py` | Cognito JWT + staff group check (`admin`, `manager`, `instructor`) |
| UserAuthorizerFunction | `lambda/authorizers/cognito_user/handler.py` | Cognito JWT (any valid user) |

### AWS API proxy (not in VPC)

| Function | Handler | Purpose |
|---|---|---|
| AwsApiProxyFunction | `lambda/aws_proxy/handler.py` | Proxies AWS service calls (Cognito) and external HTTP (Mailchimp, Turnstile) for in-VPC Lambdas |

This function exists because in-VPC Lambdas cannot reach AWS services or
the internet directly (no NAT Gateway). Instead, they invoke this function
via Lambda-to-Lambda, and it makes the external call on their behalf.

## Authentication (Cognito)

```
User/Admin
    │
    ├─▶ Passwordless email (OTP/magic link)
    │     └─▶ Custom auth triggers (Define → Create → Verify)
    │
    └─▶ Google OAuth
          └─▶ Hosted UI at auth.evolvesprouts.com

    │
    ▼
Cognito User Pool (evolvesprouts-user-pool)
    │
    ├─▶ Group: admin (full admin access)
    ├─▶ Group: manager (limited management access)
    └─▶ Group: instructor (instructor access)
```

| Resource | Value |
|---|---|
| User Pool | `evolvesprouts-user-pool` |
| Domain | `auth.evolvesprouts.com` |
| Identity provider | Google OAuth |
| Auth flows | Custom auth (passwordless), SRP, refresh token |
| Groups | `admin`, `manager`, `instructor` |

## Messaging (SNS + SQS)

Async processing for media leads, Eventbrite sync, and inbound invoice email
ingestion.

```
API Lambda
    │
    ├─▶ SNS: evolvesprouts-media-events
    │        └─▶ SQS: evolvesprouts-media-queue
    │                  └─▶ MediaRequestProcessor Lambda
    │                  └─▶ DLQ: evolvesprouts-media-dlq
    │
    └─▶ SNS: evolvesprouts-eventbrite-sync-events
             └─▶ SQS: evolvesprouts-eventbrite-sync-queue
                       └─▶ EventbriteSyncProcessor Lambda
                       └─▶ SQS DLQ: evolvesprouts-eventbrite-sync-dlq
                       └─▶ Lambda DLQ: evolvesprouts-eventbrite-sync-processor-lambda-dlq

SES inbound (inbound.evolvesprouts.com)
    │
    └─▶ S3: evolvesprouts-assets-*/inbound-email/raw/*
             └─▶ SNS: evolvesprouts-inbound-invoice-email-events
                      └─▶ SQS: evolvesprouts-inbound-invoice-email-queue
                                └─▶ InboundInvoiceEmailProcessor Lambda
                                └─▶ DLQ: evolvesprouts-inbound-invoice-email-dlq
```

| Topic | Queue | Processor | Events |
|---|---|---|---|
| `evolvesprouts-media-events` | `evolvesprouts-media-queue` | MediaRequestProcessor | `media_request.submitted` |
| `evolvesprouts-eventbrite-sync-events` | `evolvesprouts-eventbrite-sync-queue` | EventbriteSyncProcessor | `eventbrite.instance_sync_requested` |
| `evolvesprouts-inbound-invoice-email-events` | `evolvesprouts-inbound-invoice-email-queue` | InboundInvoiceEmailProcessor | SES receipt-rule S3 notifications for inbound invoice emails |

All queues use KMS encryption (`alias/evolvesprouts-sqs-encryption-key`).
Failed messages go to dead-letter queues with CloudWatch alarms.

## Asset downloads (media.evolvesprouts.com)

```
Cloudflare (media.evolvesprouts.com)
        │
        ▼
CloudFront distribution
        │
        ├─▶ Default: S3 (evolvesprouts-assets-*)
        │     └─▶ Signed URLs only (CloudFront key pair)
        │
        └─▶ v1/assets/share/*, v1/assets/email-download/*: API Gateway
              └─▶ AdminFunction (bearer-link resolver, 302 redirect)
                    └─▶ Share path: per-asset source-domain allowlist
```

| Resource | Purpose |
|---|---|
| S3 bucket | `evolvesprouts-assets-{account}-{region}` |
| CloudFront key group | Signs download URLs |
| Custom domain | `media.evolvesprouts.com` |

## Admin console (admin.evolvesprouts.com)

| Resource | Purpose |
|---|---|
| Stack | `evolvesprouts-admin-web` |
| Hosting | S3 + CloudFront |
| Framework | Next.js App Router |
| Deploy | Amplify Hosting (release jobs triggered in CI) |
| Domain | `admin.evolvesprouts.com` |

## VPC and networking

```
evolvesprouts-vpc (2 AZs, no NAT Gateway)
│
├─ Public subnets (2)
│    └─ Internet Gateway
│
└─ Private/isolated subnets (2)
     ├─ Lambda functions (evolvesprouts-lambda-sg)
     ├─ Migration Lambda (evolvesprouts-migration-sg)
     ├─ RDS Proxy (evolvesprouts-proxy-sg)
     ├─ Aurora cluster (evolvesprouts-db-sg)
     │
     └─ VPC Endpoints (no NAT needed):
          S3 (gateway), Secrets Manager, STS, CloudWatch Logs,
          SES, SNS, RDS, API Gateway, SQS, Lambda
```

### Security group rules

| Source | → Target | Port | Purpose |
|---|---|---|---|
| Lambda SG | → Proxy SG | 5432 | App Lambdas → RDS Proxy |
| Migration SG | → DB SG | 5432 | Migration Lambda → Aurora (direct) |
| Proxy SG | → DB SG | 5432 | RDS Proxy → Aurora |

Note: Cognito VPC endpoint is intentionally absent because Cognito
disables PrivateLink when ManagedLogin is configured. Cognito operations
are proxied through `AwsApiProxyFunction` instead.

## KMS encryption keys

| Alias | Purpose |
|---|---|
| `alias/evolvesprouts-lambda-env-encryption-key` | Lambda environment variables |
| `alias/evolvesprouts-lambda-log-encryption-key` | Lambda CloudWatch logs |
| `alias/evolvesprouts-sqs-encryption-key` | SQS queues |
| `alias/evolvesprouts-api-log-encryption-key` | API Gateway access logs |
| `alias/evolvesprouts-secrets-encryption-key` | Secrets Manager (API key rotation) |
| `alias/evolvesprouts-database-secret-key` | Database credentials (conditional) |

All keys have automatic annual rotation enabled.

## Deployment workflows

| Workflow | Trigger | Deploys |
|---|---|---|
| `deploy-backend.yml` | Push to main (backend/) | CDK stacks: `evolvesprouts`, `evolvesprouts-admin-web`, `evolvesprouts-public-www` |
| `deploy-admin-web.yml` | Push to main (admin_web/) | Admin web via Amplify |
| `deploy-public-www.yml` | Push to main (public_www/) | Public website → staging |
| `promote-public-www.yml` | Manual dispatch | Promote staging → production (or enable maintenance mode) |
| `cdk-bootstrap.yml` | Manual dispatch | CDK bootstrap for account/region |
| `deploy-ios.yml` | Manual dispatch | Flutter iOS via Fastlane |
| `deploy-mobile.yml` | Push to main (evolvesprouts_app/) | Flutter Android |

### Deployment pipeline for public website

```
Push to main (apps/public_www/)
        │
        ▼
deploy-public-www.yml
  ├─ Build (npm run build → static export)
  ├─ Upload to staging S3 bucket
  └─ Invalidate staging CloudFront

        │ (manual review on staging)
        ▼

promote-public-www.yml (manual trigger)
  ├─ Copy staging S3 → production S3
  └─ Invalidate production CloudFront
```

### CI/CD authentication

- GitHub OIDC → IAM `GitHubActionsRole` (no long-lived credentials)
- Permissions: `contents: read`, `id-token: write`

## Domains summary

| Domain | Service | CDK Parameter |
|---|---|---|
| `www.evolvesprouts.com` | Public website (production) | `PublicWwwDomainName` |
| `www-staging.evolvesprouts.com` | Public website (staging) | `PublicWwwStagingDomainName` |
| `api.evolvesprouts.com` | API Gateway | `ApiCustomDomainName` |
| `admin.evolvesprouts.com` | Admin console | `AdminWebDomainName` |
| `media.evolvesprouts.com` | Asset downloads | `AssetDownloadCustomDomainName` |
| `auth.evolvesprouts.com` | Cognito hosted UI | `CognitoCustomDomainName` |
| `evolvesprouts.com` | Email (iCloud Mail MX) | N/A (Cloudflare DNS) |
