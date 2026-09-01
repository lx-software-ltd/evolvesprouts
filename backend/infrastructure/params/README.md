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
- `WafWebAclArn`

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

## Media lead pipeline parameters

The backend stack also requires Mailchimp/media lead parameters:

- `MailchimpApiSecretArn`
- `MailchimpListId`
- `MailchimpServerPrefix`
- `MailchimpWebhookSecret`
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
