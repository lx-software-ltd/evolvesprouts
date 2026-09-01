# Marketing & Analytics Stack

This document describes the marketing, analytics, and advertising tools used
by Evolve Sprouts, how they relate to the codebase, and the operational
processes around them.

## Stack overview

```
                    ┌───────────────────────────────────────────┐
                    │            www.evolvesprouts.com           │
                    │         (Next.js static export)           │
                    │          apps/public_www/                  │
                    └──────────────┬────────────────────────────┘
                                   │
                         init-gtm.js loads GTM
                                   │
                    ┌──────────────▼────────────────────────────┐
                    │      Google Tag Manager (GTM)              │
                    │      Container: GTM-NJ2LB39H              │
                    │      Account: 6340608406                   │
                    └──────┬───────────────────┬────────────────┘
                           │                   │
              Google Tag   │                   │   Google Tag
              G-YJTWSCB01P │                   │   AW-18019068393
                           │                   │
                    ┌──────▼──────┐     ┌──────▼──────┐
                    │    GA4      │     │ Google Ads   │
                    │  Property   │────▶│  Account     │
                    │  525520074  │     │ 499-114-4901 │
                    └──────┬──────┘     └──────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
     ┌────────▼──┐  ┌──────▼──┐  ┌──────▼──────┐
     │  Search   │  │ Custom  │  │   Key       │
     │  Console  │  │ Dims    │  │   Events    │
     │  (linked) │  │ (12)    │  │   (7)       │
     └───────────┘  └─────────┘  └─────────────┘
```

## Google Cloud Platform (GCP)

### Service account

- **Email**: `ga4-reader@evolve-sprouts.iam.gserviceaccount.com`
- **Project**: `evolve-sprouts`
- **Credential storage**: Cursor Cloud Agent secret
  `EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON`
- **Default permissions**: Read-only across all services. Write access is
  elevated on an ad hoc basis when configuration changes are needed, then
  revoked back to read-only.

### What the service account can access

| Service | Default access | Elevated access (ad hoc) |
|---|---|---|
| GA4 Admin API | Reader | Editor — create/update custom dimensions, key events, data retention |
| GA4 Data API | Reader | (same) — query reports, pull session/event/user data |
| GTM API | Read | Admin + Publish — create/update/delete tags, triggers, variables; publish versions |
| Google Ads API | Explorer (read) | Standard — create/modify campaigns, keywords, ads, conversions |

To elevate access for a configuration session, grant the service account
the required role in the relevant tool's admin panel, then revoke after
changes are complete.

## Google Tag Manager (GTM)

### Container details

| Field | Value |
|---|---|
| Account ID | `6340608406` |
| Container ID | `244310102` |
| Public ID | `GTM-NJ2LB39H` |
| Container name | `www.evolvesprouts.com` |

### How GTM loads on the website

1. Root layout (`apps/public_www/src/app/layout.tsx`) sets `data-gtm-id` and
   `data-gtm-allowed-hosts` on the `<html>` element when `NEXT_PUBLIC_GTM_ID`
   is configured.
2. `GoogleTagManager` component (`src/components/shared/google-tag-manager.tsx`)
   renders a `<script>` tag pointing to `public/scripts/init-gtm.js`.
3. `init-gtm.js` reads `data-gtm-id` and `data-gtm-allowed-hosts` from the
   document, verifies the current host is allowed, and loads
   `googletagmanager.com/gtm.js`.
4. CSP injection (`scripts/inject-csp-meta.mjs`) automatically adds GTM and
   GA4 origins to `script-src` and `connect-src` when GTM is detected in the
   built HTML.

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_GTM_ID` | GTM container ID (`GTM-NJ2LB39H`). If unset, GTM does not load. |
| `NEXT_PUBLIC_GTM_ALLOWED_HOSTS` | Comma-separated hostnames where GTM is allowed to fire. Falls back to `NEXT_PUBLIC_SITE_ORIGIN` hostname. |

### Live container contents (version 9)

| Component | Count | Details |
|---|---|---|
| Google Tags | 2 | `GA4 - Configuration` (G-YJTWSCB01P), `Google Ads - Conversion Tracking` (AW-18019068393) |
| GA4 Event Tags | 20 | One per custom event in the analytics taxonomy |
| Custom Event Triggers | 20 | One per custom event |
| Data Layer Variables | 14 | All event parameters from the taxonomy |
| Consent Default | 1 | Custom HTML tag setting default consent state |

### Event tracking in the codebase

All custom events are fired through a single function:

```
trackAnalyticsEvent(eventName, { sectionId, ctaLocation, params })
```

- **Source**: `apps/public_www/src/lib/analytics.ts`
- **Taxonomy contract**: `apps/public_www/src/lib/analytics-taxonomy.json`
- **Validation**: `npm run validate:analytics-contract` (enforced in lint)
- **Governance**: `npm run validate:analytics-governance` (enforced in PRs)

The function pushes typed payloads to `window.dataLayer`. GTM picks these up
via custom event triggers and forwards them to GA4 through the event tags.

Components that fire events:

| Component | Events |
|---|---|
| `whatsapp-contact-button.tsx` | `whatsapp_click` |
| `contact-us-form.tsx` | `contact_form_submit_attempt`, `_success`, `_error` |
| `media-form.tsx` | `media_form_open`, `_submit_success`, `_submit_error` |
| `sprouts-squad-community.tsx` | `community_signup_submit_success`, `_error` |
| `event-notification.tsx` | `community_signup_submit_success`, `_error` |
| `my-best-auntie-booking.tsx` | `booking_modal_open`, `booking_age_selected`, `booking_date_selected`, `booking_confirm_pay_click` |
| `reservation-form.tsx` | `booking_payment_method_selected`, `booking_discount_apply_*`, `booking_submit_*` |
| `thank-you-modal.tsx` | `booking_thank_you_view`, `booking_thank_you_ics_download` |

## Google Analytics 4 (GA4)

### Property details

| Field | Value |
|---|---|
| Account | Evolve Sprouts (`329053801`) |
| Property | Evolve Sprouts Website (`525520074`) |
| Data stream | Evolve Sprouts Production |
| Measurement ID | `G-YJTWSCB01P` |
| Default URI | `https://www.evolvesprouts.com/` |

