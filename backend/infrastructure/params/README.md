# CDK parameter files

Use `production.json` as a template for CDK parameters.

## Training website parameters

`production.json` includes training website parameters:

- `TrainingDomainName`
- `TrainingCertificateArn`
- `TrainingApiBaseUrl`
- `TrainingMediaRequestApiBaseUrl`
- `WafWebAclArn` (shared with other static sites)

`TrainingDomainName` is also passed to the backend stack for API Gateway CORS allowlisting.

## Completion certificate parameters

`production.json` includes `PublicWwwCertificateEsFounderName`, resolved in CI from
the GitHub Actions repository variable **`CDK_PARAM_CERTIFICATE_ES_FOUNDER_NAME`**
(the certificate ES founder display name). Create that variable before production
deploy; if it is missing or empty, certificate preview and issue fail validation
even though the CDK param entry exists in the JSON file.

## Public website parameters

`production.json` now includes both production and staging parameters for the
public website stacks:

- `PublicWwwDomainName`
- `PublicWwwCertificateArn`
- `PublicWwwStagingDomainName`
- `PublicWwwStagingCertificateArn`
- `PublicWwwEdgeVerifySecret` (`CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY`)
- `PublicWwwEdgeVerifySecretPrevious` (`CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY_PREVIOUS`)
- `PublicWwwStagingEdgeVerifySecret` (`CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY`)
- `PublicWwwStagingEdgeVerifySecretPrevious` (`CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY_PREVIOUS`)
- `WafWebAclArn`

`PublicWwwEdgeVerifySecret` and `PublicWwwStagingEdgeVerifySecret` are the
`x-proxy-verify` origin locks. Both values of a pair empty disables that
distribution's check. Deploy forwards an empty value, so clearing the GitHub
secret turns the lock off, and so does a deploy that cannot see the secret.
The job summary warns when either `PublicWwwEdgeVerifyEnabled` or
`PublicWwwStagingEdgeVerifyEnabled` goes from `true` to anything else. The
deploy job uses the `production` GitHub environment, so each secret must be
a repository secret or a production-environment secret. A
`staging`-environment secret does not reach it. Staging reads the header
from the Worker binding `PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET`. Set that
binding before the staging parameter. Production reads it from the
Cloudflare rule in `scripts/cloudflare/public_www_edge_policy.json`. Apply
that rule before `PublicWwwEdgeVerifySecret`. Rotate by deploying the old
value as the previous secret and the new value as the current secret, then
changing the Worker binding or the Cloudflare rule, then clearing the
previous secret and deploying again. `WafWebAclArn` is empty, so enabling
the lock does not detach a WebACL. `deploy-backend.yml` runs on
`workflow_dispatch`, on `repository_dispatch` of type `deploy-backend`, and
on a push to `main` that changes `backend/**`, `scripts/**`,
`apps/public_www/src/content/landing-pages/**`,
`apps/public_www/src/content/eventbrite-banners/**`, or
`.github/workflows/deploy-backend.yml`. The stack list is the workflow
input, otherwise the `CDK_STACKS` variable, otherwise `all stacks`.

Optional **transactional email footer** URLs on the API stack. `production.json`
resolves these from the same `NEXT_PUBLIC_*` GitHub vars that `deploy-public-www`
uses, so you only set each social URL once. CDK passes them to Lambdas as
`PUBLIC_WWW_*`. If empty, Instagram/LinkedIn rows are omitted from the email
footer (WhatsApp still uses a code default when its param is empty).
Do not set Instagram/LinkedIn to your own website URL; those are ignored.

- `PublicWwwInstagramUrl`
- `PublicWwwLinkedinUrl`
- `PublicWwwWhatsappUrl`

## Asset download CDN parameters

`production.json` also includes asset download domain parameters:

- `AssetDownloadCustomDomainName`
- `AssetDownloadCustomDomainCertificateArn`

Use these to ensure CloudFront-signed asset links are generated with your
custom media subdomain.

## API custom domain

`ApiCustomDomainName` is `api.evolvesprouts.com`.
`ApiCustomDomainCertificateArn` is the issued `*.evolvesprouts.com`
certificate in `ap-southeast-1`. The `*.lx-software.com` certificate in that
region does not match this hostname, and the `us-east-1` wildcard is only for
CloudFront and Cognito. The domain mapping uses the stage name as its base
path (`/prod`). `ApiCustomDomainUrl` includes that path, the same way `ApiUrl`
ends in `/prod`.

