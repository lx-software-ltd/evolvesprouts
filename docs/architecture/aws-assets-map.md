# AWS Assets Map - Backend Deploy

This document maps all AWS resources created by the `backend-deploy` workflow
(`.github/workflows/deploy-backend.yml`).

**Primary API Stack Name:** `evolvesprouts`  
**CDK App:** `backend/infrastructure/bin/app.ts`  
**Stack Definition:** `backend/infrastructure/lib/api-stack.ts`  
**Nested stacks (same CDK app):** `MessagingNestedStack` in `backend/infrastructure/lib/messaging-stack.ts` (media, expense parser, SES templates); `EventbriteSyncNestedStack` in `api-stack.ts`.

### GitHub Actions `GitHubActionsRole` (manual IAM)

The import workflow (`.github/workflows/import-legacy-crm.yml`) uses OIDC to assume `GitHubActionsRole` (see `docs/architecture/setup.md`). That role is **not** created by this CDK stack. If the role is narrowly scoped instead of administrator-like, attach least-privilege statements for the legacy import path:

- `s3:PutObject` and `s3:DeleteObject` on `arn:aws:s3:::evolvesprouts-import-dump-{account}-{region}/dumps/*` (objects live under `dumps/<entity>/<run_id>/`; delete is post-run cleanup).
- Optional: `s3:GetObject` and `s3:HeadObject` on specific object keys (or a chosen prefix) when using repository variable `IMPORT_LEGACY_CRM_SQL_OBJECT_KEY` to point at an existing dump object outside `dumps/*` (workflow checks existence with `HeadObject`; that object is not deleted after the run).
- `lambda:InvokeFunction` and `lambda:GetFunction` on `arn:aws:lambda:{region}:{account}:function:evolvesprouts-ImportLegacyVenuesFunction` (preflight uses `get-function`; it first checks explicit GitHub vars and then falls back to `evolvesprouts` stack outputs).

---

## Frontend static website stacks (S3 + CloudFront)

The same CDK app also defines static website stacks:

- `evolvesprouts-admin-web` (`backend/infrastructure/lib/admin-web-stack.ts`)
- `evolvesprouts-public-www` (`backend/infrastructure/lib/public-www-stack.ts`)
- `evolvesprouts-training` (`backend/infrastructure/lib/training-stack.ts`)

### Training website stack

| Stack Name | Domain Parameter | Certificate Parameter | Notes |
|-----------|------------------|-----------------------|-------|
| `evolvesprouts-training` | `TrainingDomainName` | `TrainingCertificateArn` | Production training site; `X-Robots-Tag: noindex, nofollow, noarchive` on all responses |

Stack outputs:

- `TrainingBucketName`
- `TrainingDistributionId`
- `TrainingDistributionDomain`
- `TrainingLoggingBucketName`

Training CloudFront mirrors public WWW `/www/*` API proxy behaviors (`TrainingApiBaseUrl`, `TrainingMediaRequestApiBaseUrl`) for upcoming poll integrations. Shared CloudFront Function sources live in `backend/infrastructure/lib/cloudfront-www-proxy-functions.ts` (see `docs/architecture/security.md`). S3 bucket prefixes: `evolvesprouts-training` and `evolvesprouts-training-logs` (each under 63 characters with account and region suffixes).

Deploy app artifacts with `scripts/deploy/deploy-training.sh` after `cd apps/training && npm run build`.

### Public WWW environments in one stack

| Stack Name | Environment | Domain Parameter | Certificate Parameter | Notes |
|-----------|-------------|------------------|-----------------------|-------|
| `evolvesprouts-public-www` | Production | `PublicWwwDomainName` | `PublicWwwCertificateArn` | Production website |
| `evolvesprouts-public-www` | Staging | `PublicWwwStagingDomainName` | `PublicWwwStagingCertificateArn` | Staging website with `X-Robots-Tag: noindex, nofollow, noarchive` |

The stack outputs:

- `PublicWwwBucketName`
- `PublicWwwDistributionId`
- `PublicWwwDistributionDomain`
- `PublicWwwLoggingBucketName`
- `PublicWwwStagingBucketName`
- `PublicWwwStagingDistributionId`
- `PublicWwwStagingDistributionDomain`
- `PublicWwwStagingLoggingBucketName`

Public WWW CloudFront includes:

- Default behavior: static site content from S3 with extensionless path rewrite.
- Additional behavior: `www/*` forwards to the host extracted from
  `PublicWwwApiBaseUrl` (for example `https://api.evolvesprouts.com/www`)
  using HTTPS-only origin policy, disabled caching, and
  `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER` so API key headers and
  query parameters pass through while preserving the API origin host header.
  - Viewer-request allowlist gates allowed public API method/path pairs
    (e.g. `/www/v1/reservations`).
- Additional behavior: `www/v1/assets/free/request` forwards to the execute-api
  host/path extracted from `PublicWwwMediaRequestApiBaseUrl` and rewrites
  `/www/v1/assets/free/request` to `/v1/assets/free/request` before origin fetch.
