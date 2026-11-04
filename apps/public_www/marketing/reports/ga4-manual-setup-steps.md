# GA4 Manual Setup Steps

Configuration changes that must be done in the GA4 UI (the Admin API does
not expose these settings).

**GA4 Property**: 525520074 (Evolve Sprouts Website)
**Data Stream**: Evolve Sprouts Production (G-YJTWSCB01P)

---

## 1. Internal Traffic Filter

Filters out developer, agent, and preview traffic from GA4 reports.

### Step 1: Define internal traffic

1. Go to **GA4 Admin** > **Data Collection and Modification** > **Data Streams**
2. Click **Evolve Sprouts Production**
3. Click **Configure Tag Settings** > **Show all**
4. Click **Define Internal Traffic** > **Create**
5. Fill in:
   - **Rule name**: `Developer / Agent Traffic`
   - **traffic_type value**: `internal`
   - **IP addresses**: Add your home/office IP (use "IP address equals" or
     "IP address begins with")
6. Click **Create**

### Step 2: Activate the filter

1. Go to **GA4 Admin** > **Data Collection and Modification** > **Data Filters**
2. Find **Internal Traffic** (it exists by default in testing mode)
3. Click on it and change **Filter state** from **Testing** to **Active**
4. Click **Save**

After activation, sessions from matched IPs will be excluded from all
reports. Allow 24-48 hours for the filter to take full effect.

---

## 2. Funnel Exploration Report

A saved funnel exploration for the booking flow, showing drop-off at each
step.

### Steps to create

1. Go to **GA4** > **Explore** > **Funnel exploration** (or click the +
   button and select "Funnel exploration")
2. Configure the funnel steps:

| Step | Event name | Description |
|---|---|---|
| 1 | `booking_age_selected` | User selects an age group |
| 2 | `booking_date_selected` | User selects a cohort date |
| 3 | `booking_confirm_pay_click` | User clicks "Confirm & Pay" (opens the payment modal) |
| 4 | `booking_payment_method_selected` | User selects payment method in the modal |
| 5 | `booking_submit_success` | Booking submitted successfully |

The UI flow is: age selector → date selector → "Confirm & Pay" button →
payment modal opens → payment method → form fields → submit. The
`booking_modal_open` event fires alongside `booking_confirm_pay_click`
when the user clicks "Confirm & Pay", so it's redundant as a funnel step.

3. Set **Funnel type** to **Open** (allows users to enter at any step)
4. Add **Breakdown** dimension: `sessionSource` (to see which traffic
   sources produce the most bookings)
5. Set the date range to "Last 30 days"
6. Click the **Save** icon and name it: `Booking Funnel`

### What to look for

- **Drop-off between steps 2 and 3**: Users who select a date but don't
  click "Confirm & Pay" may be hesitant about pricing or want more
  information before committing.
- **Drop-off between steps 3 and 4**: Users who open the payment modal
  but don't select a payment method are abandoning at the reservation
  form. This is where the one known prospect dropped off (March 17).
- **Drop-off between steps 4 and 5**: Users who select payment but don't
  submit may have issues with the form, captcha, or payment instructions.

---

## 3. Payment Provider Referral Exclusion

Prevents payment provider domains from appearing as traffic sources when
users return from an external payment page.

### Current payment flow

The booking form uses **FPS QR code** and **bank transfer** — both are
offline payment methods that don't redirect to an external payment page.
Therefore, **no referral exclusion is currently needed**.

If a future payment integration (e.g., Stripe, PayMe online) redirects
users to an external domain and back, add that domain here:

1. Go to **GA4 Admin** > **Data Streams** > **Evolve Sprouts Production**
2. Click **Configure Tag Settings** > **Show all**
3. Click **List Unwanted Referrals**
4. Add the payment provider domain (e.g., `stripe.com`, `payme.hsbc.com.hk`)
5. Click **Save**

This prevents the returning session from being attributed to the payment
provider as a new referral source.

---

## 4. Custom Dimensions and Metrics

Custom event parameters must be registered in GA4 before they appear in
reports and explorations. The website pushes the following custom
parameters via `dataLayer` events (see `src/lib/analytics-taxonomy.json`):

