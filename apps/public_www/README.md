# Public WWW

`public_www` is the public-facing web app for Evolve Sprouts.

## Core commands

- `npm run dev` — run local development server.
- `npm run validate:content` — validate locale content contract.
- `npm run lint` — run ESLint.
- `npm run test` — run unit tests (Vitest + Testing Library).
- `npm run audit:assets` — detect missing/unused static assets.
- `npm run images:optimize` — generate optimized `.webp` images from
  `public/images/**/*.png`.
- `npm run smoke:staging` — run staging smoke checks for page health and CTA APIs.
- `npm run build` — validate content, build Figma CSS tokens, and build the app.
- `npm run lighthouse:ci` — run Lighthouse CI against the static export.

## Component and test folder conventions

Use this structure for all new `public_www` UI code:

- `src/components/pages/**` for page-composition components.
- `src/components/shared/**` for reusable primitives and layout helpers.
- `src/components/sections/**` for section components.
- `src/components/sections/shared/**` for section-only shared helpers.

Place all test files under `tests/**` (not under `src/**`), with mirrored
domains for navigation:

- `tests/components/**`
- `tests/lib/**`
- `tests/content/**`

## Content-key-driven naming convention

For `public_www`, content key paths are the source of truth for section naming.

- Content key segments use lowerCamelCase.
 - Examples:
  - `aboutUs.hero`
  - `aboutUs.intro`
  - `aboutUs.myHistory`
  - `aboutUs.myJourney`
  - `aboutUs.whyUs`
  - `contactUs.form`
  - `contactUs.faq`
  - `myBestAuntie.hero`
  - `myBestAuntie.outline`
  - `myBestAuntie.booking`
  - `myBestAuntie.description`
  - `events.notification`

Derive section names from the content key path:

- Component name: PascalCase path segments
- Section file name: kebab-case path segments
- `SectionShell` `id` and `dataFigmaNode`: same kebab-case key

Examples:

| Content key path | Component name | Section file | SectionShell id / dataFigmaNode |
|---|---|---|---|
| `content.aboutUs.whyUs` | `AboutUsWhyUs` | `about-us-why-us.tsx` | `about-us-why-us` |
| `content.aboutUs.intro` | `AboutUsIntro` | `about-us-intro.tsx` | `about-us-intro` |
| `content.contactUs.faq` | `ContactUsFaq` | `contact-us-faq.tsx` | `contact-us-faq` |
| `content.contactUs.form` | `ContactUsForm` | `contact-us-form.tsx` | `contact-us-form` |

Avoid legacy contact keys (`contactUs.contactUsForm`, `contactUs.contactFaq`).

## Locale content conventions

Treat `src/content/en.json` as the content schema and source of truth for the
public website. Keep `zh-CN.json` and `zh-HK.json` aligned in the same change.

All user-visible copy must live in locale JSON, including:

- headings and body copy
- CTA and button labels
- validation, error, and success messages
- placeholder and fallback labels that can surface to users
- image `alt` text
- `aria-label`, `aria-roledescription`, and other screen-reader-only text

Do not add new hardcoded user-visible English copy in:

- `src/app/**`
- `src/components/**`
- locale-aware helpers in `src/lib/**`

Read it from locale content instead.

### Naming conventions

- Use `common.*` for shared cross-page UI copy:
  - `common.shell.*` for app-shell text
  - `common.accessibility.*` for shared a11y strings/templates
  - `common.mediaDownload.*` for the media download flow
  - `common.placeholder.*` for generic placeholder-page copy
- Keep section-specific copy under the section key when it belongs to only one
  area, for example:
  - `services.showDetailsAriaLabelTemplate`
  - `myBestAuntieBooking.paymentModal.fpsQrCodeLabel`
  - `testimonials.a11y.*`
- Use a `*Template` suffix for strings that interpolate runtime values, such as:
  - `submenuToggleLabelTemplate`
  - `carouselLabelTemplate`
  - `imageAltTemplate`
  - `nextCohortLabelTemplate`

### Examples

- Shared shell copy:
  - `common.shell.skipToMainContentLabel`
  - `common.shell.noscript.title`
- Shared accessibility copy:
  - `common.accessibility.carouselRoleDescription`
  - `common.accessibility.carouselLabelTemplate`
