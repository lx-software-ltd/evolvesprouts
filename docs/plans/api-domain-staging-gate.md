# API domain and staging gate

The siutindei domain move left this repository a tested patch,
`evolvesprouts-api-domain-staging-gate.patch`, from
[that agent](https://cursor.com/agents/bc-01a1be9e-4c71-7379-99fd-87fa856acb08).
This plan is that patch. The staging origin lock is a later step.

## What landed

- The API custom domain maps to the prod stage at `/prod`.
  `ApiCustomDomainUrl` includes that path.
- `ApiDisableExecuteApiEndpoint` is `false` in `params/production.json`.
  It takes effect only when the custom domain is configured, and the stage
  variable `executeApiEndpoint` changes with it.
- The asset-share CloudFront origin uses the custom domain when that
  condition is true, and the execute-api host otherwise. The origin path
  stays `/prod`.
- `scripts/cloudflare/workers/www-staging-redirect-allowlist.js` is the
  shared staging gate. `scripts/cloudflare/staging_worker.py` uploads it.
- Staging smoke sends `x-staging-bypass` from `STAGING_BYPASS_SECRET` and
  fails when a response leaves the host it requested.

## Still operator work

1. Issue a regional certificate for the API hostname. The current
   certificate cannot serve it. Then set `ApiCustomDomainName` and
   `ApiCustomDomainCertificateArn` and deploy.
2. Point the API DNS record at `ApiCustomDomainTarget`, proxy off.
3. Set `NEXT_PUBLIC_API_BASE_URL` to `ApiCustomDomainUrl` and redeploy the
   clients. Move the Mailchimp and WhatsApp callbacks. See
   `docs/deployment/backend.md`.
4. Set `ApiDisableExecuteApiEndpoint` to `true` and deploy.
5. Upload the staging Worker with `PRODUCTION_ORIGIN` set to the public
   site, the allow-list in `STAGING_ALLOWED_IPS`, and
   `STAGING_BYPASS_SECRET` on the Worker and in the `staging` GitHub
   environment.

The origin lock (`x-proxy-verify` on the staging CloudFront distribution)
is not part of this change. The Worker already forwards that header when
`PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET` is set.

## Rollback

Set `ApiDisableExecuteApiEndpoint` back to `false` and deploy before
pointing clients at the execute-api URL. The custom domain can stay.