- Response headers policy for browser hardening:
  `Strict-Transport-Security`, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`,
  and `Permissions-Policy`.
  - Public WWW CSP is split by design:
    - CloudFront header CSP enforces `base-uri`, `object-src`, and
      `frame-ancestors` (no `unsafe-inline`).
    - Page-specific CSP is injected at build time into exported HTML
      (`apps/public_www/scripts/inject-csp-meta.mjs`) so each page can
      allow only its own hashed inline scripts.
    - `frame-ancestors` is intentionally omitted from the page-level CSP meta
      because browsers ignore it outside the response header.
- Staging distribution adds `X-Robots-Tag: noindex, nofollow, noarchive`.
- CloudFront Function updates within each environment are serialized in
  `public-www-stack.ts` via CDK `node.addDependency`
  (`PathRewriteFunction → WwwProxyAllowlistFunction → MediaRequestProxyFunction
  → WwwApiErrorResponseFunction`). Without this chain, CloudFormation issues
  parallel update calls for all four functions, which trips the regional
  CloudFront Functions API rate limit (`HandlerErrorCode:
  ServiceLimitExceeded`, "Reason: Rate exceeded") and rolls the stack back.
  Production and staging environments still update in parallel with each
  other; that 2-way concurrency stays under the throttle. The
  `Deploy Backend` workflow additionally calls
  `aws cloudformation continue-update-rollback` when it detects a wedged
  `UPDATE_ROLLBACK_FAILED` state before retrying.

### Admin Web CloudFront distribution

| Stack Name | Domain Parameter | Certificate Parameter | Notes |
|-----------|------------------|-----------------------|-------|
| `evolvesprouts-admin-web` | `AdminWebDomainName` | `AdminWebCertificateArn` | Admin UI (Next.js static export from `apps/admin_web`) |

The stack outputs:

- `AdminWebBucketName`
- `AdminWebDistributionId`
- `AdminWebDistributionDomain`
- `AdminWebLoggingBucketName`

Admin Web CloudFront includes:

- Default behavior: static site content from S3 with a viewer-request
  CloudFront Function (`AdminWebPathRewriteFunction`, `cloudfront-js-2.0`)
  that maps extensionless and trailing-slash paths to the matching
  `index.html` for the Next.js static export (`output: 'export'`,
  `trailingSlash: true`). This is required so direct navigation and
  refreshes on `/assets`, `/contacts`, `/finance`, `/sales`, `/services`,
  and `/auth/callback` resolve to the correct per-route HTML instead of
  falling back to the root shell.
  - `/` resolves via CloudFront `defaultRootObject` to `index.html`.
  - `/foo` → `/foo/index.html`; `/foo/` → `/foo/index.html`.
  - `/_next/*` and any path containing a `.` (static assets) are passed
    through untouched.
- `CustomErrorResponses` map 403 and 404 origin responses to `/404.html`
  with a `404` status code and a 1-minute TTL. This aligns admin web
  behavior with `public_www` and avoids the legacy "rewrite every miss to
  `/index.html` (200)" pattern, which would otherwise replay the root
  `page.tsx` redirect into `/finance` on every section refresh.

Deploys that change distribution behavior should include a CloudFront
invalidation (`/*`) so cached 403/404 rewrites produced before the
function was attached are flushed from all edge POPs.

---

## CDK Bootstrap Stack (CDKToolkit)

Created once per account/region when `cdk bootstrap` runs. Not part of the main stack but required for deployment.

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| S3 Bucket | `StagingBucket` | `cdk-*-assets-{account}-{region}` | Stores CDK assets (Lambda bundles, etc.) |
| ECR Repository | `StagingRepository` | `cdk-*-container-assets-{account}-{region}` | For container-based assets (unused in this stack) |
| KMS Key | `StagingKey` | Auto-generated | Encrypts assets in S3/ECR |
| IAM Role | `DeployActionRole` | Auto-generated | Role for CDK deployments |
| IAM Role | `FilePublishingRole` | Auto-generated | Role for publishing to S3 |
| IAM Role | `ImagePublishingRole` | Auto-generated | Role for publishing to ECR |
| IAM Role | `LookupRole` | Auto-generated | Role for cross-account lookups |
| SSM Parameter | `/cdk-bootstrap/{qualifier}/version` | `/cdk-bootstrap/*/version` | Tracks bootstrap version |

---

## Shared KMS Encryption Keys

Customer-managed KMS keys created in the `evolvesprouts` stack. Each key has
automatic annual rotation enabled and a human-readable alias.

| Resource Type | Logical ID | Alias | Purpose |
|--------------|------------|-------|---------|
| KMS Key | `SharedLambdaEnvEncryptionKey` | `alias/evolvesprouts-lambda-env-encryption-key` | Lambda environment variable encryption (shared across all functions) |
| KMS Key | `SharedLambdaLogEncryptionKey` | `alias/evolvesprouts-lambda-log-encryption-key` | Lambda CloudWatch log encryption (shared across all functions) |
| KMS Key | `SqsEncryptionKey` | `alias/evolvesprouts-sqs-encryption-key` | SQS queue encryption (media and expense parser queues in the messaging nested stack) |
| KMS Key | `ApiLogEncryptionKey` | `alias/evolvesprouts-api-log-encryption-key` | API Gateway CloudWatch access log encryption |
| KMS Key | `SecretsEncryptionKey` | `alias/evolvesprouts-secrets-encryption-key` | Secrets Manager encryption (API key rotation secret) |
| KMS Key | `PollResponsesEncryptionKey` | `alias/evolvesprouts-poll-responses-encryption-key` | DynamoDB `evolvesprouts-poll-responses` table encryption |

**Conditional key** (in `DatabaseConstruct`, created only when managing DB
credentials):

| Resource Type | Logical ID | Alias | Purpose |
|--------------|------------|-------|---------|
| KMS Key | `DatabaseSecretKey` | `alias/evolvesprouts-database-secret-key` | Database credentials secret encryption |

---

## Application S3 Buckets

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| S3 Bucket | `AssetsBucket` | `evolvesprouts-assets-{account}-{region}` | Private bucket for assets |
| S3 Bucket | `AssetsLogBucket` | `evolvesprouts-assets-logs-{account}-{region}` | Access logs for the assets bucket |
| S3 Bucket | `ImportDumpBucket` | `evolvesprouts-import-dump-{account}-{region}` | Ephemeral legacy-import SQL dumps (SSE-S3, 7-day expiration on current and noncurrent versions, abort incomplete multipart after 1 day); GitHub Actions uploads; `ImportLegacyVenuesFunction` reads |
| S3 Prefix | `AssetsBucket/inbound-email/raw/` | `s3://evolvesprouts-assets-{account}-{region}/inbound-email/raw/` | Reserved prefix for raw inbound invoice emails |

## Asset download CDN (CloudFront)

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| CloudFront Public Key | `AssetDownloadPublicKey` | Auto-generated | Trusted public key for signed asset URLs |
| CloudFront Key Group | `AssetDownloadKeyGroup` | Auto-generated | Trusted key group used by asset distribution |
| CloudFront Distribution | `ClientAssetsDownloadDistribution` | Auto-generated | Serves private S3 objects through signed URLs only (custom alias from `AssetDownloadCustomDomainName`), with optional WAF WebACL association via `AssetDownloadWafWebAclArn` |

Signed asset links are generated by `EvolvesproutsAdminFunction` using the
configured custom domain (`ASSET_DOWNLOAD_CLOUDFRONT_DOMAIN`), rather than the
default CloudFront hostname.

The asset distribution also routes `v1/assets/share/*` and
`v1/assets/email-download/*` to API Gateway, injects `x-api-key` at origin.
The share path enforces per-link Referer/Origin allowlists in
`EvolvesproutsAdminFunction`; the email-download path skips that check (same
token DB records; restricted assets still require JWT).
Default share-link allowlist values are injected into
`ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS` from
`PublicWwwDomainName,PublicWwwStagingDomainName` stack parameters.

---

## Network Infrastructure

### VPC and Subnets

**Created only if `EXISTING_VPC_ID` is not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| VPC | `EvolvesproutsVpc` | `evolvesprouts-vpc` | 2 AZs, no NAT Gateway |
| Internet Gateway | `EvolvesproutsVpcIGW*` | Auto-generated | Attached to VPC |
| Public Subnet | `EvolvesproutsVpcPublicSubnet*` | Auto-generated | 2 subnets (1 per AZ) |
| Private Subnet | `EvolvesproutsVpcPrivateSubnet*` | Auto-generated | 2 isolated subnets (1 per AZ) |
| Route Table | `EvolvesproutsVpcPublicSubnet*RouteTable*` | Auto-generated | Public route table |
| Route Table | `EvolvesproutsVpcPrivateSubnet*RouteTable*` | Auto-generated | Private route table |
| Route | `EvolvesproutsVpcPublicSubnet*DefaultRoute*` | Auto-generated | 0.0.0.0/0 → IGW |
| VPC Gateway Attachment | `EvolvesproutsVpcVPCGW*` | Auto-generated | IGW attachment |

---

## Security Groups

**Created only if corresponding `EXISTING_*_SECURITY_GROUP_ID` is not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| Security Group | `LambdaSecurityGroup` | `evolvesprouts-lambda-sg` | For Lambda functions (RETAIN policy) |
| Security Group | `MigrationSecurityGroup` | `evolvesprouts-migration-sg` | For migration Lambda (RETAIN policy) |
| Security Group | `DatabaseSecurityGroup` | `evolvesprouts-db-sg` | For Aurora cluster |
| Security Group | `ProxySecurityGroup` | `evolvesprouts-proxy-sg` | For RDS Proxy |

**Security Group Rules (managed automatically unless existing SGs are used):**

| Source SG | Target SG | Port | Description |
|-----------|-----------|------|-------------|
| `ProxySecurityGroup` | `DatabaseSecurityGroup` | 5432 | RDS Proxy → Aurora |
| `LambdaSecurityGroup` | `ProxySecurityGroup` | 5432 | Lambda → RDS Proxy |
| `MigrationSecurityGroup` | `DatabaseSecurityGroup` | 5432 | Migration Lambda → Aurora (direct) |

---

## VPC Endpoints

**Created only when a new VPC is created (not when `EXISTING_VPC_ID` is used).**

| Resource Type | Logical ID | Service | Notes |
|--------------|------------|---------|-------|
| Gateway Endpoint | `S3Endpoint` | S3 | Gateway endpoint (no cost) |
| Gateway Endpoint | `DynamoDbEndpoint` | DynamoDB | Gateway endpoint for in-VPC Lambdas (e.g. poll answer upserts to `evolvesprouts-poll-responses`) |
| Interface Endpoint | `SecretsManagerEndpoint` | Secrets Manager | For DB secret access |
| Interface Endpoint | `StsEndpoint` | STS | For IAM auth token generation |
| Interface Endpoint | `CloudWatchLogsEndpoint` | CloudWatch Logs | For Lambda logging |
| Interface Endpoint | `SesEndpoint` | SES API (`email`) | For boto3 `SendEmail` from in-VPC Lambdas (not SMTP) |
| Interface Endpoint | `SnsEndpoint` | SNS | For notifications |
| Interface Endpoint | `RdsEndpoint` | RDS | For IAM authentication tokens |
| Interface Endpoint | `ApiGatewayEndpoint` | API Gateway | For API key rotation |
| Interface Endpoint | `SqsEndpoint` | SQS | For booking and media queues |
| Interface Endpoint | `LambdaEndpoint` | Lambda | For invoking the AWS API proxy from in-VPC Lambdas |