- Section-specific accessibility copy:
  - `testimonials.a11y.imageAltTemplate`
  - `services.showDetailsAriaLabelTemplate`

When a new key is added:

1. Add it in `src/content/en.json`
2. Add the same key in `src/content/zh-CN.json`
3. Add the same key in `src/content/zh-HK.json`
4. If needed, export/update the related type in `src/content/index.ts`
5. Update tests for the affected UI behavior

## Figma token scaffolding

The app can consume design tokens from Figma:

- `npm run figma:pull` pulls Figma file metadata and local variables into
  `figma/files/` using OAuth 2.0 credentials.
- `npm run figma:build:studio` builds normalized token artifacts and generates
  CSS variables consumed by the app.
- `npm run figma:studio-sync` runs pull + tokenize + build in sequence.
- `npm run figma:full-sync` runs studio sync, scaffolding, and design spec
  extraction.

Directory layout:

- `figma/files/`: raw Figma API payloads
- `figma/mdm/artifacts/`: normalized artifacts generated for the website
- `shared/styles/generated/figma-tokens.css`: generated token CSS (shared with training)
- `shared/styles/evolve-sprouts.css`: shared brand styles (tokens, theme, base, core, utilities)

To run `figma:pull`, set `FIGMA_FILE_KEY` and either:

- `FIGMA_OAUTH_ACCESS_TOKEN`, or
- `FIGMA_OAUTH_CLIENT_ID`, `FIGMA_OAUTH_CLIENT_SECRET`, and
  `FIGMA_OAUTH_REFRESH_TOKEN`.

## Development

```bash
npm install
npm run validate:content
npm run dev
```

## Staging smoke runner

Run smoke checks against a target site origin:

```bash
SMOKE_BASE_URL=https://www-staging.example.com \
SMOKE_API_KEY=<public-api-key> \
npm run smoke:staging
```

What the runner validates:

- Page smoke: fetches all pages discovered from `/sitemap.xml` (with URLs
  remapped to the target smoke origin) and fails on broken HTTP responses.
- Public API smoke (same-origin `/www/v1/*` with optional direct `/v1/*` fallback):
  - `GET /www/v1/calendar/public`
  - `GET /www/v1/assets/free?limit=100`
  - `POST /www/v1/contact-us`
  - `POST /www/v1/discounts/validate`
  - `POST /www/v1/assets/free/request`
  - `POST /www/v1/reservations`
  - `POST /www/v1/reservations/payment-intent`

Status handling for API checks:

- `PASS`: successful response (`200` for reads and most writes, `202` where applicable).
- `PASS*`: endpoint was reached but blocked by validation/auth gates
  (for example invalid/missing Turnstile token on staging).
- `FAIL`: unexpected status, server error (`5xx`), timeout, or transport error.

Optional environment variables:

- `SMOKE_TIMEOUT_MS` (default `15000`)
- `SMOKE_TURNSTILE_TOKEN` (optional token for Turnstile-protected endpoints)
- `SMOKE_MAX_PAGES` (limit number of page checks)
- `SMOKE_CRM_API_BASE_URL` (optional API base fallback for `/v1/*` routes;
  falls back to `NEXT_PUBLIC_API_BASE_URL`)
- `SMOKE_MEDIA_API_BASE_URL` (optional media API base fallback for
  `/v1/assets/free/request`; falls back to `NEXT_PUBLIC_API_BASE_URL`)

If a same-origin `/www/*` API smoke request returns `404`, the runner retries
that request against the corresponding configured fallback API base before
marking it as failed.

Optional flags:

- `--pages-only`
- `--api-only`

## ESLint 10 compatibility

This app currently keeps a temporary ESLint 10 compatibility shim because the
Next.js lint dependency graph still includes plugins that are not fully
ESLint-10-native.

- `eslint.config.js` wraps `eslint-config-next` via `@eslint/compat`
  `fixupConfigRules(...)`.
- `eslint.config.js` uses `espree` for JS-family files to avoid parser/runtime
  mismatches while linting config files.
- `package.json` overrides `typescript-eslint` to `8.55.1-alpha.4` to pick up
  ESLint 10 support in the parser/scope-manager stack.