### Configuration

| Setting | Value |
|---|---|
| Data retention | 14 months |
| Reset user data on new activity | Yes |
| Google Signals | Enabled |
| Enhanced measurement | All features ON (scrolls, outbound clicks, site search, video, file downloads, page changes, form interactions) |

### Custom dimensions (12 event-scoped)

`page_locale`, `cta_location`, `section_id`, `discount_type`,
`payment_method`, `form_type`, `cohort_date`, `error_type`, `environment`,
`resource_key`, `service_tier`, `cohort_label`

### Key events (7)

| Event | Source |
|---|---|
| `booking_submit_success` | Custom (from taxonomy) |
| `contact_form_submit_success` | Custom (from taxonomy) |
| `media_form_submit_success` | Custom (from taxonomy) |
| `community_signup_submit_success` | Custom (from taxonomy) |
| `purchase` | Auto-created by Google |
| `close_convert_lead` | Auto-created by Google |
| `qualify_lead` | Auto-created by Google |

### Linked products

| Product | Account/Property |
|---|---|
| Google Ads | `499-114-4901` (Evolve Sprouts) |
| Google Search Console | `https://www.evolvesprouts.com` (URL-prefix property) |

## Google Ads

### Account details

| Field | Value |
|---|---|
| Account ID | `499-114-4901` |
| Account name | Evolve Sprouts |
| Currency | HKD |
| Timezone | Asia/Hong_Kong |
| Billing | Business payment method (approved) |
| Auto-tagging | Enabled |

### Campaign: My Best Auntie — Search — HK

| Setting | Value |
|---|---|
| Type | Search |
| Status | Paused (enable when ready) |
| Budget | HK$50/day |
| Bidding | Manual CPC (HK$20 default bid) |
| Networks | Google Search only (no partners, no display) |
| Location | Hong Kong (presence only) |
| Language | English |

#### Keywords (11)

**Phrase match (8):**
`domestic helper training course hong kong`,
`helper childcare training hong kong`,
`helper training course hk`,
`auntie training course hong kong`,
`montessori helper training hong kong`,
`domestic helper childcare course`,
`train my helper hong kong`,
`helper parenting course hong kong`

**Exact match (3):**
`domestic helper training course hong kong`,
`helper childcare training hong kong`,
`montessori helper training`

#### Negative keywords (10, broad match)

`free`, `job`, `salary`, `agency`, `placement`, `maid`, `cleaning`, `visa`,
`immigration`, `FDH employment`

#### Ads (2 responsive search ads)

Both point to
`https://www.evolvesprouts.com/en/services/my-best-auntie-training-course/`
with 15 headlines and 4 descriptions each, covering brand name, course
features, pricing, and trust signals.

#### Sitelinks (3)

About the Founder, Upcoming Events, Contact Us

#### Conversion actions

| Action | Type | Role |
|---|---|---|
| GA4 - Booking Submit Success | Primary | Drives bidding optimization |
| GA4 - Contact Form Submit Success | Secondary | Observation only |

## Google Search Console

### Property

- **Type**: URL-prefix
- **URL**: `https://www.evolvesprouts.com`
- **Linked to GA4**: Yes

### Sitemap

- **URL**: `https://www.evolvesprouts.com/sitemap.xml`
- **Generated by**: `apps/public_www/src/app/sitemap.ts`
- **Entries**: 21 (7 routes x 3 locales: en, zh-CN, zh-HK)
- **Features**: Per-entry hreflang alternates with `x-default`

### Robots.txt

- **Generated by**: `apps/public_www/src/app/robots.ts`
- **Features**: Disallow rules for redirect-only routes, AI crawler
  allowlists for `/llms.txt` and `/llms-full.txt`

## Email (iCloud Mail with custom domain)

### Setup