**Note:** Cognito IDP VPC endpoint is **not** included because Cognito
disables PrivateLink when ManagedLogin is configured on the User Pool.
Cognito operations are proxied through `AwsApiProxyFunction` instead.

---

## Database Infrastructure

### Secrets Manager

**Created only if `EXISTING_DB_CREDENTIALS_SECRET_NAME` and `EXISTING_DB_CREDENTIALS_SECRET_ARN` are not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| Secret | `DBCredentialsSecret` | `evolvesprouts-database-credentials` | Auto-generates password for `postgres` user |

### KMS

**Created only if a new secret is created (not using existing).**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| KMS Key | `DatabaseSecretKey` | Auto-generated | Encrypts database secret (rotation enabled) |
| KMS Alias | `DatabaseSecretKeyAlias*` | `alias/evolvesprouts-database-secret-key` | Alias for the key |

### RDS Aurora PostgreSQL Serverless v2

**Created only if `EXISTING_DB_CLUSTER_IDENTIFIER` is not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| DB Subnet Group | `ClusterSubnets*` | Auto-generated | Private subnets for DB |
| DB Cluster | `Cluster*` | `evolvesprouts-db-cluster` | Aurora Serverless v2, PostgreSQL 16.4 |
| DB Instance | `Cluster*Instance*` | `evolvesprouts-db-writer` | Writer instance (serverless v2) |
| IAM Role | `DatabaseMonitoringRole` | Auto-generated | Enhanced monitoring role |
| DB Parameter Group | `ClusterParameterGroup*` | Auto-generated | PostgreSQL parameters |
| DB Cluster Parameter Group | `ClusterParameterGroup*` | Auto-generated | Cluster-level parameters |

**Cluster Configuration:**
- Engine: Aurora PostgreSQL 16.4
- Min Capacity: 0.5 ACU
- Max Capacity: 2 ACU
- Database Name: `evolvesprouts`
- IAM Authentication: Enabled (if `applyImmutableSettings=true`)
- Storage Encryption: Enabled (if `applyImmutableSettings=true`)
- CloudWatch Logs: `postgresql` export enabled
- Monitoring: Enhanced monitoring (60s interval)
- Automated Backups: 14-day retention (default), tags copied to snapshots
- Deletion Protection: Enabled when `CDK_DEPLOYMENT_STAGE=production`

### RDS Proxy

**Created only if `EXISTING_DB_PROXY_NAME` is not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| DB Proxy | `Proxy*` | `evolvesprouts-db-proxy` | IAM auth enabled, TLS required |
| DB Proxy Target Group | `ProxyTargetGroup*` | Auto-generated | Targets Aurora cluster |
| DB Proxy Target | `ProxyTarget*` | Auto-generated | Links proxy to cluster |

---

## Cognito Authentication

### User Pool

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| User Pool | `EvolvesproutsUserPool` | `evolvesprouts-user-pool` | Email sign-in, auto-verify enabled; custom attrs `last_auth_time`, legacy `feedback_stars`; `RETAIN` removal policy in production |
| User Pool Domain | `EvolvesproutsUserPoolDomain` | `{CognitoDomainPrefix}.auth.{region}.amazoncognito.com` | Domain prefix from parameter |
| User Pool Client | `EvolvesproutsUserPoolClient` | Auto-generated | OAuth client (no secret) |
| User Pool Group | `AdminGroup` | `admin` | Admin group |
| User Pool Group | `ManagerGroup` | `manager` | Manager group |

### Identity Providers

| Resource Type | Logical ID | Provider Name | Notes |
|--------------|------------|---------------|-------|
| User Pool Identity Provider | `GoogleIdentityProvider` | `Google` | Google OAuth |

**User Pool Client Configuration:**
- OAuth Flows: `code`
- OAuth Scopes: `openid`, `email`, `profile`
- Supported Providers: `Google`
- Explicit Auth Flows: `ALLOW_CUSTOM_AUTH`, `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`

---

## Lambda Functions

Each Lambda function created by `PythonLambda` construct includes:
- Lambda function
- IAM execution role
- KMS key for environment variable encryption
- SQS dead-letter queue

### Application Functions

| Function Logical ID | Handler | Memory | Timeout | VPC | Extra Paths |
|---------------------|---------|--------|---------|-----|-------------|
| `EvolvesproutsAdminFunction` | `lambda/admin/handler.lambda_handler` | 1024 MB | 30s | Yes | - |
| `EvolvesproutsMigrationFunction` | `lambda/migrations/handler.lambda_handler` | 512 MB | 5 min | Yes | `db` |
| `ImportLegacyVenuesFunction` | `lambda/imports/legacy_crm/handler.lambda_handler` | 512 MB | 10 min | Yes | - |
| `HealthCheckFunction` | `lambda/health/handler.lambda_handler` | 256 MB | 10s | Yes | - |

### Auth Functions

| Function Logical ID | Handler | Memory | Timeout | VPC | Notes |
|---------------------|---------|--------|---------|-----|-------|
| `AuthPreSignUpFunction` | `lambda/auth/pre_signup/handler.lambda_handler` | 256 MB | 10s | No | Cognito trigger |
| `AuthDefineChallengeFunction` | `lambda/auth/define_auth_challenge/handler.lambda_handler` | 256 MB | 10s | No | Cognito trigger |
| `AuthCreateChallengeFunction` | `lambda/auth/create_auth_challenge/handler.lambda_handler` | 256 MB | 10s | No | Cognito trigger, SES permissions |
| `AuthVerifyChallengeFunction` | `lambda/auth/verify_auth_challenge/handler.lambda_handler` | 256 MB | 10s | No | Cognito trigger |
| `AuthPostAuthFunction` | `lambda/auth/post_authentication/handler.lambda_handler` | 256 MB | 10s | No | Cognito post-auth trigger |

### Authorizer Functions

| Function Logical ID | Handler | Memory | Timeout | VPC | Notes |
|---------------------|---------|--------|---------|-----|-------|
| `DeviceAttestationAuthorizer` | `lambda/authorizers/device_attestation/handler.lambda_handler` | 256 MB | 5s | No | Device attestation authorizer |
| `AdminGroupAuthorizerFunction` | `lambda/authorizers/cognito_group/handler.lambda_handler` | 256 MB | 5s | No | Admin group authorizer |
| `UserAuthorizerFunction` | `lambda/authorizers/cognito_user/handler.lambda_handler` | 256 MB | 5s | No | Any-user authorizer |
| `ApiTokenAuthorizerFunction` | `lambda/authorizers/api_token/handler.lambda_handler` | 512 MB | 10s | Yes | Hashed `x-api-token` authorizer (RDS Proxy); no reserved concurrency |

### Other Functions

| Function Logical ID | Handler | Memory | Timeout | VPC | Notes |
|---------------------|---------|--------|---------|-----|-------|
| `AdminBootstrapFunction` | `lambda/admin_bootstrap/handler.lambda_handler` | 256 MB | 30s | No | Custom resource handler (Cognito only) |
| `AwsApiProxyFunction` | `lambda/aws_proxy/handler.lambda_handler` | 256 MB | 90s | No | AWS/HTTP proxy for in-VPC Lambdas |
| `ApiKeyRotationFunction` | `lambda/api_key_rotation/handler.lambda_handler` | 256 MB | 60s | Yes | Scheduled API key rotation |
| `MediaRequestProcessor` | `lambda/media_processor/handler.lambda_handler` | 512 MB | 30s | Yes | SQS-triggered media processor (nested stack `evolvesprouts-Messaging`) |
| `ExpenseParserFunction` | `lambda/expense_parser/handler.lambda_handler` | 512 MB | 90s | Yes | SQS-triggered expense invoice parser (nested stack `evolvesprouts-Messaging`) |
| `InboundInvoiceEmailProcessor` | `lambda/inbound_invoice_email/handler.lambda_handler` | 512 MB | 30s | Yes | SQS-triggered inbound invoice email processor |
| `EventbriteSyncProcessor` | `lambda/eventbrite_sync_processor/handler.lambda_handler` | 512 MB | 60s | Yes | SQS-triggered Eventbrite sync processor |