`ApiDisableExecuteApiEndpoint` defaults to `false`. Leave it false when the
custom domain is first created. The asset-share CloudFront origin stays on
the execute-api host until this flag is `true`, so share links keep working
while DNS is pointed at `ApiCustomDomainTarget`. Set the flag to `true` only
after that DNS change and after clients call the custom domain. The
execute-api hostname then rejects calls. The stage variable
`executeApiEndpoint` is present only while the flag is on, and the stage
update waits for the REST API change. Deploy `false` again before sending
clients back to execute-api.

`PublicWwwApiBaseUrl` and `PublicWwwMediaRequestApiBaseUrl` resolve
`PUBLIC_WWW_API_BASE_URL` and `PUBLIC_WWW_MEDIA_REQUEST_API_BASE_URL`.
Backend deploy falls back to `NEXT_PUBLIC_API_BASE_URL` when those variables
are unset. Set them to the current execute-api URL before pointing
`NEXT_PUBLIC_API_BASE_URL` at `ApiCustomDomainUrl`, and point them at the
custom domain before setting `ApiDisableExecuteApiEndpoint` to `true`.
`TrainingApiBaseUrl` and `TrainingMediaRequestApiBaseUrl` still follow
`NEXT_PUBLIC_API_BASE_URL`.

## Media lead pipeline parameters

The backend stack also requires Mailchimp/media lead parameters:

- `MailchimpApiSecretArn`
- `MailchimpListId`
- `MailchimpServerPrefix`
- `MailchimpWebhookSecret` (query `token` on `/v1/mailchimp/webhook`; after
  `ApiCustomDomainName` or execute-api URL changes, update the Mailchimp
  audience webhook to `{api-origin}/v1/mailchimp/webhook?token=...` — see
  `docs/deployment/backend.md`)
- `MetaAppSecret`
- `WhatsappWebhookVerifyToken`
- `MetaPageAccessToken` (Graph Page / system-user token for inbox import)
- `MediaDefaultResourceKey`

`MediaDefaultResourceKey` should match the `resource_key` value saved on the
default downloadable asset in the admin asset catalog.

## Deployment stage (SES / Mailchimp / SNS guards)

The Admin Lambda and Media Request Processor receive `DEPLOYMENT_STAGE` from CDK.
By default the API stack sets it to `production`. For a **non-production** stack
synth/deploy (for example a staging account or sandbox), set the environment
variable **`CDK_DEPLOYMENT_STAGE=staging`** when running `cdk deploy` so outbound
SES, Mailchimp, and SNS publishes are gated consistently with app defaults.

## OpenRouter invoice parsing parameters

The backend stack requires these OpenRouter parameters:

- `OpenRouterApiKey`
- `OpenRouterChatCompletionsUrl`
- `OpenRouterModel`

`OpenRouterApiKey` must be the named key `lxsoftware:evolvesprouts` minted
on the LX Software OpenRouter account (see lx-software
`scripts/mint-openrouter-app-keys.py`). Store the plaintext in GitHub secret
`CDK_PARAM_OPENROUTER_API_KEY`. A plain string is enough; this stack does not
read the LX Software admin JSON secret.

Chat-completions requests are tagged as hidden app Evolve Sprouts
(`HTTP-Referer` `https://evolvesprouts.com`, matching the lx-software
OpenRouter catalog) with `user` `evolvesprouts:{workload}`.

For CI deployments using placeholder resolution:

- set `OpenRouterApiKey` to `<FROM_GITHUB_SECRET: CDK_PARAM_OPENROUTER_API_KEY>`
- set `OpenRouterChatCompletionsUrl` to `<FROM_GITHUB_VAR: CDK_PARAM_OPENROUTER_CHAT_COMPLETIONS_URL>`
- set `OpenRouterModel` to `<FROM_GITHUB_VAR: CDK_PARAM_OPENROUTER_MODEL>`

`production.json` uses placeholder values that resolve from GitHub variables
and secrets during CI deploy.

## Stripe reservation payments

- `EvolveSproutsStripeSecretKey`: live secret (`CDK_PARAM_STRIPE_SECRET_KEY` in CI).
- `EvolveSproutsStripeStagingSecretKey`: test secret for the staging public site
  (`CDK_PARAM_STAGING_STRIPE_SECRET_KEY` in CI). The Admin Lambda also receives
  `PUBLIC_WWW_STAGING_SITE_ORIGIN` from `PublicWwwStagingDomainName` to pick the
  staging key when the browser `Origin`/`Referer` matches.

## Local deploy

```bash
cd backend/infrastructure
export CDK_PARAM_FILE=params/production.json
npx cdk deploy --require-approval never
```

## GitHub Actions

Set the repository variable `CDK_PARAM_FILE` to the path you want CI to use
(`params/production.json` by default).

> Keep secrets out of the repo. For production, use a private parameter file
> stored outside of git or generated in CI from secrets.