| Field | Value |
|---|---|
| Provider | iCloud Mail (Apple iCloud+) |
| Custom domain | `evolvesprouts.com` |
| Primary address | `ida@evolvesprouts.com` |
| Contact address (website) | Configured via `NEXT_PUBLIC_EMAIL` env var |

### How email relates to the codebase

Email is used in two distinct ways:

#### 1. Outbound transactional email (AWS SES)

The backend uses **Amazon SES** (not iCloud) for all automated outbound
email — customer confirmations, internal **sales recaps** to verified emails on
Cognito `ADMIN_GROUP` users (today the admin group), and contact-inquiry notifications to `SUPPORT_EMAIL`. This is configured
in the Lambda environment:

| Variable | Purpose |
|---|---|
| `SES_SENDER_EMAIL` | Verified SES sender address for internal notifications and sales recaps |
| `SUPPORT_EMAIL` | Inbox for full **contact_inquiry** contact-us messages only (admin API Lambda) |

SES is used because iCloud Mail does not provide an SMTP API for
programmatic sending. The SES sender domain must be verified in AWS.

#### 2. Business email (iCloud Mail)

The `ida@evolvesprouts.com` inbox is used for:
- Direct replies to leads and clients
- Receiving forwarded or direct mail as needed (programmatic form alerts go to
  `SUPPORT_EMAIL` for contact inquiries and to Cognito `ADMIN_GROUP` user emails for sales recaps)
- Google account owner email (GA4, GTM, Google Ads, Search Console)
- Domain verification for Google Search Console

iCloud Mail provides the inbox; SES provides the programmatic sending.

### Lead capture flow

All website leads are captured in the database before any email is sent.
The inbox notification is an alert, not the source of truth.

```
Lead sources:
  Contact form ──────▶ API ──▶ DB (contact + sales lead) ──▶ SES sales recap (`ADMIN_GROUP`) + contact_inquiry → SUPPORT_EMAIL ──▶ Mailchimp (opt-in)
  Media download ────▶ API ──▶ DB (contact + sales lead) ──▶ SES sales recap (`ADMIN_GROUP`) ──▶ Mailchimp (rules below)
  Community signup ─▶ /www/v1/contact-us (signup_intent) ──▶ Aurora CRM ──▶ SES hook ──▶ Mailchimp
  Event notification ▶ /www/v1/contact-us (signup_intent) ──▶ Aurora CRM ──▶ SES hook ──▶ Mailchimp
  Booking ───────────▶ API ──▶ DB (contact + reservation) ─▶ SES sales recap (`ADMIN_GROUP`) ──▶ Mailchimp (opt-in)

  WhatsApp DMs ──────▶ Cloud API webhook `/v1/whatsapp/webhook` ──▶ DB (conversation + contact + sales lead)
  LinkedIn DMs ──────▶ Manual entry (redirect to trackable channel)
  Direct email ──────▶ Manual (rare, handle case-by-case)
```

Public website Mailchimp **audience tags** (applied via `add_subscriber_with_tag`):

| Flow | Mailchimp tag |
|------|----------------|
| Contact form + marketing opt-in | `public-www-contact-inquiry` |
| Sprouts Squad / monthly newsletter (email + marketing checkbox) | `public-www-community-newsletter` (when `marketing_opt_in`) |
| Events “get notified” (email + marketing checkbox) | `public-www-event-notification` (when `marketing_opt_in`) |
| Booking + marketing opt-in | `public-www-booking-customer-{service_instance_slug}` (`serviceInstanceSlug` from reservation JSON; fallback `unknown`) |
| Free intro call booking + marketing opt-in | `public-www-intro-call-booking` (when `bookingSystem` is `intro-call-booking`) |

Meta Pixel `content_name` for this funnel uses **snake_case** (`public_www_free_intro_call`) to match GA4 custom parameters and `PIXEL_CONTENT_NAME` in `apps/public_www/src/lib/meta-pixel-taxonomy.ts`. Prefer this convention for new pixels; avoid switching existing dashboards to kebab-case unless Meta Ads owners explicitly require it.
| Free guide / media | `public-www-media-{resource_key}` |

Legacy `contact-us-inquiry`, `booking-customer`, and `public-www-media-{key}-requested` may still exist on historical members; use dual-match segments in Mailchimp during transition.

## Social media and lead generation

### Meta (Instagram + WhatsApp + Pixel)

- **Instagram**: `@evolvesprouts` — primary social channel for brand
  awareness and engagement
- **WhatsApp Business**: Used for direct lead communication; linked from
  website CTAs via `NEXT_PUBLIC_WHATSAPP_URL`
- **Integration with website**:
  - WhatsApp floating button and CTA links throughout the site use prefilled
    messages configured in locale content files. The
    `buildWhatsappPrefilledHref` function in
    `apps/public_www/src/lib/site-config.ts` handles URL construction.
  - Footer "Connect on" section includes WhatsApp (primary), Instagram, and
    LinkedIn links with env-driven URLs and `/contact-us` fallbacks.
  - Links hub (`/links`, used as Instagram bio link page) includes Instagram
    follow button (outline variant) and WhatsApp CTA.
  - `buildUtmHref` utility in `site-config.ts` generates UTM-tagged URLs
    for tracking social traffic in GA4. Format:
    `buildUtmHref(url, { source: 'instagram', medium: 'social', campaign: 'organic' })`