### Lambda Resources Per Function

For each function above, the following resources are created:

| Resource Type | Logical ID Pattern | Notes |
|--------------|-------------------|-------|
| Lambda Function | `{FunctionLogicalID}Function*` | Python 3.12 runtime |
| IAM Role | `{FunctionLogicalID}FunctionServiceRole*` | Execution role |
| IAM Policy | `{FunctionLogicalID}FunctionServiceRoleDefaultPolicy*` | Basic Lambda permissions |
| KMS Key | `{FunctionLogicalID}EnvironmentEncryptionKey*` | Encrypts environment variables (rotation enabled) |
| KMS Alias | `{FunctionLogicalID}EnvironmentEncryptionKeyAlias*` | Alias for the key |
| SQS Queue | `{FunctionLogicalID}DeadLetterQueue*` | DLQ for failed invocations (14-day retention) |
| SQS Queue Policy | `{FunctionLogicalID}DeadLetterQueuePolicy*` | Allows Lambda to send to DLQ |

**Lambda Configuration:**
- Runtime: Python 3.12
- Reserved Concurrency: 25 (default)
- Environment: `PYTHONPATH=/var/task/src`, `LOG_LEVEL=INFO`
- VPC Subnets: Private with egress (if VPC enabled)
- Dead Letter Queue: Enabled

**Additional IAM Permissions:**

| Function | Additional Permissions |
|----------|------------------------|
| `EvolvesproutsAdminFunction` | Read DB secret, connect to RDS Proxy as `evolvesprouts_admin`, read/write DynamoDB table `evolvesprouts-poll-responses` (`POLL_RESPONSES_TABLE_NAME`) for training poll answer upserts, invoke `AwsApiProxyFunction`, SNS publish to media, expense parser, and Eventbrite sync topics, SES send email + **SendTemplatedEmail** (internal + `AuthEmailFromAddress` identities), Secrets Manager read for Mailchimp secret (public form marketing hooks) and the new `PublicWwwConfigSecret` JSON object, S3 read/write for the assets bucket; `DEPLOYMENT_STAGE` set to `production` in deployed stacks; `PUBLIC_WWW_CONFIG_SECRET_ARN` env var points at `PublicWwwConfigSecret` whose JSON object holds `BASE_URL` / `STAGING_SITE_ORIGIN` / optional `INSTAGRAM_URL` / `LINKEDIN_URL` / `WHATSAPP_URL` / `BUSINESS_PHONE_NUMBER` for transactional HTML shell data, plus optional `BUSINESS_NAME` / `BUSINESS_LEGAL_NAME` / `BUSINESS_ADDRESS` / `BUSINESS_REGISTRATION` / `BANK_*` / `FPS_MERCHANT_NAME` / `FPS_MOBILE_NUMBER` / `BILLING_EMAIL` for AR invoice PDFs (sourced from CDK `PublicWww*` parameters / GitHub `vars.NEXT_PUBLIC_*`); `INVOICE_DISPLAY_TIMEZONE` / `INVOICE_PAYMENT_TERMS_DAYS` remain plain env vars; `SALES_RECAP_DISPLAY_TIMEZONE` from CDK parameter `SalesRecapDisplayTimezone` (optional; recap **Submitted at**; app default if empty); `DEFAULT_PHONE_REGION` from CDK parameter `DefaultPhoneRegion` (ISO alpha-2) for parsing public phone fields when region is omitted. The `PUBLIC_WWW_*` values are packed into a single secret to keep the Lambda environment-variable string under AWS's 4 KB hard limit; `app.config.public_www` reads it once per cold start through the existing Secrets Manager VPC interface endpoint and caches it in-process for five minutes |
| `AwsApiProxyFunction` | Cognito admin operations (`ListUsers`, `ListUsersInGroup`, `AdminGetUser`, `AdminDeleteUser`, `AdminAddUserToGroup`, `AdminRemoveUserFromGroup`, `AdminListGroupsForUser`, `AdminUserGlobalSignOut`, `AdminUpdateUserAttributes`) |
| `EvolvesproutsMigrationFunction` | Read DB secret, direct connect to Aurora as `postgres`, Cognito user management, CloudFormation invoke permission |
| `ImportLegacyVenuesFunction` | Read admin DB secret, connect to RDS Proxy as `evolvesprouts_admin`, S3 read on `ImportDumpBucket` only |
| `HealthCheckFunction` | Read DB secret, connect to RDS Proxy as `evolvesprouts_app` |
| `ApiTokenAuthorizerFunction` | Read admin DB secret, connect to RDS Proxy as `evolvesprouts_admin` |
| `AuthCreateChallengeFunction` | SES `SendEmail`, `SendRawEmail` for the configured email address |
| `AuthPostAuthFunction` | Cognito `AdminUpdateUserAttributes` scoped to the user pool ARN (attached as a standalone policy to avoid a CloudFormation cycle with the trigger registration) |
| `AdminBootstrapFunction` | Cognito `AdminCreateUser`, `AdminUpdateUserAttributes`, `AdminSetUserPassword`, `AdminAddUserToGroup`, CloudFormation invoke permission |
| `ApiKeyRotationFunction` | API Gateway key management, Secrets Manager read/write |
| `MediaRequestProcessor` | Read DB secret, connect to RDS Proxy as `evolvesprouts_admin`, SES send email + **SendTemplatedEmail** (internal + `AuthEmailFromAddress` identities), read Mailchimp secret and `PublicWwwConfigSecret` (KMS decrypt with the shared Secrets Manager CMK), invoke `AwsApiProxyFunction`; `ASSET_SHARE_LINK_BASE_URL`, `ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS`, `MAILCHIMP_MEDIA_DOWNLOAD_MERGE_TAG` for Mailchimp download URL merge field; optional `MAILCHIMP_FREE_RESOURCE_JOURNEY_ID` / `MAILCHIMP_FREE_RESOURCE_JOURNEY_STEP_ID` for free-resource Customer Journey trigger; `MAILCHIMP_REQUIRE_MARKETING_CONSENT` + welcome journey env vars (see `aws-messaging.md`); `PUBLIC_WWW_CONFIG_SECRET_ARN` is shared with the admin Lambda and supplies `BASE_URL` and optional social URLs / `BUSINESS_PHONE_NUMBER` for the media download email shell; `SALES_RECAP_DISPLAY_TIMEZONE` from `SalesRecapDisplayTimezone` (optional; app default if empty) |
| `SesTemplateManagerFunction` | SES template CRUD (`CreateTemplate`, `UpdateTemplate`, `DeleteTemplate`, `GetTemplate`) for CloudFormation custom resource `SesEmailTemplates` (nested stack `evolvesprouts-Messaging`) |
| `ExpenseParserFunction` | Read DB secret, connect to RDS Proxy as `evolvesprouts_admin`, S3 read for the assets bucket, read OpenRouter API secret (Secrets Manager + KMS decrypt on the `secrets-encryption-key` CMK), invoke `AwsApiProxyFunction` |
| `InboundInvoiceEmailProcessor` | Read DB secret, connect to RDS Proxy as `evolvesprouts_admin`, S3 read/write for the assets bucket (including the `inbound-email/raw/` prefix), publish to the expense parser SNS topic |
| `EventbriteSyncProcessor` | Read DB secret, connect to RDS Proxy as `evolvesprouts_admin`, read Eventbrite token secret, invoke `AwsApiProxyFunction` |
| `InboxImportFunction` | Read DB secret, connect to RDS Proxy as `evolvesprouts_admin`, S3 read on the assets bucket, invoke `AwsApiProxyFunction` for Graph HTTP; Graph token is `META_PAGE_ACCESS_TOKEN` from `WhatsappWebhookVerifyToken` |

**Lambda Log Groups:**
- Explicitly created by CDK with KMS encryption
- Naming: `/aws/lambda/{function-name}` (e.g., `/aws/lambda/evolvesprouts-EvolvesproutsAdminFunction`)
- 90-day retention policy