### Custom dimensions (event-scoped)

| Parameter name   | Display name       | Purpose |
|------------------|--------------------|---------|
| `section_id`     | Section ID         | UI section where the event fired (e.g. `consultations-booking`, `my-best-auntie-booking`, `events-booking`). **Primary discriminator** for telling booking flows apart. |
| `cta_location`   | CTA Location       | Specific CTA trigger within the section. |
| `page_locale`    | Page Locale        | Locale of the page at event time (e.g. `en`, `zh-HK`). |
| `environment`    | Environment        | `prod` or `staging`. |
| `form_type`      | Form Type          | Contact or signup form variant. |
| `error_type`     | Error Type         | Error classification for failed submissions. |
| `resource_key`   | Resource Key       | Identifier for the downloadable media guide. |
| `service_tier`   | Service Tier       | Selected service tier label for booking events. |
| `cohort_label`   | Cohort Label       | Selected cohort / date label for bookings. |
| `cohort_date`    | Cohort Date        | Cohort start date (YYYY-MM-DD). |
| `is_fully_booked`| Is Fully Booked    | Whether the selected cohort is fully booked. |
| `payment_method` | Payment Method     | Selected payment method (fps_qr, bank_transfer, etc.). |
| `discount_type`  | Discount Type      | Type of discount applied. |
| `landing_page_slug` | Landing Page Slug | URL slug of the landing page. |
| `content_name`   | Content Name       | Name of the content item clicked (links hub). |

### Custom metrics (event-scoped)

| Parameter name   | Display name       | Unit     |
|------------------|--------------------|----------|
| `total_amount`   | Total Amount       | Currency |
| `discount_amount`| Discount Amount    | Standard |

### Automated registration

Run the Admin API script to register all dimensions and metrics:

```bash
python3 marketing/scripts/ga4-create-custom-dimensions.py
```

The script reads `analytics-taxonomy.json`, skips GA4 auto-collected
parameters (`page_path`, `page_title`), and creates any missing custom
dimensions/metrics. It is idempotent (safe to re-run).

Requires `EVOLVESPROUTS_GA4_PROPERTY_ID` and
`EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON` environment variables and
temporary Editor access on the GA4 property.

### Distinguishing booking flows in GA4

The `section_id` dimension is the key differentiator for all booking
events (`booking_modal_open`, `booking_submit_success`,
`booking_thank_you_view`, etc.):

| Booking flow     | `section_id` value        |
|------------------|---------------------------|
| Consultations    | `consultations-booking`   |
| My Best Auntie   | `my-best-auntie-booking`  |
| Events           | `events-booking`          |
| Landing pages    | varies per page slug      |

Use `section_id` as a breakdown dimension in funnel explorations and
standard reports to see consultations vs MBA vs events conversions.

---

## 5. GTM eCommerce Tags (for new eCommerce events)

The codebase now pushes GA4 eCommerce events (`begin_checkout`,
`add_payment_info`, `purchase`) to the dataLayer. GTM needs corresponding
tags to forward these to GA4.

### Option A: Use the existing GA4 Configuration tag

If the GA4 Configuration tag (G-YJTWSCB01P) is set to "Send all events",
eCommerce events will be forwarded automatically. Check:

1. Open **GTM** > **Tags** > **GA4 - Configuration**
2. Verify it sends eCommerce data (or has "Send all" enabled)

### Option B: Create dedicated eCommerce event tags

If the GA4 tag uses explicit event triggers:

1. **Create triggers** for each eCommerce event:
   - Trigger: Custom Event = `begin_checkout`
   - Trigger: Custom Event = `add_payment_info`
   - Trigger: Custom Event = `purchase`

2. **Create GA4 Event tags** for each:
   - Tag type: Google Analytics: GA4 Event
   - Measurement ID: G-YJTWSCB01P
   - Event name: (match the trigger)
   - Check "Send Ecommerce data" in the tag configuration

3. **Publish** the GTM container

---

## 6. Key events — `booking_confirm_pay_click` and `whatsapp_click`

**Status: DONE via API on 2026-04-17** (see
`scripts/apply/ga4-mark-key-events.py`).