#### Meta Pixel

The Meta Pixel is loaded on the website for conversion tracking, retargeting
audiences, and measuring Instagram/Facebook ad performance.

##### How Meta Pixel loads on the website

1. Root layout (`apps/public_www/src/app/layout.tsx`) sets
   `data-meta-pixel-id` and `data-meta-pixel-allowed-hosts` on the `<html>`
   element when `NEXT_PUBLIC_META_PIXEL_ID` is configured.
2. `MetaPixel` component (`src/components/shared/meta-pixel.tsx`) renders a
   `<script>` tag pointing to `public/scripts/init-meta-pixel.js`.
3. `init-meta-pixel.js` reads `data-meta-pixel-id` and
   `data-meta-pixel-allowed-hosts` from the document, verifies the current
   host is allowed, and loads `connect.facebook.net/en_US/fbevents.js`.
4. On load, the pixel fires `fbq('init', pixelId)` and
   `fbq('track', 'PageView')` automatically.
5. CSP injection (`scripts/inject-csp-meta.mjs`) automatically adds
   `connect.facebook.net` to `script-src` and `www.facebook.com` to
   `connect-src` when Meta Pixel is detected in the built HTML.

##### Meta Pixel conversion events

Components fire Meta Pixel standard events alongside the existing GA4/GTM
analytics events using `trackMetaPixelEvent` from `src/lib/meta-pixel.ts`:

| Component | GA4 Event | Meta Pixel Event | Params |
|---|---|---|---|
| `contact-us-form.tsx` | `contact_form_submit_success` | `Lead` | `content_name: 'contact_form'` |
| `media-form.tsx` | `media_form_submit_success` | `Lead` | `content_name: 'media_download'` |
| `sprouts-squad-community.tsx` | `community_signup_submit_success` | `Lead` | `content_name: 'community_signup'` |
| `event-notification.tsx` | `community_signup_submit_success` | `Lead` | `content_name: 'event_notification'` |
| `my-best-auntie-booking.tsx` | `booking_modal_open` | `InitiateCheckout` | `content_name: 'my_best_auntie'` |
| `events.tsx` | `booking_modal_open` | `InitiateCheckout` | `content_name: 'my_best_auntie'` or `'event_booking'` |
| `reservation-form.tsx` | `booking_submit_success` | `Schedule` | `content_name` (prop), `value`, `currency` |
| `landing-page-free-intro-call.tsx` | `booking_submit_success` | `Schedule` | `content_name: 'public_www_free_intro_call'`, `value`, `currency` |
| `whatsapp-contact-button.tsx` | `whatsapp_click` | `Contact` | `content_name: 'whatsapp'` |
| `contact-us-form.tsx` (WhatsApp CTA) | `whatsapp_click` | `Contact` | `content_name: 'whatsapp'` |
| `thank-you-modal.tsx` | (varies) | `Contact` | `content_name: 'whatsapp'` |
| `links-hub.tsx` | `links_hub_click`, `whatsapp_click` | `ViewContent`, `Contact` | `content_name: 'my_best_auntie_course'`, `'contact_us'`, `'events'`, `'whatsapp'`, `'instagram'` |
| `landing-page-booking-cta-action.tsx` | `landing_page_cta_click` | `InitiateCheckout` | `content_name: <landing page slug>` |

Taxonomy and lint: `src/lib/meta-pixel-taxonomy.ts`, `npm run validate:meta-pixel-contract` (part of `npm run lint`).

##### Meta Pixel environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | Meta Pixel ID (numeric). If unset, pixel does not load. |
| `NEXT_PUBLIC_META_PIXEL_ALLOWED_HOSTS` | Comma-separated hostnames where pixel is allowed to fire. Falls back to `NEXT_PUBLIC_SITE_ORIGIN` hostname. |

#### Meta Business account details

| Resource | ID | Details |
|---|---|---|
| Business | `646086474923922` | Evolve Sprouts (verified) |
| System User | `122097039746985174` | cursor-bot (ADMIN) |
| App | `775572428635412` | Evolve Sprouts Biz Platform |
| Facebook Page | `549929634876681` | Evolve Sprouts |
| Instagram Business Account | `17841473004927751` | @evolvesprouts |
| WhatsApp Business Account | `502285879641182` | Evolve Sprouts |
| Ad Account | `act_1562589928493715` | Evolve Sprouts (HKD) |

System user token scopes include: `ads_management`, `ads_read`,
`business_management`, `instagram_basic`, `instagram_manage_insights`,
`instagram_content_publish`, `instagram_manage_comments`,
`instagram_manage_messages`, `pages_read_engagement`, `pages_manage_metadata`,
`pages_messaging`, `whatsapp_business_management`,
`whatsapp_business_messaging`, and others (26 total).

### LinkedIn