---

## API Gateway

### REST API

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| REST API | `EvolvesproutsApi` | `evolvesprouts-api` | Regional REST API |
| Deployment | `EvolvesproutsApiDeployment*` | Auto-generated | Deployment for `prod` stage |
| Stage | `EvolvesproutsApiDeploymentStageprod*` | `prod` | Production stage |

**Stage Configuration:**
- Access Logging: Enabled (custom resource creates/configures `evolvesprouts-api-access-logs`)
- Access Log Format: JSON with standard fields
- Logging Level: INFO
- Data Trace: Disabled
- X-Ray Tracing: Enabled
- Caching: Disabled (edge caching on `public_www` CloudFront for `/www/*` GETs)

**CORS Configuration:**
- Allowed Origins: From `CORS_ALLOWED_ORIGINS` env var or CDK context (`corsAllowedOrigins`), always merged with required origins derived from `PublicWwwDomainName`, `PublicWwwStagingDomainName`, and `AdminWebDomainName`
- Default Origins (when no env/context is set): only the required domain-derived origins above
- `EvolvesproutsAdminFunction` receives the resolved CORS list through its `CORS_ALLOWED_ORIGINS` environment variable so Lambda responses and API Gateway preflight behavior stay consistent.
- Allowed Methods: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`

### API Gateway Resources and Methods

All admin API Gateway routes are defined inline in the parent `ApiStack`.

For the complete list of endpoints with request/response schemas, see
the OpenAPI specs: [`docs/api/public.yaml`](../api/public.yaml)
and [`docs/api/admin.yaml`](../api/admin.yaml).

| Resource Path | Method | Authorization | Integration | Notes |
|--------------|--------|---------------|-------------|-------|
| `/health` | GET | IAM | `HealthCheckFunction` | Health check |
| `/v1/assets/free/request` | POST | None + API key | `EvolvesproutsAdminFunction` | Publishes `media_request.submitted` to SNS |
| `/v1/calendar/public` | GET | None + API key | `EvolvesproutsAdminFunction` | Public calendar: published `event` and `training_course` instances (active sessions or **event** rows finished within ~90 days) |
| `/v1/calendar/availability` | GET | None + API key | `EvolvesproutsAdminFunction` | Requires `purpose` (`consultation_booking` or `intro_call_booking`); returns slots + meta; consultation uses `Cache-Control: no-store` on 200 |
| `/v1/assets/free` | GET | None + API key | `EvolvesproutsAdminFunction` | Lists public `client_document`-tagged assets; optional `language` query |
| `/v1/polls/{poll_slug}/answers` | PUT | None + API key | `EvolvesproutsAdminFunction` | Upserts one training poll answer to DynamoDB `evolvesprouts-poll-responses` |
| `/v1/polls/{poll_slug}/questions/{question_id}/results` | GET | None + API key | `EvolvesproutsAdminFunction` | Live aggregate counts for one poll question (`select` / `truefalse`) |
| `/v1/admin/geographic-areas` | GET | Admin Group | `EvolvesproutsAdminFunction` | Geographic area lookup for address selection |
| `/v1/admin/locations` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | |
| `/v1/admin/locations/{id}` | GET, PUT, PATCH, DELETE | Admin Group | `EvolvesproutsAdminFunction` | |
| `/v1/admin/users` | GET | Admin Group | `EvolvesproutsAdminFunction` | Assignee lookup for sales lead workflows |
| `/v1/admin/instructors` | GET | Admin Group | `EvolvesproutsAdminFunction` | Instructor Cognito group listing for service instance assignment |
| `/v1/admin/audit-logs` | GET | Admin Group | `EvolvesproutsAdminFunction` | Paginated `audit_log` listing (filters: `table`, `record_id`, `user_id`, `email`, `action`, `since`, `cursor`, `limit`); `email` resolves to a Cognito sub via proxy `list_users`, a known system actor (`system`, `webhook:whatsapp`, `webhook:meta`, `alembic`), or `api-key:<id>` via `api_keys.name`; optional `user_email` is a Cognito email, API key name, or system-actor label |
| `/v1/admin/audit-logs/{id}` | GET | Admin Group | `EvolvesproutsAdminFunction` | Single `audit_log` row by UUID |
| `/v1/admin/tags` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | CRM tag catalog; GET supports `include_archived` and `archived_only` (mutually exclusive) |
| `/v1/admin/calendar/manual-blocks` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | Manual blocks; GET requires `purpose`, `from`, `to`; writes append `audit_log` rows |
| `/v1/admin/calendar/manual-blocks/{id}` | GET, PATCH, DELETE | Admin Group | `EvolvesproutsAdminFunction` | Manual block read/update/delete; PATCH/DELETE append `audit_log` rows |
| `/v1/admin/tags/{id}` | GET, PATCH, DELETE | Admin Group | `EvolvesproutsAdminFunction` | Tag detail/update; DELETE returns JSON with `deleted` and `usage_count` |
| `/v1/admin/leads` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | Lead list/create |
| `/v1/admin/leads/analytics` | GET | Admin Group | `EvolvesproutsAdminFunction` | Funnel analytics and KPI summary |
| `/v1/admin/leads/export` | GET | Admin Group | `EvolvesproutsAdminFunction` | CSV lead export |
| `/v1/admin/leads/{id}` | GET, PATCH | Admin Group | `EvolvesproutsAdminFunction` | Lead detail/stage+assignee updates |
| `/v1/admin/leads/{id}/notes` | POST | Admin Group | `EvolvesproutsAdminFunction` | Immutable note append |
| `/v1/whatsapp/webhook` | GET, POST | None (HMAC + verify token) | `EvolvesproutsAdminFunction` | Meta WhatsApp Cloud API webhook; inbound + coexistence echoes |
| `/v1/meta/webhook` | GET, POST | None (HMAC + verify token) | `EvolvesproutsAdminFunction` | Messenger and Instagram webhook; inbound + `is_echo` |
| `/v1/admin/whatsapp/conversations` | GET | Admin Group | `EvolvesproutsAdminFunction` | Paginated captured WhatsApp threads |
| `/v1/admin/whatsapp/conversations/{id}/messages` | GET | Admin Group | `EvolvesproutsAdminFunction` | Messages for one thread |
| `/v1/admin/whatsapp/import-jobs` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | Queue/list WhatsApp export import jobs |
| `/v1/admin/whatsapp/import-jobs/{id}` | GET | Admin Group | `EvolvesproutsAdminFunction` | WhatsApp export import job detail |
| `/v1/admin/meta/conversations` | GET | Admin Group | `EvolvesproutsAdminFunction` | Paginated captured Messenger/Instagram threads |
| `/v1/admin/meta/conversations/{id}/messages` | GET | Admin Group | `EvolvesproutsAdminFunction` | Messages for one Meta thread |
| `/v1/admin/meta/import-jobs` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | Queue/list Instagram/Messenger Graph import jobs |
| `/v1/admin/meta/import-jobs/{id}` | GET | Admin Group | `EvolvesproutsAdminFunction` | Meta Graph import job detail |
| `/v1/public/meta/conversations` | GET | API token (`x-api-token`) | `EvolvesproutsAdminFunction` | Token reads; name/dates only |
| `/v1/public/meta/conversations/{id}/messages` | GET | API token (`x-api-token`) | `EvolvesproutsAdminFunction` | Token message reads without scoped ids |
| `/v1/public/contacts` | GET, POST | API token (`x-api-token`) | `EvolvesproutsAdminFunction` | Token contact list/create; `user` GET only |
| `/v1/public/contacts/{id}` | GET, PATCH, DELETE | API token (`x-api-token`) | `EvolvesproutsAdminFunction` | Token contact get/update/delete; `user` GET only |
| `/v1/admin/assets` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | |
| `/v1/admin/assets/{id}` | GET, PUT, PATCH, DELETE | Admin Group | `EvolvesproutsAdminFunction` | |
| `/v1/admin/assets/{id}/grants` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | |
| `/v1/admin/assets/{id}/grants/{grantId}` | DELETE | Admin Group | `EvolvesproutsAdminFunction` | |
| `/v1/admin/assets/{id}/share-link` | GET, POST, DELETE | Admin Group | `EvolvesproutsAdminFunction` | Stable bearer link read/create/revoke |
| `/v1/admin/assets/{id}/share-link/rotate` | POST | Admin Group | `EvolvesproutsAdminFunction` | Rotate bearer token and invalidate prior link |
| `/v1/admin/expenses` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | Expense list/create |
| `/v1/admin/expenses/{id}` | GET, PATCH | Admin Group | `EvolvesproutsAdminFunction` | Expense detail/update |
| `/v1/admin/expenses/{id}/cancel` | POST | Admin Group | `EvolvesproutsAdminFunction` | Void expense |
| `/v1/admin/expenses/{id}/mark-paid` | POST | Admin Group | `EvolvesproutsAdminFunction` | Mark expense paid |
| `/v1/admin/expenses/{id}/reparse` | POST | Admin Group | `EvolvesproutsAdminFunction` | Requeue parse |
| `/v1/admin/expenses/{id}/amend` | POST | Admin Group | `EvolvesproutsAdminFunction` | Create amendment |
| `/v1/admin/billing/export` | GET | Admin Group | `EvolvesproutsAdminFunction` | Customer AR CSV export (`exportVersion=2` default: payments, refunds, invoices, lines, receipts, allocations; `exportVersion=1` legacy) |
| `/v1/admin/billing/payments` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | List payments; record refund |
| `/v1/admin/billing/payments/{id}` | GET | Admin Group | `EvolvesproutsAdminFunction` | Payment detail + unapplied |
| `/v1/admin/billing/payments/{id}/unapplied` | GET | Admin Group | `EvolvesproutsAdminFunction` | Unapplied amount |
| `/v1/admin/billing/payments/{id}/confirm` | POST | Admin Group | `EvolvesproutsAdminFunction` | Confirm pending payment |
| `/v1/admin/billing/invoices` | GET, POST | Admin Group | `EvolvesproutsAdminFunction` | List invoices (cursor) or create draft |
| `/v1/admin/billing/invoices/{id}` | GET | Admin Group | `EvolvesproutsAdminFunction` | Get invoice with lines |
| `/v1/admin/billing/invoices/{id}/issue` | POST | Admin Group | `EvolvesproutsAdminFunction` | Issue invoice |
| `/v1/admin/billing/invoices/{id}/void` | POST | Admin Group | `EvolvesproutsAdminFunction` | Void invoice |
| `/v1/admin/billing/invoices/{id}/email` | POST | Admin Group | `EvolvesproutsAdminFunction` | Email invoice PDF |
| `/v1/admin/billing/allocations` | POST | Admin Group | `EvolvesproutsAdminFunction` | Allocate payment to invoice |
| `/v1/user/assets` | GET | User Auth | `EvolvesproutsAdminFunction` | |
| `/v1/user/assets/{id}/download` | GET | User Auth | `EvolvesproutsAdminFunction` | |
| `/v1/assets/public` | GET | Device Attestation + API Key | `EvolvesproutsAdminFunction` | |
| `/v1/assets/public/{id}/download` | GET | Device Attestation + API Key | `EvolvesproutsAdminFunction` | |
| `/v1/assets/share/{token}` | GET | API Key (CloudFront origin header) | `EvolvesproutsAdminFunction` | Bearer-link resolver (302 redirect) with per-asset source-domain allowlist; restricted assets also require JWT |
| `/v1/assets/email-download/{token}` | GET | API Key (CloudFront origin header) | `EvolvesproutsAdminFunction` | Email-oriented bearer resolver (302 redirect); no Referer/Origin allowlist; restricted assets still require JWT |

### API Gateway Gateway Responses

CORS headers are added to API Gateway error responses so the browser can
read error status codes instead of silently blocking them.
Gateway responses set CORS headers only via `responseParameters` (static
values). API Gateway gateway-response body templates do not run full VTL,
so we do not attach a payload mapping template there (a prior template would
have leaked Velocity directives into JSON error bodies).
`Access-Control-Allow-Origin` on these errors uses the first resolved
allowlisted origin (required defaults plus `CORS_ALLOWED_ORIGINS` / context),
not per-request `Origin` echoing.

| Response Type | Headers Added |
|--------------|---------------|
| `DEFAULT_4XX` | `Access-Control-Allow-Origin`, `Access-Control-Allow-Headers`, `Access-Control-Allow-Methods`, `Vary` |
| `DEFAULT_5XX` | `Access-Control-Allow-Origin`, `Access-Control-Allow-Headers`, `Access-Control-Allow-Methods`, `Vary` |

### API Gateway Authorizers

| Resource Type | Logical ID | Type | Handler | Notes |
|--------------|------------|------|---------|-------|
| Request Authorizer | `DeviceAttestationRequestAuthorizer` | Lambda | `DeviceAttestationAuthorizer` | Validates `x-device-attestation` header, no caching |
| Request Authorizer | `AdminGroupAuthorizer` | Lambda | `AdminGroupAuthorizerFunction` | JWT + staff group check (`admin` / `manager` / `instructor`), 5-min cache |
| Request Authorizer | `UserAuthorizer` | Lambda | `UserAuthorizerFunction` | JWT validation (any user), 5-min cache |
| Request Authorizer | `ApiTokenAuthorizer` | Lambda | `ApiTokenAuthorizerFunction` | Validates `x-api-token` against hashed `api_keys`, 5-min cache |

### API Gateway API Key and Usage Plan

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| API Key | `PublicWwwApiKey` | Auto-generated | Value from `PublicApiKeyValue` parameter |
| Usage Plan | `PublicWwwUsagePlan` | `evolvesprouts-public-www-plan` | Linked to API key and `prod` stage; throttled (50 rps, 100 burst) with 250k/day quota |

### API Gateway IAM Roles

| Resource Type | Logical ID | Purpose | Notes |
|--------------|------------|---------|-------|
| IAM Role | `ApiGatewayLogRole` | CloudWatch Logs | Allows API Gateway to write access logs |

### API Gateway Account Settings

| Resource Type | Logical ID | Notes |
|--------------|------------|-------|
| Account | `ApiGatewayAccount` | Configures CloudWatch role for API Gateway |

**Note:** The access log group `evolvesprouts-api-access-logs` is created and
configured by stack custom resources (including retention and KMS association).

---

## Custom Resources

### Database Migrations

| Resource Type | Logical ID | Handler | Notes |
|--------------|------------|---------|-------|
| Custom Resource | `RunMigrations` | `EvolvesproutsMigrationFunction` | Runs Alembic migrations on stack create/update (triggered by migration hash change) |

**Properties:**
- `MigrationsHash`: SHA256 hash of `backend/db/alembic/versions/` directory
- `SeedHash`: SHA256 hash of `backend/db/seed/seed_data.sql`
- `RunSeed`: value of `RunSeedData` parameter (default `false`)

### Admin Bootstrap

**Created only if `AdminBootstrapEmail` and `AdminBootstrapTempPassword` parameters are provided.**

| Resource Type | Logical ID | Handler | Notes |
|--------------|------------|---------|-------|
| Custom Resource | `AdminBootstrapResource` | `AdminBootstrapFunction` | Creates admin user in Cognito |
| `SesEmailTemplates` | `SesTemplateManagerFunction` | Upserts SES stored templates for public transactional email and issued-invoice mail (nested stack `evolvesprouts-Messaging`) |

**Properties:**
- `UserPoolId`: Cognito User Pool ID
- `Email`: Admin email address
- `TempPassword`: Temporary password
- `GroupName`: `admin`

---

## CloudFormation Parameters

| Parameter Name | Type | Required | NoEcho | Description |
|----------------|------|----------|---------|-------------|
| `CognitoDomainPrefix` | String | Yes | No | Hosted UI domain prefix |
| `CognitoCustomDomainName` | String | No | No | Optional Cognito custom auth domain |
| `CognitoCustomDomainCertificateArn` | String | No | No | ACM ARN for Cognito custom domain |
| `CognitoCallbackUrls` | CommaDelimitedList | Yes | No | OAuth callback URLs |
| `CognitoLogoutUrls` | CommaDelimitedList | Yes | No | OAuth logout URLs |
| `GoogleClientId` | String | Yes | No | Google OAuth client ID |
| `GoogleClientSecret` | String | Yes | Yes | Google OAuth client secret |
| `AuthEmailFromAddress` | String | Yes | No | SES-verified email for passwordless auth |
| `LoginLinkBaseUrl` | String | No | No | Base URL for magic links (default: empty) |
| `MaxChallengeAttempts` | Number | No | No | Max passwordless auth attempts (default: 3) |
| `PublicApiKeyValue` | String | Yes | Yes | API key for public www (min 20 chars) |
| `DeviceAttestationJwksUrl` | String | No | No | JWKS URL for device attestation (default: empty) |
| `DeviceAttestationIssuer` | String | No | No | Expected issuer (default: empty) |
| `DeviceAttestationAudience` | String | No | No | Expected audience (default: empty) |
| `DeviceAttestationFailClosed` | String | No | No | Fail-closed mode (default: `true`, allowed: `true`/`false`) |
| `ActiveCountryCodes` | String | No | No | Comma-separated country codes (default: `HK`) |
| `RunSeedData` | String | No | No | Run seed data after migrations (default: `false`) |
| `SupportEmail` | String | No | No | Inbox for full **contact_inquiry** contact-us notifications (`SUPPORT_EMAIL` on admin API Lambda only) |
| `SesSenderEmail` | String | No | No | SES-verified sender email for notifications |
| `InboundEmailDomainName` | String | Yes | No | SES-verified inbound email subdomain for invoice ingestion |
| `InboundInvoiceRecipientLocalPart` | String | No | No | Local-part for the SES-managed invoice mailbox (default: `invoices`) |
| `InboundInvoiceAllowedSenderPatterns` | String | No | No | Comma-separated sender substrings; empty disables allowlisting (GitHub var `CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS`) |
| `TurnstileSecretKey` | String | No | Yes | Cloudflare Turnstile secret key |
| `MailchimpApiSecretArn` | String | Yes | Yes | Existing Secrets Manager ARN for Mailchimp API key |
| `MailchimpListId` | String | Yes | No | Mailchimp audience/list ID |
| `MailchimpServerPrefix` | String | Yes | No | Mailchimp server prefix (for example `us21`) |
| `EventbriteTokenSecretArn` | String | No | Yes | Optional Secrets Manager ARN containing Eventbrite API token JSON (`{"token":"..."}`) |
| `EventbriteOrganizationId` | String | No | No | Optional Eventbrite organization ID for DB-to-Eventbrite sync |
| `EventbriteApiBaseUrl` | String | No | No | Eventbrite API base URL (default: `https://www.eventbriteapi.com/v3`) |
| `MediaDefaultResourceKey` | String | Yes | No | Default media resource key used when request payload omits `resource_key` |
| `MailchimpMediaDownloadMergeTag` | String | No | No | Mailchimp audience merge field tag for media download URL (`/v1/assets/email-download/{token}`; empty default; set e.g. `MMDLURL` after creating the field) |
| `MailchimpFreeResourceJourneyId` | String | No | No | Mailchimp Customer Journey ID for free-resource journey trigger API (empty disables) |
| `MailchimpFreeResourceJourneyStepId` | String | No | No | Journey step ID paired with `MailchimpFreeResourceJourneyId` (empty disables) |
| `MailchimpWelcomeJourneyId` | String | No | No | Shared welcome journey ID for opted-in public form contacts (empty disables) |
| `MailchimpWelcomeJourneyStepId` | String | No | No | Welcome journey entry step ID paired with `MailchimpWelcomeJourneyId` (empty disables) |
| `MailchimpRequireMarketingConsent` | String | No | No | When `true`, media processor gates legacy Mailchimp subscribe + free-resource journey on `marketing_opt_in` (default: `false`) |
| `ApiCustomDomainName` | String | No | No | Custom domain for the API (default: empty) |
| `ApiCustomDomainCertificateArn` | String | No | No | ACM certificate ARN for API custom domain |
| `NominatimUserAgent` | String | No | No | User-Agent for Nominatim geocoding requests |
| `NominatimReferer` | String | No | No | Referer header for Nominatim requests |
| `AdminBootstrapEmail` | String | No | No | Admin email for bootstrap (default: empty) |
| `AdminBootstrapTempPassword` | String | No | Yes | Temporary password for bootstrap (default: empty) |
| `AssetDownloadCloudFrontPublicKeyPem` | String | Yes | No | PEM-encoded RSA public key for signed asset URLs |
| `AssetDownloadCloudFrontPrivateKeySecretArn` | String | Yes | Yes | Secrets Manager ARN containing CloudFront private key PEM |
| `AssetDownloadCustomDomainName` | String | Yes | No | Custom domain used in signed asset download links (for example `media.example.com`) |
| `AssetDownloadCustomDomainCertificateArn` | String | Yes | No | ACM certificate ARN for the asset custom domain (must be in `us-east-1`) |
| `AssetDownloadWafWebAclArn` | String | No | No | Optional WAF WebACL ARN for the asset download CloudFront distribution (must be in `us-east-1`) |
| `OpenRouterApiKey` | String | Yes | Yes | OpenRouter API key value passed at deploy time and stored in Secrets Manager by CDK |
| `OpenRouterChatCompletionsUrl` | String | Yes | No | OpenRouter chat completions URL used for invoice parsing |
| `OpenRouterModel` | String | Yes | No | OpenRouter model identifier for invoice parsing |
| `OpenRouterMaxFileBytes` | String | No | No | Maximum attachment size (bytes) sent to OpenRouter parser (default: 15728640) |
| `PublicWwwBusinessLegalName` | String | No | No | Legal entity name for AR invoice PDF footer (GitHub var `NEXT_PUBLIC_BUSINESS_LEGAL_NAME`) |
| `InvoiceDisplayTimezone` | String | No | No | IANA timezone for persisted AR invoice dates (`INVOICE_DISPLAY_TIMEZONE`; GitHub var `CDK_PARAM_INVOICE_DISPLAY_TIMEZONE`) |
| `PublicWwwBusinessName` | String | No | No | Trading name on AR invoice **From** block (GitHub var `NEXT_PUBLIC_BUSINESS_NAME`) |
| `PublicWwwBillingEmail` | String | No | No | Billing email for AR invoice payment confirmation copy (GitHub var `NEXT_PUBLIC_BILLING_EMAIL`; Lambda `PUBLIC_WWW_BILLING_EMAIL`) |
| `PublicWwwBusinessAddress` | String | No | No | Issuer address lines; newline or literal `\n` separated (GitHub var `NEXT_PUBLIC_BUSINESS_ADDRESS`) |
| `PublicWwwBusinessRegistration` | String | No | No | BR / registration fragment for invoice PDF footer (GitHub var `NEXT_PUBLIC_BUSINESS_REGISTRATION`) |
| `PublicWwwBankName` | String | No | No | Bank label on AR invoice PDFs (GitHub var `NEXT_PUBLIC_BANK_NAME`) |
| `PublicWwwBankAccountHolder` | String | No | No | Account name on AR invoice PDFs (GitHub var `NEXT_PUBLIC_BANK_ACCOUNT_HOLDER`) |
| `PublicWwwBankAccountNumber` | String | No | No | Account number on AR invoice PDFs (GitHub var `NEXT_PUBLIC_BANK_ACCOUNT_NUMBER`) |
| `PublicWwwFpsMerchantName` | String | No | No | FPS merchant display name for HKD invoice QR payloads (GitHub var `NEXT_PUBLIC_FPS_MERCHANT_NAME`) |
| `PublicWwwFpsMobileNumber` | String | No | No | FPS mobile for invoice QR (GitHub var `NEXT_PUBLIC_FPS_MOBILE_NUMBER`) |
| `InvoicePaymentTermsDays` | String | No | No | Days after invoice date for PDF due date (`^[0-9]{1,3}$`; GitHub var `CDK_PARAM_INVOICE_PAYMENT_TERMS_DAYS`; default `7`) |

