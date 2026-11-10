# API domain and staging gate

The siutindei domain move left this repository a tested patch,
`evolvesprouts-api-domain-staging-gate.patch`, from
[that agent](https://cursor.com/agents/bc-01a1be9e-4c71-7379-99fd-87fa856acb08).
This plan is that patch, plus the review fixes. The staging origin lock is
the edge-verify check in `public-www-stack.ts`. It stays off while
`PublicWwwStagingEdgeVerifySecret` and
`PublicWwwStagingEdgeVerifySecretPrevious` are empty.

## What landed

- The API custom domain maps to the prod stage at `/prod`.
  `ApiCustomDomainUrl` includes that path, as `ApiUrl` does.
- The execute-api hostname does not accept calls. `DisableExecuteApiEndpoint`
  is set on the REST API. The stage variable `executeApiEndpoint` is
  `disabled`, and the stage update depends on the REST API so API Gateway
  applies the hostname setting. There is no parameter to turn the hostname
  back on.
- The asset-share CloudFront origin uses `ApiCustomDomainName`. The origin
  path stays `/prod`.
- `PublicWwwApiBaseUrl` and `PublicWwwMediaRequestApiBaseUrl` resolve
  `PUBLIC_WWW_API_BASE_URL` and `PUBLIC_WWW_MEDIA_REQUEST_API_BASE_URL`.
  Backend deploy falls back to `NEXT_PUBLIC_API_BASE_URL` when those are
  unset. Public-site builds prefer `NEXT_PUBLIC_WWW_API_BASE_URL` and fall
  back the same way. `TrainingApiBaseUrl` and
  `TrainingMediaRequestApiBaseUrl` still follow `NEXT_PUBLIC_API_BASE_URL`.
- `scripts/cloudflare/workers/www-staging-redirect-allowlist.js` is the
  shared staging gate. `scripts/cloudflare/staging_worker.py` uploads it.
- Staging smoke sends `x-staging-bypass` only to the `SMOKE_BASE_URL` host
  and does not follow a redirect onto another host. `SMOKE_CRM_API_BASE_URL`
  is the API fallback. The legacy name `SMOKE_API_BASE_URL` still works.
  With the secret unset, the run fails only when a response leaves the
  requested host.

## Still operator work

1. Deploy the backend stack. `ApiCustomDomainName` is
   `api.evolvesprouts.com` and `ApiCustomDomainCertificateArn` is the issued
   `*.evolvesprouts.com` certificate in `ap-southeast-1`. The deploy disables
   the execute-api hostname and moves share links to the custom domain.
2. Point the API DNS record at `ApiCustomDomainTarget`, proxy off. Confirm
   `GET https://api.evolvesprouts.com/prod/v1/mailchimp/webhook` returns
   `{"message":"ok"}` before the next step. `/prod/health` requires IAM, so
   an unauthenticated call returns 403 even when routing works. The admin
   Lambda strips the `/prod` base path from `path` before matching routes.
   Do not retarget DNS before the deploy creates the domain.
3. Keep `NEXT_PUBLIC_API_BASE_URL`, `PUBLIC_WWW_API_BASE_URL`,
   `PUBLIC_WWW_MEDIA_REQUEST_API_BASE_URL`, and the training API parameters
   on `ApiCustomDomainUrl`. The public site build uses
   `NEXT_PUBLIC_WWW_API_BASE_URL=/www`. Mailchimp and Meta callbacks use
   `ApiCustomDomainUrl` plus `/v1/...`.
4. Upload the staging Worker with `PRODUCTION_ORIGIN` set to the public
   site, the allow-list in `STAGING_ALLOWED_IPS`, and
   `STAGING_BYPASS_SECRET` on the Worker and in the `staging` GitHub
   environment. Smoke stays green until a response leaves the staging host.

The origin lock compares `x-proxy-verify` on every viewer-request function
of both public website distributions
(`functions/public-www-edge-verify.js`). Staging enforcement turns on when
`CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY` matches the Worker binding
`PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET`. Set the binding first. Production
enforcement turns on when `CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY` matches the
Cloudflare rule in `scripts/cloudflare/public_www_edge_policy.json`. Apply
the rule first, after Trace shows `x-proxy-verify` leaving Cloudflare and
after confirming no Worker on `www.evolvesprouts.com` drops that header.
Check the enforcing deploy with a URL Cloudflare has not cached. The steps
are in `docs/deployment/public-www.md`. The deploy that adds the check
publishes the three production viewer-request functions while both
production secrets are empty. Both secrets must be repository secrets or
production-environment secrets, because `deploy-backend.yml` runs in the
production environment. Deploy passes an empty edge-verify parameter
through, so clearing the secret, or deploying without being able to see it,
disables that distribution's lock. The job summary warns when either output
goes from `true` to anything else. Rotation order is in
`docs/deployment/public-www.md`. `deploy-backend.yml` runs on
`workflow_dispatch`, on `repository_dispatch` of type `deploy-backend`, and
on a push to `main` that changes `backend/**`, `scripts/**`,
`apps/public_www/src/content/landing-pages/**`,
`apps/public_www/src/content/eventbrite-banners/**`, or
`.github/workflows/deploy-backend.yml`. The stack list is the workflow
input, otherwise `CDK_STACKS`, otherwise `all stacks`. `WafWebAclArn` is
empty, so there is no WebACL to detach.

## Rollback

Re-enabling the execute-api hostname takes a code change. The REST API sets
`DisableExecuteApiEndpoint`, and the asset-share origin uses
`ApiCustomDomainName`. The custom domain stays either way.

Blanking `ApiCustomDomainName` in `params/production.json` does not remove
the domain. The deploy workflow drops empty values and CDK reuses the
previous stack parameter, so the domain and its base path mapping stay.
Removing them needs the workflow to pass empty values explicitly.