- **Company page**: [linkedin.com/company/evolve-sprouts](https://www.linkedin.com/company/evolve-sprouts)
- **Content strategy**: Instagram posts are automatically cross-posted to
  LinkedIn via Zapier
- **Lead capture**: LinkedIn DMs cannot be programmatically forwarded to a
  CRM. LinkedIn's API does not support reading or exporting DMs. The
  recommended workaround is documented below.

### Zapier

- **Current automation**: Instagram post → LinkedIn post (automatic
  cross-posting)

## Mailchimp (email marketing)

### Account details

| Field | Value |
|---|---|
| Server prefix | `us-12` |
| Audience/List ID | `355b40c8b5` |

### How Mailchimp integrates with the codebase

Mailchimp is used for email list management, subscriber tagging, and
sending a monthly newsletter. Subscriber management is automated via
backend Lambda functions. The monthly newsletter is composed and sent
manually through the Mailchimp dashboard.

#### Data flow

```
Website form submit
        │
        ▼
  API Gateway (/v1/assets/free/request or /v1/contact-us)
        │
        ▼
  Admin Lambda (backend/lambda/admin/handler.py)
        │
        ▼
  SNS topic → SQS queue
        │
        ▼
  Media Request Processor Lambda (backend/lambda/media_processor/handler.py)
        │
        ├─▶ Database: upsert contact, create sales lead
        ├─▶ Mailchimp: add/update subscriber + apply tag
        └─▶ SES: send sales recap to verified emails on Cognito `ADMIN_GROUP` users
```

#### Backend code

- **Mailchimp service**: `backend/src/app/services/mailchimp.py`
  - `add_subscriber_with_tag(...)` — upserts a subscriber in the configured
    audience, applies a tag, and optionally sets **merge fields** (e.g. a
    stable **download share URL** for one automation email)
  - Uses `http_invoke` (AWS proxy) to call the Mailchimp API from within
    VPC
  - API key stored in AWS Secrets Manager (`MAILCHIMP_API_SECRET_ARN`)
- **Media processor**: `backend/lambda/media_processor/handler.py`
  - Processes SQS messages from form submissions
  - Ensures an **asset share link** exists for the requested guide, builds
    `https://{asset-download-domain}/v1/assets/email-download/{token}`, and passes it to
    Mailchimp in the merge field named by `MAILCHIMP_MEDIA_DOWNLOAD_MERGE_TAG`
    (CDK parameter; empty until you set it, e.g. `MMDLURL`). Create that **Text**
    merge field in the audience and use `*|MMDLURL|*` (or your tag) in one journey email.
- **Webhook handler**: `backend/src/app/api/public_mailchimp_webhook.py`
  - Receives Mailchimp webhook callbacks at `/v1/mailchimp/webhook`
  - Reconciles contact sync status in the database

#### Lambda environment variables

| Variable | Purpose |
|---|---|
| `MAILCHIMP_API_SECRET_ARN` | AWS Secrets Manager ARN for the Mailchimp API key |
| `MAILCHIMP_LIST_ID` | Mailchimp audience/list ID |
| `MAILCHIMP_SERVER_PREFIX` | Mailchimp data center (e.g., `us-12`) |
| `ASSET_SHARE_LINK_BASE_URL` | HTTPS origin for stable share URLs (media processor; same as asset download domain) |
| `ASSET_SHARE_LINK_DEFAULT_ALLOWED_DOMAINS` | Comma-separated hostnames for new share links (media processor; same as admin) |
| `MAILCHIMP_MEDIA_DOWNLOAD_MERGE_TAG` | Audience merge field **tag** for the download URL (empty disables) |
| `MAILCHIMP_FREE_RESOURCE_JOURNEY_ID` | Customer Journey ID for explicit journey trigger after free-resource sync (empty disables) |
| `MAILCHIMP_FREE_RESOURCE_JOURNEY_STEP_ID` | Journey step ID for the trigger endpoint (empty disables) |

#### Cursor Cloud Agent secrets (for API access outside AWS)

| Secret | Purpose |
|---|---|
| `EVOLVESPROUTS_MAILCHIMP_API_KEY` | Direct API key for Mailchimp (used by Cloud Agents) |
| `EVOLVESPROUTS_MAILCHIMP_AUDIENCE_ID` | Audience ID (`355b40c8b5`) |
| `EVOLVESPROUTS_MAILCHIMP_SERVER_PREFIX` | Server prefix (`us-12`) |

### Subscriber lifecycle

1. User submits a form on the website. **Media download** requests hit API
   Gateway and flow through SNS/SQS to the media processor. **Contact,
   newsletter, and event-notification** captures use `/www/v1/contact-us` (native
   Aurora persistence, then `run_contact_us_post_success` for SES + Mailchimp tags
   from `signup_intent`). **Booking** submissions use `/www/v1/reservations`; after
   persistence, booking confirmation + optional Mailchimp subscribe use
   `public-www-booking-customer-{slug}` from `serviceInstanceSlug` / `service_instance_slug`
   (the public cohort/instance slug).
2. For media: the admin Lambda publishes to SNS, which delivers to the SQS queue.
3. The media processor Lambda picks up the message and:
   - Upserts the contact in the database
   - Creates a sales lead record
   - Calls `add_subscriber_with_tag` to add/update the subscriber in
     Mailchimp with a tag identifying the form source (e.g.,
     `public-www-media-{resource_key}`) and sets the download merge
     field when configured
   - When journey env vars are set, calls the Customer Journey API trigger so
     Mailchimp sends the download email without relying on tag-based automation timing
   - Sends an SES sales recap to all verified emails on Cognito `ADMIN_GROUP` users
     (first lead only; repeat downloads for an existing lead do not send another recap)
4. Mailchimp webhook callbacks (`/v1/mailchimp/webhook`) reconcile
   subscription status changes (unsubscribe, bounce) back to the database.

Repeat submissions for the same contact and guide still **refresh** the Mailchimp
member (merge fields + tag) and **re-trigger** the Customer Journey when journey
env vars are set, so download emails can fire again without creating a second sales lead.

### Monthly newsletter

- Composed and sent manually via the Mailchimp dashboard
- Sent to the full subscriber audience (`355b40c8b5`)
- Content typically includes: upcoming events, course updates, parenting
  tips, and community highlights
- Subscriber tags from automated sign-ups can be used to segment the
  audience for targeted campaigns if needed

## LinkedIn DM lead capture — limitations and workarounds

LinkedIn does not provide API access to direct messages for standard company
pages. The Messaging API is restricted to LinkedIn Recruiter and Sales
Navigator enterprise contracts. This means there is no programmatic way to
forward LinkedIn DMs to a sales CRM.

### Recommended workarounds

1. **Manual triage with a standard response template**: When a DM arrives on
   LinkedIn, respond with a short message directing the lead to a trackable
   channel:
   > "Thanks for reaching out! For the fastest response, please contact us
   > via our website (evolvesprouts.com/en/contact-us) or WhatsApp. We'll
   > get back to you within 24 hours."
   This routes leads into channels that ARE connected to the CRM (contact
   form → CRM API, WhatsApp → manual or Zapier-based CRM entry).

2. **LinkedIn Lead Gen Forms (paid)**: If running LinkedIn Ads in the future,
   Lead Gen Forms capture contact details (name, email, company) directly
   within LinkedIn. These CAN be connected to a CRM via Zapier or the
   LinkedIn Marketing API.

3. **LinkedIn Sales Navigator (enterprise)**: Provides CRM sync
   (Salesforce, HubSpot, Microsoft Dynamics) for InMail and messaging. Only
   viable at scale; not recommended for current business size.

4. **Zapier LinkedIn trigger**: Zapier offers a "New Company Update" trigger
   for LinkedIn but does NOT offer a DM/message trigger. This is a LinkedIn
   API limitation, not a Zapier limitation.

## Account audit (March 2026)

### Instagram Business Account (`@evolvesprouts`)

Audited via Meta Graph API using cursor-bot system user on 2026-03-17.

#### Profile

| Field | Value | Issue |
|---|---|---|
| Display name | Evolve Sprouts \| Ida De Gregorio | OK |
| Followers | 308 | Low; growing slowly |
| Following | 703 | High ratio — consider unfollowing non-strategic accounts |
| Posts | 101 | Good volume |
| Bio | Practical Montessori training for HK families | OK |
| Bio link | `linktr.ee/evolvesproutshk` | **Should be `evolvesprouts.com/en/links`** — Linktree loses analytics, brand consistency, and SEO value |
| Shopping eligibility | Not eligible | N/A for service business |

#### 28-day insights (Feb 17 – Mar 17)

| Metric | Value |
|---|---|
| Profile views | 72 |
| Website link taps | 6 |
| Accounts engaged | 31 |
| Total interactions | 68 |
| Likes | 42, Comments | 2, Shares | 7, Saves | 4 |
| Average daily reach | ~78 (highly variable: 1–1,091) |

#### Follower demographics

- **86% Hong Kong** (264/308) — well-targeted for a local HK business
- **93% Female** — matches target audience (mothers, female caregivers)
- **Top age**: 35-44 F (149, 48%), 25-34 F (54, 17%)

#### Content performance observations

- Reels/video outperform static images (11 likes vs 1-4 average)
- Engagement rate ~1.5% (low for 308 followers)
- Carousel posts with practical tips get highest saves
- Course promotion posts get lower engagement than educational content
- Giveaway post (Dec 2025) was highest engagement: 12 likes, 9 comments

### WhatsApp Business Account

Audited via Meta Graph API using cursor-bot system user on 2026-03-17.

| Field | Value | Issue |
|---|---|---|
| Account name | Evolve Sprouts | OK |
| Account status | APPROVED | OK |
| Phone | *(set via `NEXT_PUBLIC_BUSINESS_PHONE_NUMBER` env var)* | OK |
| Phone API status | **CONNECTED** (coexistence mode, updated 2026-03-17) | Cloud API active alongside WhatsApp Business App |
| Platform type | CLOUD_API | Coexistence with Business App |
| Quality rating | UNKNOWN | Will update as messages are sent |
| Messaging limit | TIER_250 | 250 business-initiated conversations per 24h |
| Official account | No | Green checkmark not obtained |
| Message templates | 3 (all PENDING review) | `welcome_greeting`, `free_intro_invite`, `course_info_followup` |
| Product catalog | **None** | Can now be created via API or Business Suite |

#### Profile description (current)

The current WhatsApp Business profile description is overly casual and doesn't
mention the core product. Recommended replacement (512 char limit):

> Montessori-based helper training & family support in Hong Kong.
>
> 🌱 My Best Auntie — 9-week programme helping domestic helpers care for
> your child (0–6) with confidence and Montessori tools.
>
> We offer:
> • Helper training (group + 1:1)
> • Child–Auntie Habits Reset
> • Prepared Home assessments
> • Parent consultations
>
> Founded by Ida De Gregorio, AMI Montessori-certified.
>
> 📩 Message us for a free intro session!
> 🌐 www.evolvesprouts.com

The description was updated to the recommended text during the Business
Suite connection on 2026-03-17. The `about` field was cleared to a space
during migration. Profile write operations via API return permissions
errors in coexistence mode — profile fields are managed through the
WhatsApp Business App or Business Suite UI.

### Facebook Page

Updated via API on 2026-03-17:

| Field | Before | After |
|---|---|---|
| Website | `http://Evolvesprouts.com/` | `https://www.evolvesprouts.com/` |
| About | Generic description | Montessori-based helper training and family support for Hong Kong families with children aged 0-6. Founded by Ida De Gregorio, AMI Montessori-certified. |
| Followers | 13 | 13 (dormant page — not a priority) |

### WhatsApp catalog / shop

WhatsApp Business supports a product/service catalog browsable within
WhatsApp chats. For Evolve Sprouts, this could list:

- My Best Auntie 0–1 years
- My Best Auntie 1–3 years
- My Best Auntie 3–6 years
- Child–Auntie Habits Reset (1:1)
- Prepared Home Assessment
- Calmer Days Consult (30 min, free)

**Current status**: No catalog exists. The phone is now CONNECTED via
coexistence mode. Catalog can be set up through the WhatsApp Business App,
Meta Commerce Manager, or potentially via the Catalog API
(`catalog_management` scope is available on the system user token).

**Setup steps (manual)**:
1. Open WhatsApp Business App on the business phone
2. Go to Settings > Business Tools > Catalog
3. Add items with: name, description, price (HKD), and a photo
4. Once items are added, customers can browse them by tapping the catalog
   icon in the chat with Evolve Sprouts
5. Optionally, link the catalog to the Facebook Page via Commerce Manager
   for cross-platform visibility

## Improvement opportunities

### Current setup assessment

| Channel | Status | Verdict |
|---|---|---|
| Website SEO | Recently optimized (keyword-aligned titles, meta descriptions, structured data, FAQ schema, hreflang) | Good foundation; needs time for organic ranking to build |
| GTM/GA4 | Fully configured with 22 custom events, 12 dimensions, 7 key events | Solid; monitor for data flow |
| Google Ads | Search campaign live with targeted keywords, proper conversions | Good; optimize after 2-4 weeks of data |
| Google Business Profile | Created and linked to GA4 | Post weekly to maintain activity |
| Instagram → LinkedIn | Automated via Zapier | Works but could be improved (see below) |
| LinkedIn DMs → CRM | No programmatic path | Use redirect-to-trackable-channel workaround |
| Mailchimp | Fully integrated (backend subscriber sync with tags, webhook reconciliation) | Build nurture sequences per tag |
| WhatsApp → CRM | Cloud API webhook on Admin Lambda (`/v1/whatsapp/webhook`, including coexistence `history`); Sales → WhatsApp inbox plus `.txt`/`.zip` export import | Subscribe Meta `messages` + `smb_message_echoes` + `history`; Cloud API cannot GET old chats |
| Instagram DMs → CRM | Meta webhook on Admin Lambda (`/v1/meta/webhook`, `object: instagram`); Sales → Instagram inbox; Graph import of last 20 bodies/thread; skip own profile handle from `NEXT_PUBLIC_INSTAGRAM_URL` | Subscribe Instagram `messages`; `CDK_PARAM_META_PAGE_ACCESS_TOKEN` + `CDK_PARAM_META_PAGE_ID` for history import |
| Messenger DMs → CRM | Meta webhook on Admin Lambda (`/v1/meta/webhook`, `object: page`); Sales → Messenger inbox; Graph import of last 20 bodies/thread | Subscribe Page `messages`; same Graph import as Instagram |

### Potential improvements

1. **Instagram content differentiation for LinkedIn**: Auto-crossposting
   identical content works for consistency but LinkedIn audiences respond
   better to professional/educational framing vs Instagram's visual-first
   approach. Consider having Zapier transform the caption (e.g., add
   hashtags relevant to LinkedIn, remove Instagram-specific ones) or
   manually craft LinkedIn-specific posts for key content.

2. ~~**UTM parameters on social links**~~: **Done.** `buildUtmHref()`
   utility added to `apps/public_www/src/lib/site-config.ts`. Use it to
   generate trackable URLs for links shared on Instagram, LinkedIn, and
   WhatsApp. Format:
   `buildUtmHref(url, { source: 'instagram', medium: 'social', campaign: 'organic' })`

3. ~~**WhatsApp Business API reconnection**~~: **Done.** Cloud API connected
   in coexistence mode on 2026-03-17. Three message templates created
   (`welcome_greeting`, `free_intro_invite`, `course_info_followup`).
   ~~Webhook lead capture~~: **Done** via Admin Lambda `GET`/`POST
   /v1/whatsapp/webhook` (inbound + coexistence echoes) and Sales →
   WhatsApp. Operators still need to subscribe the Meta app to `messages`
   and `smb_message_echoes` and set the CDK webhook secrets.

4. **Retargeting audiences in Google Ads**: Once GA4 has enough traffic
   data (1-2 months), create remarketing audiences for:
   - Course page visitors who didn't book
   - Contact form viewers who didn't submit
   These can be used in Google Ads display/search campaigns.

5. **Mailchimp nurture sequences**: Mailchimp integration is fully
   operational (subscribers are synced with tags from form submissions).
   Consider building automated email nurture sequences in Mailchimp based
   on subscriber tags (e.g., a 3-email drip for `patience-free-guide`
   downloaders, a follow-up sequence for `event-notification` signups
   who haven't booked).

6. **Instagram bio link**: Change from `linktr.ee/evolvesproutshk` to
   `www.evolvesprouts.com/en/links`. The website's `/links` page now
   includes course, contact, events, WhatsApp, and Instagram follow
   buttons. This keeps traffic on the owned domain, enables GA4 tracking,
   and provides a branded experience. Must be done manually in Instagram
   app > Edit Profile > Website.

7. **WhatsApp Business profile description**: Update the description to
   match the professional tone of the website. The recommended replacement
   text is in the "Account audit" section above. Must be done manually in
   the WhatsApp Business App > Business Profile > About.

8. **WhatsApp catalog setup**: Create a product/service catalog in the
   WhatsApp Business App listing courses and consultations. Steps are
   documented in the "WhatsApp catalog / shop" section above.

9. **Instagram Reels strategy**: Audit data shows Reels/video content
   significantly outperforms static images (6-11 likes vs 1-4). Increase
   Reels frequency to at least 1 per week alongside 1-2 static/carousel
   posts.

10. **Instagram following cleanup**: Current 703 following vs 308 followers
    ratio looks inauthentic. Unfollow non-strategic accounts to bring the
    ratio closer to 1:1 or lower.

## Environment variables reference

| Variable | Service | Purpose |
|---|---|---|
| `NEXT_PUBLIC_GTM_ID` | GTM | Container ID. If unset, GTM does not load. |
| `NEXT_PUBLIC_GTM_ALLOWED_HOSTS` | GTM | Host allowlist for GTM firing. |
| `NEXT_PUBLIC_SITE_ORIGIN` | SEO/GTM | Base URL for sitemap, canonicals, metadata, GTM host fallback. |
| `NEXT_PUBLIC_SITEMAP_LASTMOD` | SEO | Optional override for sitemap lastModified dates. |
| `NEXT_PUBLIC_META_PIXEL_ID` | Meta Pixel | Pixel ID (numeric). If unset, pixel does not load. |
| `NEXT_PUBLIC_META_PIXEL_ALLOWED_HOSTS` | Meta Pixel | Host allowlist for pixel firing. |
| `NEXT_PUBLIC_WHATSAPP_URL` | Social | WhatsApp Business link for CTAs. |
| `NEXT_PUBLIC_BUSINESS_PHONE_NUMBER` | Social | Business phone for WhatsApp prefill. |
| `NEXT_PUBLIC_INSTAGRAM_URL` | Social | Instagram profile URL for structured data `sameAs`. |
| `NEXT_PUBLIC_LINKEDIN_URL` | Social | LinkedIn profile URL for structured data `sameAs`. |
| `NEXT_PUBLIC_EMAIL` | Contact | Business contact email. |
| `EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON` | GCP | Service account credentials (GA4, GTM, Ads APIs). |
| `EVOLVESPROUTS_GA4_PROPERTY_ID` | GA4 | GA4 property ID for API queries. |
| `EVOLVESPROUTS_GOOGLE_CLIENT_EMAIL` | GCP | Service account email. |
| `EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN` | Ads | Google Ads API developer token. |
| `EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID` | Ads | Google Ads customer ID. |
| `EVOLVESPROUTS_MAILCHIMP_API_KEY` | Email | Mailchimp API key for signup forms. |
| `EVOLVESPROUTS_MAILCHIMP_AUDIENCE_ID` | Email | Mailchimp audience/list ID. |
| `EVOLVESPROUTS_MAILCHIMP_SERVER_PREFIX` | Email | Mailchimp data center prefix. |