### Bundled Python invoice artwork (admin Lambda package)

These raster files ship with `EvolvesproutsAdminFunction` under `backend/src/app/assets/invoice/` and are read at PDF render time (not S3-hosted):

| Path | Purpose |
|------|---------|
| `evolvesprouts-invoice-logo.png` | Issuer wordmark in the invoice header |
| `fps-logo.png` | FPS brand mark beside the optional FPS QR payment block |

---

## CloudFormation Outputs

| Output Name | Value | Description |
|-------------|-------|-------------|
| `ApiUrl` | API Gateway REST API URL | Base URL for API endpoints |
| `DatabaseSecretArn` | Secrets Manager secret ARN | ARN of database credentials secret |
| `DatabaseProxyEndpoint` | RDS Proxy endpoint | Endpoint for database connections via proxy |
| `ImportLegacyVenuesFunctionName` | Lambda function name | Physical name of `ImportLegacyVenuesFunction` (workflow auto-resolves from stack output when GitHub var is unset) |
| `ImportLegacyFunctionName` | Lambda function name | Same value as `ImportLegacyVenuesFunctionName` (alias output) |
| `ImportDumpBucketName` | S3 bucket name | Ephemeral legacy-import SQL dumps bucket (workflow auto-resolves from stack output when GitHub var is unset) |
| `UserPoolId` | Cognito User Pool ID | User Pool identifier |
| `UserPoolClientId` | Cognito User Pool Client ID | OAuth client identifier |
| `AssetsBucketName` | S3 bucket name | Assets bucket |
| `AssetsLogBucketName` | S3 bucket name | Assets access logs bucket |
| `AssetsDownloadDistributionDomain` | CloudFront domain | CloudFront distribution hostname backing signed asset downloads |
| `AssetsDownloadCloudFrontKeyPairId` | CloudFront key pair ID | Key-Pair-Id used in signed download URLs |
| `AssetsDownloadCustomDomainTarget` | CloudFront domain | DNS CNAME target for the asset custom domain |
| `AssetsDownloadCustomDomainUrl` | URL | Custom domain URL used for signed asset download links |
| `MediaTopicArn` | SNS topic ARN | Media request events topic (from nested stack `evolvesprouts-Messaging`) |
| `MediaQueueUrl` | SQS queue URL | Media request processing queue (from nested stack `evolvesprouts-Messaging`) |
| `MediaDLQUrl` | SQS DLQ URL | Failed media request messages (from nested stack `evolvesprouts-Messaging`) |
| `ExpenseParserTopicArn` | SNS topic ARN | Expense parser events topic (from nested stack `evolvesprouts-Messaging`) |
| `ExpenseParserQueueUrl` | SQS queue URL | Expense parser processing queue (from nested stack `evolvesprouts-Messaging`) |
| `ExpenseParserDLQUrl` | SQS DLQ URL | Failed expense parser messages (from nested stack `evolvesprouts-Messaging`) |
| `BulkExpenseImportQueueUrl` | SQS queue URL | Async bulk combined-PDF import jobs (from nested stack `evolvesprouts-Messaging`) |
| `BulkExpenseImportDLQUrl` | SQS DLQ URL | Failed bulk expense import messages (from nested stack `evolvesprouts-Messaging`) |
| `EventbriteSyncTopicArn` | SNS topic ARN | Eventbrite sync events topic (from nested stack `evolvesprouts-EventbriteSync`) |
| `EventbriteSyncQueueUrl` | SQS queue URL | Eventbrite sync processing queue (from nested stack `evolvesprouts-EventbriteSync`) |
| `EventbriteSyncDLQUrl` | SQS DLQ URL | Failed Eventbrite sync jobs (SQS redrive; from nested stack `evolvesprouts-EventbriteSync`) |
| `EventbriteSyncProcessorLambdaDLQUrl` | SQS queue URL | Failed `EventbriteSyncProcessor` Lambda invocations (from nested stack `evolvesprouts-EventbriteSync`) |
| `InboundInvoiceRecipientAddress` | Email address | SES-managed inbound invoice mailbox |
| `InboundInvoiceRawEmailPrefix` | S3 object-key prefix | Reserved prefix for raw inbound invoice emails inside `AssetsBucket` |
| `InboundInvoiceTopicArn` | SNS topic ARN | Inbound invoice email events topic |
| `InboundInvoiceQueueUrl` | SQS queue URL | Inbound invoice email processing queue |
| `InboundInvoiceDLQUrl` | SQS DLQ URL | Failed inbound invoice email messages |
| `InboundInvoiceMxTarget` | MX record target | SES inbound SMTP target for the invoice subdomain |
| `CognitoCustomDomainCloudFront` | CloudFront distribution | Custom auth domain target (conditional) |
| `ApiCustomDomainTarget` | CNAME target | API custom domain DNS target (conditional) |
| `ApiCustomDomainUrl` | Custom domain URL | API custom domain URL (conditional) |