Both `booking_confirm_pay_click` and `whatsapp_click` are now registered
as GA4 Key Events. The `analytics-taxonomy.json` contract flag
(`booking_confirm_pay_click.ga4KeyEvent = true`) matches the live GA4
property. Google Ads auto-synced both within seconds and they are now
**ENABLED (Secondary)** conversion actions in the account.

To re-verify or roll forward after adding more key events:

```bash
python3 scripts/apply/ga4-mark-key-events.py --dry-run
python3 scripts/apply/ga4-mark-key-events.py --apply
```

The script is idempotent and requires temporary Editor access on the
GA4 property.

## 7. Enable `Purchase`, `AddPaymentInfo`, and `CompleteRegistration` on the Meta Pixel

**Why**: this PR landed the code change that fires these three Pixel
events. Verify receipt on the Meta side:

1. **Meta Events Manager → Data Sources → Pixel → Overview**. Wait 24
   hours after deploy.
2. Confirm `Purchase`, `AddPaymentInfo`, `CompleteRegistration` appear
   under **Received events**. The booking flow sends
   `Purchase` (currency HKD, value = booking total) on
   `booking_submit_success`, `AddPaymentInfo` on
   `booking_confirm_pay_click`, and `CompleteRegistration` on
   `community_signup_submit_success`.
3. See `meta-ads-manual-setup-steps.md` §3 for the full Meta-side
   checklist.

## 8. Enable Consent Mode v2 + Enhanced Measurement

**Why**: overall bounce rate of 87.4% is inflated by consent-denied
users firing page_view and never firing interaction events.

### 8a. Enhanced Measurement

**Status: already fully enabled on the live property** (verified
2026-04-17 via the Admin API — `stream_enabled=True` and every sub-flag
`scrolls_enabled`, `outbound_clicks_enabled`, `site_search_enabled`,
`video_engagement_enabled`, `file_downloads_enabled`,
`form_interactions_enabled`, `page_changes_enabled` is `True`). No
action needed — the 87.4% bounce is not a measurement-coverage issue.

If a future change disables one of these, flip them back via
**Admin → Data Streams → Evolve Sprouts Production → Enhanced
measurement** (gear icon next to the slider).

### 8b. Consent Mode v2

1. Implement a **cookie-consent banner** that calls
   `gtag('consent','update', { ad_storage, ad_user_data,
   ad_personalization, analytics_storage })` before any GA4/Pixel
   events fire. (Scope note: this is a second code PR — NOT landed in
   this branch.)
2. **Admin → Data Streams → Evolve Sprouts Production → Configure Tag
   Settings → Show all → Consent settings**. Turn on
   **Conversion modelling for consent mode**.

## 9. Create and link GA4 Audiences

**Status: audiences already exist** (verified 2026-04-17): the
property already has `Course Page Visitors`, `Booking Intent - Did
Not Complete`, and `High-Engagement Visitors` (plus `All Users` and
`Purchasers`). Re-running `python3 scripts/ga4-create-audiences.py`
now prints "already exists, skipping" for all three.

What still needs UI verification:

1. **GA4 Admin → Product Links → Google Ads links** — verify the link
   to the Google Ads account (MCC `544-581-2170` / CID `499-114-4901`)
   shows **Status: Linked** and **Personalized advertising: Enabled**.
   This is required for the audiences to populate in Google Ads
   Audience Manager.
2. **GA4 Admin → Audiences**: confirm each audience shows
   "Active users — Last 7 days" > 0. Populations are updated daily; a
   brand-new audience can take up to 48 h to first populate.

## 10. Fix the no-locale / tokenised landing pages

**Why**: the Apr 17 assessment shows 22 sessions on landing page
`(not set)`, 7 on `/ZWFzdGVyLT` (truncated base64), 10 on
`/easter-2026-...` without `/en`, 7 on
`/my-best-auntie-training-course` without `/en`. All 100%-bounce,
confusing the paid-traffic reports.

This needs an infra-level redirect layer. The public site is a static
export served from S3 through CloudFront, so Next.js `redirects` in
`next.config.ts` will not run. Two options:

