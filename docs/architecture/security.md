# Security Guidelines

This document outlines security best practices and requirements for the Evolve Sprouts project. All contributors must follow these guidelines.

## Table of Contents

- [Secrets Management](#secrets-management)
- [Logging Security](#logging-security)
- [Authentication Security](#authentication-security)
- [API Security](#api-security)
- [Infrastructure Security](#infrastructure-security)
- [Code Review Checklist](#code-review-checklist)

---

## Secrets Management

### DO NOT

- **Never** hardcode secrets, API keys, passwords, or tokens in source code
- **Never** commit `.env` files, keystores, or credential files
- **Never** log secrets or tokens (even partially)
- **Never** include secrets in error messages returned to clients

### DO

- Use AWS Secrets Manager for database credentials
- Use GitHub Secrets for CI/CD sensitive values
- Use CDK parameters with `noEcho: true` for secrets
- Use environment variables at runtime

### Gitleaks Secret Scanning

Secret Scanning in `.github/workflows/security.yml` runs the MIT-licensed
`gitleaks` CLI (pinned version + SHA-256). It does not use
`gitleaks/gitleaks-action`, which requires a `GITLEAKS_LICENSE` on
organization repositories. Dependabot `pull_request` runs cannot read
Actions secrets, so the licensed action failed every Dependabot PR with
"missing gitleaks license".

### Example - CDK Parameter for Secrets

```typescript
const secretParam = new cdk.CfnParameter(this, "MySecret", {
  type: "String",
  noEcho: true,  // REQUIRED for secrets
  description: "Description without revealing the secret type",
});
```

---

## Logging Security

### PII Protection

Email addresses and other personally identifiable information (PII) must be masked in logs to comply with privacy regulations (GDPR, etc.).

### DO NOT

```python
# BAD - exposes email in logs
logger.info(f"User signed up: {email}")
logger.warning(f"Failed login for {user_email}")
```

### DO

```python
from app.utils.logging import mask_email, mask_pii, hash_for_correlation

# GOOD - masks PII
logger.info(f"User signed up: {mask_email(email)}")  # Output: jo***@***.com

# GOOD - use hash for correlation
correlation_id = hash_for_correlation(email)
logger.info(f"Processing request", extra={"correlation_id": correlation_id})

# GOOD - mask other PII
logger.info(f"User ID: {mask_pii(user_id)}")  # Output: abc1***
```

### Available Utilities

| Function | Purpose | Example Output |
|----------|---------|----------------|
| `mask_email(email)` | Mask email addresses | `jo***@***.com` |
| `mask_pii(value)` | Mask any PII | `abc1***` |
| `hash_for_correlation(value)` | Hash for log correlation | `a1b2c3d4e5f6` |

### Print Statements

**Never use `print()` in production code.** Always use structured logging:

```python
# BAD
print(f"Processing user {user_id}")

# GOOD
from app.utils.logging import configure_logging, get_logger
configure_logging()
logger = get_logger(__name__)
logger.info("Processing user", extra={"user_id_masked": mask_pii(user_id)})
```

---

## Authentication Security

### Admin web and admin API (Cognito groups)

Access to the admin Next.js app (beyond sign-in) and to admin API routes that use
the Cognito group authorizer requires membership in at least one of the user pool
groups **`admin`**, **`manager`**, or **`instructor`**. Users who complete social
or passwordless sign-in without any of these groups must not see the admin
dashboard; the client shows an access-denied state and sign out instead.

Admin API handlers call `require_admin_identity()` after the authorizer accepts
the request. A missing `user_sub` fails closed as `AuthorizationError` (HTTP 403)
rather than a 400 validation error.

Cognito session tokens (access, id, and refresh) are never written to
`localStorage` in clear text. `apps/admin_web/src/lib/auth.ts` serializes the
token bundle and encrypts it with AES-GCM via
`apps/admin_web/src/lib/secure-storage.ts` before persisting it. The AES key is
a non-extractable Web Crypto `CryptoKey` kept in IndexedDB so it survives
reloads but cannot be serialized out of the browser; if IndexedDB is
unavailable the key stays in memory for the current page session only. This is
defense-in-depth for data at rest and does not replace standard XSS
protections (CSP, input sanitization), since any in-page script can still ask
the browser to decrypt.

After the first decrypt, `auth.ts` keeps the decrypted bundle in a module-level
in-memory cache for the page session so concurrent API calls do not each hit
IndexedDB and Web Crypto; the cache is dropped on sign-out and whenever another
tab changes the storage key (`storage` event). Token refresh is single-flight:
overlapping calls to `ensureFreshTokens()` share one refresh request so a burst
of queries on page load cannot race multiple refresh-token exchanges.

### JWT audience / client verification

Cognito ID tokens carry the app client id in the `aud` claim; access tokens use
`client_id`. After signature and issuer checks, `decode_and_verify_token` in
`backend/src/app/auth/jwt_validator.py` requires the claim to appear in the
comma-separated allowlist env var `COGNITO_ALLOWED_CLIENT_IDS`. An empty or
missing allowlist fails closed (tokens are rejected). Wire the same allowlist on
admin API Lambdas and Cognito request authorizers via CDK. Production deploys
use a single Cognito app client (`EvolvesproutsUserPoolClient` in
`backend/infrastructure/lib/api-stack.ts`).
The infra test `backend/infrastructure/test/api-stack.test.ts` enforces this
single-client invariant: it fails if more than one app client is synthesized or
if any Lambda's `COGNITO_ALLOWED_CLIENT_IDS` references a different client.

### OTP/Code Generation

**Always use cryptographically secure random for security tokens.**

```python
# BAD - predictable, not secure
import random
code = "".join(random.choice(string.digits) for _ in range(6))

# GOOD - cryptographically secure
import secrets
code = "".join(secrets.choice(string.digits) for _ in range(6))
```

### Device Attestation

The device attestation authorizer has two modes:

| Mode | `ATTESTATION_FAIL_CLOSED` | Behavior |
|------|---------------------------|----------|
| **Production** | `true` (default) | Denies requests when attestation is not configured |
| **Development** | `false` | Allows requests without attestation |

**WARNING:** Always use `ATTESTATION_FAIL_CLOSED=true` in production environments.

### CDK Configuration

```typescript
const deviceAttestationFailClosed = new cdk.CfnParameter(
  this,
  "DeviceAttestationFailClosed",
  {
    type: "String",
    default: "true",  // Secure default
    allowedValues: ["true", "false"],
    description: "SECURITY: Must be 'true' in production.",
  }
);
```

---

## API Security

### Admin asset file replacement

`POST /v1/admin/assets/{id}/content/init` and `.../complete` are **admin-authenticated**
writes. The replace presign binds **`Content-Type: application/pdf`**, and **complete**
rejects non-PDF S3 metadata, enforces a **maximum object size** on head, and validates the
pending key’s **`UUID-` filename prefix** so arbitrary key suffixes cannot be smuggled in.
Expense-linked and customer-invoice-linked assets cannot use replace, cannot be
deleted, and must remain `visibility=restricted` (setting `public` returns 400).
Customer invoice PDFs stay off the public free-assets list because they are
restricted and do not receive the `client_document` tag.

### CORS Configuration

**Never use `Cors.ALL_ORIGINS` in production.** Always restrict to specific allowed origins.

```typescript
// BAD - allows any website to make requests
defaultCorsPreflightOptions: {
  allowOrigins: apigateway.Cors.ALL_ORIGINS,
}

// GOOD - restrict to specific origins
const corsAllowedOrigins = new cdk.CfnParameter(this, "CorsAllowedOrigins", {
  type: "CommaDelimitedList",
  description: "SECURITY: Never use '*' in production.",
});

defaultCorsPreflightOptions: {
  allowOrigins: corsAllowedOrigins.valueAsList,
}
```

### Required and Default Allowed Origins

Backend CORS always includes domain-derived required origins from:
- `PublicWwwDomainName`
- `PublicWwwStagingDomainName`
- `AdminWebDomainName`
- `TrainingDomainName`

Optional extra origins can be added via `CORS_ALLOWED_ORIGINS` or CDK context
`corsAllowedOrigins`, but when no extras are configured the default is only the
required domain-derived origins above.

### Private Network Access (Chromium)

Lambda responses (via `get_cors_headers()`) include
`Access-Control-Allow-Private-Network: true` when Chromium’s Private Network
Access preflight requires it on **integration** responses.

API Gateway REST API **rejects** this header on MOCK `OPTIONS` integration and
method response mappings (`Invalid mapping expression parameter` for
`method.response.header.Access-Control-Allow-Private-Network`), so preflight
responses from generated CORS `OPTIONS` methods cannot emit it through API
Gateway alone. If preflight must carry this header end-to-end, add it at an edge
layer (for example a CloudFront response headers policy in front of the API).

### Input Validation

Always validate and sanitize user input:

```python
from app.utils.validators import validate_uuid, validate_email, sanitize_string

# Validate UUIDs
entity_id = validate_uuid(request_id, field_name="id")

# Validate emails
email = validate_email(user_email)

# Sanitize strings with length limits
description = sanitize_string(user_input, max_length=1000)
```

### Error Responses

**Never expose internal error details to clients.**

```python
# BAD - exposes internal details
return {"error": str(exception), "traceback": traceback.format_exc()}

# GOOD - generic error message
logger.exception("Internal error")  # Log details internally
return {"error": "Internal server error"}  # Generic response to client
```

### Hashed API tokens (`x-api-token`)

Operator-issued tokens authenticate `/v1/public/*` routes (WhatsApp,
Messenger, and Instagram conversation reads, plus CRM contacts). They are
distinct from the browser-visible website `x-api-key`.

- Tokens use prefix `esk_` and are stored as PBKDF2-HMAC-SHA256 digests in `api_keys`.
- Scopes: `admin` (full access on token-protected routes) and `user` (GET only).
- A VPC Lambda authorizer (`ApiTokenAuthorizerFunction`) validates
  `x-api-token`. Results are cached for 5 minutes.
- Plaintext is shown once at create (`POST /v1/admin/api-keys`) and is never
  logged. Revoke via `DELETE /v1/admin/api-keys/{id}`.
- Public WhatsApp payloads omit WhatsApp numbers and `wa_id`.
- Public Meta payloads omit Page-scoped user ids (`platform_user_id`) and
  page ids.
- Public contact payloads match the admin contact contract (including email,
  phone, and date of birth). Notes, services, and Mailchimp sync jobs stay on
  Cognito admin routes.

### Public WWW API key model

The public website (`apps/public_www`) uses a browser-visible key:

- `NEXT_PUBLIC_WWW_CRM_API_KEY`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_WWW_PROXY_ALLOWED_HOSTS`

This key is intentionally public and must remain strictly scoped.

Requirements:

- The key must be read-only and limited to the required public endpoints.
- Requests should prefer same-origin `/www` proxy routing.
- Public write endpoints (for example reservation submissions) must validate
  `X-Turnstile-Token` server-side against Cloudflare Turnstile.
- API-side rate limiting and monitoring must be enabled. The shared public
  usage plan (`PublicWwwUsagePlan` in
  `backend/infrastructure/lib/api-stack.ts`) enforces request throttling and a
  daily quota on the browser-visible key.
- Any key rotation must be coordinated with frontend runtime configuration.

### Public WWW same-origin proxy allowlist

The CloudFront `www/*` behavior in
`backend/infrastructure/lib/public-www-stack.ts` uses a viewer-request
CloudFront Function with a **default-deny** policy.

Security model:

- Only explicitly approved method+path pairs are forwarded.
  - Most `/www/*` routes use the API origin host resolved from
    `PublicWwwApiBaseUrl`.
  - `POST /www/v1/assets/free/request` uses the execute-api origin resolved from
    `PublicWwwMediaRequestApiBaseUrl`, with a viewer-request URI rewrite to
    `/v1/assets/free/request`.
- Requests that are not allowlisted are blocked at CloudFront with a `403`
  before reaching the API origin.
- The policy is applied to both production and staging public website
  distributions.

The training website stack (`backend/infrastructure/lib/training-stack.ts`)
uses the same default-deny `/www/*` allowlist and media-request rewrite as the
public WWW stack via shared sources in
`backend/infrastructure/lib/cloudfront-www-proxy-functions.ts`. When adding or
changing a public API path, update that module so production public WWW and
training origins stay aligned.

Process to add a new public API path:

1. Confirm the endpoint is intended for unauthenticated/public website use.
2. Update the endpoint contract in the relevant `docs/api/*.yaml` spec.
3. Add the exact method+path rule to the CloudFront Function allowlist in
   `public-www-stack.ts`.
4. Deploy the public website infrastructure.
5. Verify positive and negative cases:
   - allowlisted path succeeds
   - non-allowlisted path returns `403`
6. Monitor API and CloudFront logs for unexpected request patterns after
   rollout.

Current allowlisted public website POST paths include:

- `/www/v1/contact-us`
- `/www/v1/discounts/validate`
- `/www/v1/assets/free/request`
- `/www/v1/reservations`
- `/www/v1/reservations/payment-intent`

Training form persistence uses `PUT /www/v1/forms/{form_slug}/answers` (prefix +
`/answers` suffix rule in `WWW_PROXY_ALLOWLIST_FUNCTION`; not a fixed path per form).
Training poll persistence uses `PUT /www/v1/polls/{poll_slug}/answers` (prefix +
`/answers` suffix rule in `WWW_PROXY_ALLOWLIST_FUNCTION`; not a fixed path per poll).
Live poll aggregates use `GET /www/v1/polls/{poll_slug}/questions/{question_id}/results`
(prefix + `/questions/` + `/results` suffix rule; not a fixed path per poll).

### Training poll facilitator controls (accepted risk)

The training site facilitator flow (`/polls/{slug}/controls/` in
`apps/training`, backed by `PUT /www/v1/polls/{poll_slug}/control`) uses the
same browser-visible public API key as participant poll answers, and the
controls page itself is unauthenticated.

This is an **accepted risk** by product decision (2026-06): polls are
low-sensitivity workshop tooling, facilitator URLs are shared only with
workshop staff, and the blast radius of misuse is limited to toggling which
poll question is open and viewing aggregate workshop answers.

Existing mitigations:

- CloudFront default-deny `/www/*` allowlist restricts reachable methods and
  paths.
- Backend validation enforces UUID `sessionId`, slug patterns, field
  length caps, facilitator-published option membership for select/multiselect
  answers when `questionOptions` is present on control state, and per-session /
  per-IP DynamoDB write counters (429 when exceeded).
- The shared public usage plan applies request throttling and a daily quota.

Revisit this decision if polls start collecting sensitive participant data or
facilitator controls gain broader capabilities; the planned hardening would
split participant and facilitator API keys and gate the controls page behind
authentication.

### Third-party invoice parser egress controls

Expense invoice parsing sends attachment bytes (or email-body text saved as a
`text/plain` asset for inbound mail) to OpenRouter and must follow a
fail-closed outbound policy:

- In-VPC Lambdas **must not** call OpenRouter directly.
- `ExpenseParserFunction` invokes outbound HTTP through
  `AwsApiProxyFunction` (`app.services.aws_proxy.http_invoke`).
- Proxy outbound URLs are restricted via `ALLOWED_HTTP_URLS`; deployments must
  include only the configured OpenRouter chat-completions URL.
- OpenRouter API keys are loaded from AWS Secrets Manager
  (`OPENROUTER_API_KEY_SECRET_ARN`); keys are never hardcoded in source or
  committed to git.
- Parser enforces per-file size limits (`OPENROUTER_MAX_FILE_BYTES`) before
  forwarding payloads.
- Parser updates expense parse status to `failed` on upstream/service errors so
  operators can retry explicitly (`/v1/admin/expenses/{id}/reparse`).

### Inbound invoice email handling

Inbound invoice email ingestion stores raw `.eml` payloads in the private
assets bucket under a reserved prefix before attachments (or body-extracted
invoice text) are copied into normal expense asset keys.

Requirements:

- Treat raw inbound email as sensitive content. Do not expose the
  `inbound-email/raw/` prefix through public or signed-download routes.
- Do not log raw email bodies, headers, or attachment bytes.
- Mask sender addresses in application logs with `mask_email()`.
- Optional sender allowlist: when `InboundInvoiceAllowedSenderPatterns` is
  non-empty (deployed from GitHub Actions variable
  `CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS` into Lambda env
  `INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS`), messages whose SES envelope
  `source` and RFC822 `From` address both fail substring matching are marked
  failed in `inbound_emails` and are not ingested as expenses.
- Keep SES receipt processing least-privilege: only the configured receipt role
  can write raw email objects and publish the notification topic.
- Keep inbound attachments `visibility=restricted` when they are promoted into
  the assets bucket for expense parsing and admin review.

---

## Infrastructure Security

### IAM Permissions

- Use least-privilege IAM roles
- Use OIDC for GitHub Actions (no long-lived AWS keys)
- Scope permissions to specific resources

### Asset share-link and download signing model

- Stable share links (`/v1/assets/share/{token}` and
  `/v1/assets/email-download/{token}`) are bearer links and must be treated like
  secrets when shared externally.
- Share-link tokens are random URL-safe values persisted in
  `asset_share_links`; admin APIs support rotate, revoke, and per-asset
  source-domain allowlist updates to recover from leaks. Creating or updating
  an asset to `visibility=public` seeds that allowlist from
  `ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS` (public website hostnames from
  stack parameters) when the asset does not already have a share link.
- Download URLs returned to clients are CloudFront-signed URLs generated on
  demand by Lambda.
- Share-token redirects and download-link JSON responses set strict no-store
  cache headers. API Gateway stage caching is disabled for all routes; the
  asset download CloudFront behaviors for share and email-download paths use
  `CACHING_DISABLED` so freshly signed URLs are never served from an edge cache.
- Share-token resolution on `/v1/assets/share/{token}` requires a request
  Referer/Origin domain that matches the share link's `allowed_domains` policy,
  blocking direct address-bar opens when no allowed source-domain signal is
  present. The email-oriented path `/v1/assets/email-download/{token}` skips that
  check so links work from email clients without Referer.
- When a share link resolves to an asset with `visibility=restricted`,
  `Authorization: Bearer <JWT>` is required (on both share and email-download
  paths).
- Admin-generated share links are built with `ASSET_SHARE_LINK_BASE_URL`
  (`https://media.evolvesprouts.com`) and served through CloudFront behaviors
  that forward `v1/assets/share/*` and `v1/assets/email-download/*` to API
  Gateway and inject the required `x-api-key` origin header.
- The CloudFront signer private key must be stored in AWS Secrets Manager and
  loaded at runtime; never commit private keys in source control.
- CloudFront distributions serving assets must restrict S3 origin access
  via Origin Access Control (OAC).
- The assets CloudFront distribution supports optional AWS WAF
  association through `AssetDownloadWafWebAclArn` (global WebACL ARN in
  `us-east-1`).

### Public website CDN headers

`backend/infrastructure/lib/public-www-stack.ts` configures CloudFront
response headers for the public website distributions.

Baseline policy includes:

- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`
- `Content-Security-Policy`
- `Permissions-Policy`

#### CSP model for S3 + CloudFront static hosting

The public site is deployed as static HTML to S3 behind CloudFront, without
Lambda@Edge/body mutation. In this architecture, Next.js static output includes
many inline hydration scripts that vary by page. A single CloudFront CSP header
cannot safely enumerate all required script hashes within header size limits.

To keep CSP strict while removing `unsafe-inline`:

- CloudFront sets a minimal header CSP:
  - `base-uri 'self'; object-src 'none'; frame-ancestors 'none'`
- Build step `apps/public_www/scripts/inject-csp-meta.mjs` injects a
  per-page `<meta http-equiv="Content-Security-Policy">` into every exported
  HTML file in `apps/public_www/out`.
- The injected page-level CSP computes SHA-256 hashes for that page's inline
  scripts and includes them in `script-src`, with no `unsafe-inline`.
- `frame-ancestors` remains header-only, because browsers ignore that directive
  when delivered through a CSP `<meta>` tag.

Staging additionally sets:

- `X-Robots-Tag: noindex, nofollow, noarchive`

#### Analytics and payments CSP allowlist

When Google Tag Manager is enabled (`NEXT_PUBLIC_GTM_ID` is set at build
time), the CSP injection script conditionally adds:

- `script-src`: `https://www.googletagmanager.com`
- `connect-src`: `https://www.google-analytics.com`,
  `https://analytics.google.com`,
  `https://region1.google-analytics.com`,
  `https://stats.g.doubleclick.net`

These origins are only included in the page-level `<meta>` CSP when the GTM
bootstrap script (`init-gtm.js`) is detected in the build output. The
CloudFront header CSP is not modified (it covers only `base-uri`,
`object-src`, and `frame-ancestors`).

GTM is gated at runtime to fire only on hosts in
`NEXT_PUBLIC_GTM_ALLOWED_HOSTS` (or, when unset, the hostname from
`NEXT_PUBLIC_SITE_ORIGIN`). Staging, localhost, and preview hosts receive zero
GTM network requests unless explicitly allowlisted, even though the CSP permits
the Google domains.

When Stripe payment UI is enabled in the public website build output, the CSP
injection script conditionally adds Stripe origins:

- `script-src`: `https://js.stripe.com`
- `connect-src`: `https://api.stripe.com`, `https://m.stripe.network`,
  `https://r.stripe.com`
- `frame-src`: `https://js.stripe.com`, `https://hooks.stripe.com`
- `worker-src`: includes `blob:` to support browser workers used by Stripe.js

These Stripe origins are only injected when Stripe client code is present in
the generated HTML. This keeps the allowlist minimal for pages/builds that do
not include Stripe.

The Admin Lambda selects live vs staging Stripe API credentials for public
reservation payment flows by comparing the browser `Origin` or `Referer`
(HTTPS only) to the `STAGING_SITE_ORIGIN` field of the JSON object pointed
at by `PUBLIC_WWW_CONFIG_SECRET_ARN` (Secrets Manager); requests without a
matching staging origin use the live secret. The legacy
`PUBLIC_WWW_STAGING_SITE_ORIGIN` env var continues to work for tests
because `app.config.public_www` prefers env vars when present.

#### Permissions-Policy for Stripe Payment Request API

The CloudFront `Permissions-Policy` header restricts browser features to a
minimal set. Most features are fully disabled (for example `camera=()`,
`geolocation=()`). The `payment` feature is an exception: Stripe's Payment
Element renders inside an iframe from `https://js.stripe.com` and requires
access to the Payment Request API. Blocking `payment` entirely causes the
Stripe card input to render an empty box.

The policy sets `payment=(self "https://js.stripe.com")` so the Payment
Request API is available to the site origin and to Stripe's embedded iframe
while remaining blocked for all other third-party origins.

### Database Security

- Always use SSL: `sslmode=require`
- Prefer IAM authentication for RDS Proxy
- Use separate database users for different access levels:
  - `evolvesprouts_app` - read-only for search
  - `evolvesprouts_admin` - read-write for admin
- If importing an existing Secrets Manager credential secret encrypted
  with a customer-managed KMS key, ensure Lambda roles can decrypt it
  (set `EXISTING_DB_CREDENTIALS_SECRET_KMS_KEY_ARN` or use auto-detect).

### GitHub Workflow Permissions

Always use minimal permissions:

```yaml
permissions:
  contents: read  # Minimum required
  id-token: write  # Only if using OIDC
```

---

## Code Review Checklist

Before approving any PR, verify:

### Secrets
- [ ] No hardcoded secrets, API keys, or passwords
- [ ] New secrets use appropriate storage (Secrets Manager, GitHub Secrets)
- [ ] CDK parameters for secrets have `noEcho: true`

### Logging
- [ ] No PII (emails, names, etc.) logged without masking
- [ ] No `print()` statements in production code
- [ ] Error messages don't expose internal details

### Authentication
- [ ] Security tokens use `secrets` module, not `random`
- [ ] Device attestation uses fail-closed mode in production

### API
- [ ] CORS restricted to specific origins (not `ALL_ORIGINS`)
- [ ] Input is validated before processing
- [ ] Error responses don't leak internal details
- [ ] Browser-visible API keys are explicitly scoped and rate-limited

### Infrastructure
- [ ] IAM permissions follow least-privilege
- [ ] Database connections use SSL
- [ ] Workflow permissions are minimal

---

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do not** create a public GitHub issue
2. Contact the maintainers privately
3. Provide details about the vulnerability and steps to reproduce

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [AWS Security Best Practices](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [GDPR Logging Requirements](https://gdpr.eu/article-32-security-of-processing/)
