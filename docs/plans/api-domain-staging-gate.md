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
- `ApiDisableExecuteApiEndpoint` is `false` in `params/production.json`.
  It takes effect only when the custom domain is configured. While it is
  false, `DisableExecuteApiEndpoint` and the stage variable
  `executeApiEndpoint` are omitted. Turning it on sets the variable to
  `disabled` and the stage update depends on the REST API, so the stage
  setting changes after the flag. AWS applies the flag on that stage update.
- The asset-share CloudFront origin uses the custom domain only when
  execute-api is disabled, and the execute-api host otherwise. The origin
  path stays `/prod`. Creating the domain does not move share links.
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
   `*.evolvesprouts.com` certificate in `ap-southeast-1`. Leave
   `ApiDisableExecuteApiEndpoint` false. Share links stay on execute-api.
2. Point the API DNS record at `ApiCustomDomainTarget`, proxy off. Confirm
   `GET https://api.evolvesprouts.com/prod/v1/mailchimp/webhook` returns
   `{"message":"ok"}` before the next step. `/prod/health` requires IAM, so
   an unauthenticated call returns 403 even when routing works. The admin
   Lambda strips the `/prod` base path from `path` before matching routes.
   Do not retarget DNS before the deploy creates the domain.
3. Set `PUBLIC_WWW_API_BASE_URL` and
   `PUBLIC_WWW_MEDIA_REQUEST_API_BASE_URL` to the current execute-api URL
   so the public-site origins do not follow the client cutover.
   `TrainingApiBaseUrl` still reads `NEXT_PUBLIC_API_BASE_URL`; move the
   training parameters in the same change if training should stay on
   execute-api.
4. Set `NEXT_PUBLIC_API_BASE_URL` to `ApiCustomDomainUrl` for direct
   clients and redeploy them. Set `NEXT_PUBLIC_WWW_API_BASE_URL` to `/www`
   for the public site. Move the Mailchimp and WhatsApp callbacks. See
   `docs/deployment/backend.md`. Append `/v1/...` to `ApiCustomDomainUrl`.
5. Point `PUBLIC_WWW_API_BASE_URL` and
   `PUBLIC_WWW_MEDIA_REQUEST_API_BASE_URL` at `ApiCustomDomainUrl` and
   deploy the public website stack. Check `/www` and media requests.
6. Set `ApiDisableExecuteApiEndpoint` to `true` and deploy. Execute-api
   starts returning 403, and the asset-share origin moves to the custom
   domain.
7. Upload the staging Worker with `PRODUCTION_ORIGIN` set to the public
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
the rule first. Both secrets must be repository secrets or
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

Set `ApiDisableExecuteApiEndpoint` back to `false` and deploy before
pointing clients at the execute-api URL. That returns the asset-share
origin to execute-api. The custom domain can stay.

Blanking `ApiCustomDomainName` in `params/production.json` does not remove
the domain. The deploy workflow drops empty values and CDK reuses the
previous stack parameter, so the domain and its base path mapping stay.
Removing them needs the workflow to pass empty values explicitly.