### 10a. CloudFront Function (preferred, IaC)

Open a separate infra PR that extends
`backend/infrastructure/lib/public-www-stack.ts`
`PathRewriteFunction` (viewer-request) to issue 308 redirects for:

| From | To |
|---|---|
| `/easter-2026-montessori-play-coaching-workshop` | `/en/easter-2026-montessori-play-coaching-workshop/` |
| `/my-best-auntie-training-course` | `/en/services/my-best-auntie-training-course/` |
| `/ZWFzdGVyLT*` (prefix) | `/en/easter-2026-montessori-play-coaching-workshop/` |

Return 308 (permanent) with `Location` header. Do NOT touch the
existing allowlist functions.

### 10b. Interim: add redirects in the Next.js app

Since the current app is `output: 'export'`, the static HTML can
include a `<meta http-equiv="refresh">` page at the old paths. This
is a code PR, not part of the current branch.

## 11. Tag dark-social sources with UTMs

**Why**: `(direct)/(none)` = 284 sessions, 2 conversions untagged.

- [ ] Instagram bio link → append
      `?utm_source=instagram&utm_medium=bio&utm_campaign=evergreen`.
- [ ] Mailchimp campaigns → default UTM template at
      **Account → Settings → Details** (Mailchimp adds them to every
      outbound link automatically).
- [ ] WhatsApp broadcast links → append
      `?utm_source=whatsapp&utm_medium=chat&utm_campaign=<purpose>`.
- [ ] `/links` and `/en/links` outbound buttons → each gets a unique
      `utm_content` matching the button label (kebab-case).
- [ ] Any blog / LinkedIn / guest-post links we share → UTM before
      posting.

Follow the convention documented in
`apps/public_www/marketing/README.md`.


## 12. Google Signals and the Google Ads audience export (2026-11-04)

**Why**: The GA4 audiences (`Course Page Visitors`, `Booking Intent —
Did Not Complete`, etc.) appear in Google Ads with a search-network
size of **0**, so they cannot be used for targeting or observation.
The Admin API shows the audiences exist and the Ads link has
`adsPersonalizationEnabled = true`. The blocker is that **Google
Signals is DISABLED** on property `525520074`: without it GA4 will not
export audiences to Google Ads search inventory.

This is a privacy decision, not a bug, so it is left to a human.

### 12a. Decide

Turning on Google Signals means GA4 collects signed-in Google user
data for cross-device reporting and remarketing. It requires:

- [ ] A privacy-policy update disclosing Google Signals / remarketing
      and linking to Google's ad settings page.
- [ ] Consent Mode v2 in place so `ad_user_data` and
      `ad_personalization` are honoured for EU/UK visitors. See §3.

If the answer is "not now", skip to 12c and rely on the Google Ads
native remarketing tag instead (no Signals needed).

### 12b. Enable (if approved)

- [ ] **GA4 → Admin → Data collection and modification → Data
      collection → Google signals data collection → Turn on**.
- [ ] Leave "Granular location and device data collection" on.
- [ ] Wait 24–48 h, then check **Google Ads → Tools → Audience
      manager → Your data segments**. The GA4 audiences should show a
      non-zero search size (they need ≥ 1,000 active users in 30 days
      to serve on Search).
- [ ] Only then add them as Observation on the two search campaigns
      (see `google-ads-manual-setup-steps.md` §7, step 9).

### 12c. Alternative: Google Ads remarketing tag

If Signals stays off, create the audience inside Google Ads:

- [ ] **Google Ads → Tools → Data manager → Google tag → Remarketing →
      On**.
- [ ] Create a "Website visitors: course page" segment with URL
      contains `my-best-auntie-training-course` OR
      `helper-training-hong-kong`.
- [ ] This needs the Google Ads tag (`AW-…`) on the site, which is
      **not** currently installed; it is a code change in
      `apps/public_www` and should ship behind the same consent gate
      as GA4.

### 12d. Second Google Ads link

The property has two Google Ads links. One is the managed account;
the other customer ID is not in the MCC.

- [ ] **GA4 → Admin → Product links → Google Ads links**. Confirm who
      owns the second customer ID. Delete the link if nobody does.