When upstream `eslint-config-next` dependencies ship stable ESLint 10 support,
remove the compatibility shim and the override.

To enable public website CRM API calls (including My Best Auntie discount code lookup), set:

- `NEXT_PUBLIC_WWW_PROXY_ALLOWED_HOSTS`
- `NEXT_PUBLIC_WWW_CRM_API_KEY`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_ASSET_SHARE_BASE_URL`
- `NEXT_PUBLIC_FPS_MERCHANT_NAME`
- `NEXT_PUBLIC_FPS_MOBILE_NUMBER`
- `NEXT_PUBLIC_BANK_NAME`
- `NEXT_PUBLIC_BANK_ACCOUNT_HOLDER`
- `NEXT_PUBLIC_BANK_ACCOUNT_NUMBER`
- `NEXT_PUBLIC_EMAIL`
- `NEXT_PUBLIC_FOUNDER_NAME` (founder display name on `llms.txt`)
- `NEXT_PUBLIC_WHATSAPP_URL`
- `NEXT_PUBLIC_INSTAGRAM_URL`
- `NEXT_PUBLIC_LINKEDIN_URL`
- `NEXT_PUBLIC_BUSINESS_NAME`
- `NEXT_PUBLIC_BUSINESS_LEGAL_NAME` (Admin Lambda invoice PDF footer legal line only today)
- `NEXT_PUBLIC_BUSINESS_ADDRESS`
- `NEXT_PUBLIC_BUSINESS_PHONE_NUMBER`
- `NEXT_PUBLIC_BUSINESS_REGISTRATION` (business registration / BR line on invoice PDF footers)
- `NEXT_PUBLIC_SITEMAP_LASTMOD` (optional ISO date string)

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is required at build time for Stripe
payment support. The content validation step fails the build if this variable is
missing or not a publishable key (`pk_...`).

Use `NEXT_PUBLIC_API_BASE_URL=/www` to route requests through the
same-origin CloudFront API proxy and avoid cross-origin CORS preflight issues.
Set `NEXT_PUBLIC_WWW_PROXY_ALLOWED_HOSTS` to a comma-separated hostname
allowlist (for example
`www.evolvesprouts.com,www-staging.evolvesprouts.com`) so browser clients only
switch to `/www` proxy routing on approved hosts.
CSP generation derives `connect-src` API origins from
`NEXT_PUBLIC_API_BASE_URL`.
When set to an absolute URL, that same variable also determines which API
origins are allowed in CSP `connect-src`.
`NEXT_PUBLIC_API_BASE_URL` is used for public website API calls such as contact-us,
reservations, Stripe payment-intent initialization (`/v1/reservations/payment-intent`),
and the free guides resource library list (`GET /v1/assets/free`, same-origin as
`/www/v1/assets/free` when proxied).
The injected CSP also allows Cloudflare Web Analytics (`static.cloudflareinsights.com`
for `script-src` and `cloudflareinsights.com` for `connect-src`) when Cloudflare
injects the beacon at the edge.
When the build detects Google Tag Manager (`init-gtm.js`), CSP also allows Google
Ads–related script and connect endpoints used by tags in the container (for example
`googleads.g.doubleclick.net`, `www.googleadservices.com`, and `www.google.com` for
CCM/rmkt beacons), in addition to the existing Google Analytics `connect-src` hosts.
Public website discount validation uses `/v1/discounts/validate`. Contact-us and
reservation submission use:

- `/v1/contact-us`
- `/v1/reservations`
Use Cloudflare Turnstile test key `1x00000000000000000000AA` for local-only
testing.
Set `NEXT_PUBLIC_ASSET_SHARE_BASE_URL` to the media/share base URL used by the
media download redirect pages (for example `https://media.evolvesprouts.com`).

## Build

```bash
npm run build
```

The static output is generated in `out/`.

## Routing + SEO

- Canonical English lives at `/en/`.
- Root `/` and legacy non-localized routes (for example `/about-us`) redirect
  to localized `/en/...` paths.
- `sitemap.xml` and `robots.txt` are generated at build time.

## Crawl policy

- Production is indexable.
- Staging is non-indexable via CloudFront `X-Robots-Tag` headers and a deploy
  step that applies a deny-all `robots.txt`.