---

## Resource Dependencies

### Key Dependencies

1. **VPC** → Security Groups → Database/Lambda
2. **Database Secret** → Aurora Cluster → RDS Proxy
3. **Aurora Cluster** → Migration Lambda (direct access)
4. **RDS Proxy** → Application Lambdas (via proxy)
5. **Cognito User Pool** → Identity Providers → User Pool Client
6. **Cognito User Pool** → Auth Lambda Triggers
7. **Lambda Functions** → API Gateway Integrations
8. **API Gateway** → Usage Plan → API Key
9. **Migration Lambda** → Custom Resource (RunMigrations)
10. **Admin Bootstrap Lambda** → Custom Resource (AdminBootstrapResource)

### Conditional Resources

- **VPC**: Created if `EXISTING_VPC_ID` is not set
- **Security Groups**: Created if corresponding `EXISTING_*_SECURITY_GROUP_ID` is not set
- **Database Secret**: Created if `EXISTING_DB_CREDENTIALS_SECRET_NAME` and `EXISTING_DB_CREDENTIALS_SECRET_ARN` are not set
- **Aurora Cluster**: Created if `EXISTING_DB_CLUSTER_IDENTIFIER` is not set
- **RDS Proxy**: Created if `EXISTING_DB_PROXY_NAME` is not set
- **Admin Bootstrap**: Created if `AdminBootstrapEmail` and `AdminBootstrapTempPassword` are provided

