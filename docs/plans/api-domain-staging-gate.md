# API domain and staging gate

The siutindei domain move left this repository a tested patch,
`evolvesprouts-api-domain-staging-gate.patch`, from
[that agent](https://cursor.com/agents/bc-01a1be9e-4c71-7379-99fd-87fa856acb08).
This plan is that patch, plus the review fixes. The staging origin lock is a
later step.

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
   `https://api.evolvesprouts.com/prod/health` before the next step. The
   current Cloudflare record targets an execute-api hostname that does not
   resolve, and it is proxied. Do not retarget it before this deploy creates
   the domain.
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

The origin lock (`x-proxy-verify` on the staging CloudFront distribution)
is not part of this change. The Worker already forwards that header when
`PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET` is set.

## Rollback

Set `ApiDisableExecuteApiEndpoint` back to `false` and deploy before
pointing clients at the execute-api URL. That returns the asset-share
origin to execute-api. The custom domain can stay.

Blanking `ApiCustomDomainName` in `params/production.json` does not remove
the domain. The deploy workflow drops empty values and CDK reuses the
previous stack parameter, so the domain and its base path mapping stay.
Removing them needs the workflow to pass empty values explicitly.