---

## Resource Naming Convention

All resources use the prefix: **`evolvesprouts-`**

Examples:
- VPC: `evolvesprouts-vpc`
- Security Group: `evolvesprouts-lambda-sg`
- Database Cluster: `evolvesprouts-db-cluster`
- User Pool: `evolvesprouts-user-pool`
- API: `evolvesprouts-api`

---

## Tagging Coverage

The stack applies two tags at the stack level:

- `Organization= Evolve Sprouts`
- `Project= Backend`

These tags are inherited by **all taggable resources** created in this
stack, including implicit resources created by CDK (subnets, route
tables, etc.).

Tags are **not guaranteed** on the following:

- Resource types that do not support tagging.
- Imported or existing resources (for example, an existing VPC, DB
  cluster, or security groups).
- Resources created outside the stack lifecycle, such as Lambda log
  groups created on first invocation.
- CDK bootstrap stack resources (CDKToolkit), which are separate from
  this stack.

---

## Resource Retention Policies

Security groups use **update/replace retain** behavior to prevent replacement
failures during stack updates:

- `LambdaSecurityGroup`
- `MigrationSecurityGroup`

Deletion behavior still follows CloudFormation defaults unless resources are
imported/external.

---

## Estimated Resource Count

**Minimum (all existing resources imported):**
- ~50-60 resources (Lambdas, IAM roles, API Gateway resources, etc.)

**Maximum (all resources created):**
- ~150-200 resources (includes VPC, subnets, Aurora, RDS Proxy, all Lambdas with DLQs/KMS, API Gateway, etc.)

---

## Notes

1. **Lambda Log Groups**: Explicitly created by CDK with standard `/aws/lambda/{functionName}` naming and KMS encryption.
2. **API Gateway Access Log Group**: Created and managed by stack custom resources.
3. **Existing Resources**: The workflow detects and imports existing VPC, database, and security group resources to avoid recreation.
4. **CDK Bootstrap**: Required once per account/region. The workflow runs `cdk bootstrap` if needed.
5. **Lambda Bundling**: Lambda code is bundled during `cdk synth` using Docker or local bundle from `.lambda-build/base`.
