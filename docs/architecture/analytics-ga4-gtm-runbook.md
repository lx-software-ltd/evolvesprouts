# GA4 + GTM Analytics Runbook (Public Website)

This runbook defines a practical GA4/GTM setup for the current public website
flows and provides a step-by-step implementation guide.

## Scope

Applies to `apps/public_www` and current user journeys:

- Contact form (`POST /v1/contact-us`)
- Media request form (`POST /v1/assets/free/request`)
- Community / event signup forms (`POST /v1/contact-us` with prefilled message)
- My Best Auntie booking flow (`POST /v1/reservations`)
- Free intro-call booking (`/book-a-free-call`: slot picker + reservation; reuses `booking_submit_*` and eCommerce `purchase` with `payment_method: free`, plus intro-call-specific events below)
- WhatsApp CTAs (floating and section-level)

### Admin console (optional)

The Next.js admin app (`apps/admin_web`) can load a **separate** GTM container when
`NEXT_PUBLIC_ADMIN_GTM_CONTAINER_ID` is set. `trackAdminAnalyticsEvent()` in
`apps/admin_web/src/lib/admin-analytics.ts` pushes the same core `dataLayer` keys as
public_www (`page_path`, `page_title`, `page_locale`, `section_id`, `cta_location`,
`environment`) plus `app_surface: 'admin'` for downstream filtering.

Stable **`admin_*` namespace** events used today:

| Event | Trigger | Notes |
|---|---|---|
| `admin_referral_qr_opened` | Referral QR dialog opens | Optional `service_key` |
| `admin_referral_qr_downloaded` | Download referral PNG | `service_key`, `png_size_px` |
| `admin_public_page_qr_opened` | Website → public page QR screen: valid URL shown | `public_site_path`, `locale` |
| `admin_public_page_qr_downloaded` | Download public page PNG | `public_site_path`, `locale`, `png_size_px` |
| `admin_booking_link_opened` | Services instance booking-link dialog opens with a URL | `service_key`, `locale`, `service_tier` |
| `admin_booking_link_copied` | Copy booking link in that dialog | `service_key`, `locale`, `service_tier` |
| `admin_booking_link_qr_downloaded` | Download booking-link QR PNG | `service_key`, `locale`, `service_tier`, `png_size_px` |

## Tracking architecture

- Delivery mechanism: **Google Tag Manager** (`NEXT_PUBLIC_GTM_ID`)
- Runtime firing gate: `NEXT_PUBLIC_GTM_ALLOWED_HOSTS` (or fallback to host from
  `NEXT_PUBLIC_SITE_ORIGIN`)
- Analytics destination: **GA4 property + web stream**
- Principle: no hardcoded GA4 event plumbing in business components unless
  needed for precision; use GTM where possible and keep naming centralized.

## Event taxonomy (v1)

Canonical machine-readable contract:

- `apps/public_www/src/lib/analytics-taxonomy.json`
### Naming rules

- Event names: `lower_snake_case`, verb-first
- Parameter names: `lower_snake_case`
- Never send PII (no email, phone, full name, free-text message)

### Cross-form parameters

- **`form_kind`**: coarse category for joins across funnels — `contact`, `media_request`,
  `community`, or `reservation`. Sent on form lifecycle events (see catalog below).
- **`form_id`**: optional stable id for a specific form *instance* (orthogonal to
  `section_id`, which describes on-page placement). In code, `trackPublicFormOutcome`
  always applies `formKind` / `formId` after caller `params` so option values win
  over any duplicate keys in `params`.

### `error_type` values (forms)

Use coarse categories only (no field names or user input):

- `api_error` — server/API failure after request
- `service_unavailable` — client or captcha/config unavailable
- `payment_error` — Stripe confirmation failed
- `invalid_code` — discount code validation
- `validation_error` — client-side validation failed before a network call

### `booking_submit_error` required keys vs empty values

The contract requires these custom params on every `booking_submit_error` hit:
`payment_method`, `service_tier`, `cohort_date`, `total_amount`, `error_type` (plus
`form_kind` from `trackPublicFormOutcome`). **Keys must always be present** so GTM
variables and downstream joins stay stable. On early-abort paths
(`service_unavailable`, `validation_error`, or `payment_error` before full state),
**empty string (`""`) is a valid value** for any of the booking context fields when
the UI has not collected or resolved that value yet. This is intentional, not a
data bug.

### Common parameters (send with every custom event)

- `page_path`
- `page_title`
- `page_locale`
- `section_id`
- `cta_location`
- `environment`

### Event catalog

| Event | Trigger | Required params | Key event |
|---|---|---|---|
| `whatsapp_click` | WhatsApp CTA click | `section_id`, `cta_location` | No |
| `contact_form_submit_attempt` | Contact form submit attempt | `section_id`, `form_type`, `form_kind` | No |
| `contact_form_submit_success` | `/v1/contact-us` success | `section_id`, `form_type`, `form_kind` | Yes |
| `contact_form_submit_error` | Contact validation/API error | `section_id`, `form_type`, `form_kind`, `error_type` | No |
| `media_form_open` | Media CTA expands form | `section_id`, `form_kind`, `resource_key` | No |
| `media_form_submit_attempt` | User submits media form (before field/captcha validation) | `section_id`, `form_kind`, `resource_key` | No |
| `media_form_submit_success` | `/v1/assets/free/request` success | `section_id`, `form_kind`, `resource_key` | Yes |
| `media_form_submit_error` | Media validation/API error | `section_id`, `form_kind`, `resource_key`, `error_type` | No |
| `community_signup_submit_attempt` | Community signup submit attempt | `section_id`, `form_type`, `form_kind` | No |
| `community_signup_submit_success` | Sprouts/Event signup success | `section_id`, `form_type`, `form_kind` | Yes |
| `community_signup_submit_error` | Sprouts/Event signup error | `section_id`, `form_type`, `form_kind`, `error_type` | No |
| `booking_modal_open` | Booking modal opens | `section_id='my-best-auntie-booking'`, `service_tier`, `cohort_label` | No |
| `booking_age_selected` | Age option selected | `section_id`, `service_tier` | No |
| `booking_date_selected` | Date/cohort selected | `section_id`, `service_tier`, `cohort_label`, `is_fully_booked` | No |
| `booking_confirm_pay_click` | Confirm-and-pay CTA click | `section_id`, `service_tier`, `cohort_label`, `total_amount` | Yes |
| `booking_share_link_copied` | Copy link in the My Best Auntie confirm-and-pay modal | `section_id`, `service_tier`, `cohort_label` | No |
| `booking_payment_method_selected` | Payment method switch | `section_id`, `payment_method` | No |
| `booking_discount_apply_success` | Discount code valid | `section_id`, `discount_type`, `discount_amount` | No |
| `booking_discount_apply_error` | Discount code invalid/error | `section_id`, `error_type` | No |
| `booking_discount_autoapply_success` | Referral / URL-prefilled discount applied successfully (same semantics as manual apply; distinct event for funnel analysis) | `section_id`, `discount_type`, `discount_amount` | No |
| `booking_discount_autoapply_error` | Referral / URL-prefilled discount failed (invalid code, API, or unavailable client) | `section_id`, `error_type` | No |
| `booking_submit_attempt` | Reservation form submit invoked (before validation, API, or Stripe) | `section_id`, `form_kind`, `payment_method`, `service_tier`, `cohort_date`, `total_amount`; optional `cohort_label`, `discount_amount`, `discount_type` when a discount applies. For zero-total (free) bookings, `payment_method` is `free` and `total_amount` is `0`. | No |
| `booking_submit_success` | `/v1/reservations` success | `section_id`, `form_kind`, `payment_method`, `total_amount`, `service_tier`, `cohort_date`. For free bookings, `payment_method` is `free`. | Yes |
| `booking_submit_error` | Reservation validation, Stripe, or API error | `section_id`, `form_kind`, `payment_method`, `service_tier`, `cohort_date`, `total_amount`, `error_type` | No |
| `booking_thank_you_view` | Thank-you modal shown | `section_id`, `payment_method`, `total_amount` | No |
| `booking_thank_you_ics_download` | Thank-you modal calendar (.ics) download | `section_id`, `cohort_date`, `total_amount` | No |
| `landing_page_cta_click` | Landing page primary CTA click | `section_id='landing-page-cta'`, `landing_page_slug` | No |
| `intro_call_slot_selected` | User selects a 15-minute intro-call slot in the picker | Optional `slot_start` (ISO start instant) | No |
| `intro_call_slot_picker_status_change` | Intro-call slot fetch lifecycle (`idle` / `loading` / `ready` / `error`) | Optional `status` | No |
| `book_free_call_click` | Intro-call landing post-success or help CTAs (e.g. WhatsApp help link) | Optional `cta_location` (string discriminator) | No |
| `links_hub_click` | Link-in-bio hub button click | `section_id='links-hub'`, `content_name` | No |

### GA4 eCommerce events

Standard GA4 eCommerce events are fired alongside the custom booking events
above. These use a separate `trackEcommerceEvent()` function that pushes
structured `ecommerce` objects to the dataLayer.

| eCommerce event | Fired alongside | Data |
|---|---|---|
| `begin_checkout` | `booking_modal_open` | `currency`, `value`, `items[]` |
| `add_payment_info` | `booking_payment_method_selected` | `currency`, `value`, `payment_type`, `items[]` |
| `purchase` | `booking_submit_success` | `currency`, `value`, `payment_type`, `transaction_id`, `items[]` (value `0` for free bookings; `payment_type` is `free`) |

Each `items[]` entry includes: `item_id`, `item_name`, `item_category`,
`price`, `quantity`. Currency is always `HKD`.

These events populate GA4's built-in eCommerce reports and can flow to
Google Ads Smart Bidding when GTM eCommerce tags are configured (see GTM
setup below).

## GA4 setup: step-by-step

1. Create or confirm a GA4 property.
2. Create or confirm a **Web Data Stream** for the public site domain.
3. In GA4 Admin, create event-scoped custom dimensions for:
   - `section_id`, `cta_location`, `form_type`, `form_kind`, `form_id`,
     `payment_method`, `service_tier`, `cohort_label`, `cohort_date`, `resource_key`,
     `error_type`, `discount_type`, `landing_page_slug`, `slot_start`, `status`
4. Create custom metrics for:
   - `total_amount`, `discount_amount`
5. Mark key events:
   - `contact_form_submit_success`
   - `media_form_submit_success`
   - `community_signup_submit_success`
   - `booking_submit_success`
   - `booking_confirm_pay_click`
     (mid-funnel intent signal; also imported into Google Ads as a
     **Secondary** conversion — see
     `apps/public_www/marketing/reports/google-ads-manual-setup-steps.md`)
6. Configure internal traffic filters for team IP ranges.
7. Configure unwanted referral exclusions and cross-domain linking if needed.
8. Enable BigQuery export for long-term event analysis.

## GTM setup: step-by-step

1. Create or confirm GTM container.
2. Add GA4 configuration tag and fire on All Pages.
3. Create GA4 event tags for taxonomy events.
4. Create triggers for existing UI hooks and flows:
   - WhatsApp links
   - Contact/media/community/event form interactions
   - Booking modal and reservation actions (including free intro-call on `/book-a-free-call`, which sends `service_tier: intro_call` and empty `cohort_date` on `booking_submit_*` when no cohort applies)
   - Intro-call slot picker events (`intro_call_slot_selected`, `intro_call_slot_picker_status_change`) and `book_free_call_click`
   - Landing-page CTA clicks (`landing_page_cta_click`)
   - GA4 eCommerce events (`begin_checkout`, `add_payment_info`, `purchase`)
5. Define variables for common parameters:
   - page metadata (`page_path`, `page_title`)
   - locale and section context (`page_locale`, `section_id`, `cta_location`)
   - booking context (`payment_method`, `cohort_label`, `service_tier`, amounts)
6. Attach common parameters to all event tags.
7. Use GTM Preview to validate every event and parameter.
8. Validate in GA4 DebugView.
9. Publish GTM workspace version after validation.

## Deployment and host gating checklist

1. Set `NEXT_PUBLIC_GTM_ID` in GitHub Variables.
2. Set `NEXT_PUBLIC_GTM_ALLOWED_HOSTS` (recommended) as comma-separated hosts.
3. If `NEXT_PUBLIC_GTM_ALLOWED_HOSTS` is unset, confirm
   `NEXT_PUBLIC_SITE_ORIGIN` resolves to the intended production host.
4. Verify staging and preview hosts are excluded unless explicitly intended.

## Data quality and governance checklist

- [ ] No PII in event names or parameters
- [ ] Event names follow taxonomy
- [ ] Required common parameters present
- [ ] GA4 custom dimensions/metrics registered for used params
- [ ] Key events configured
- [ ] Internal traffic filter active
- [ ] BigQuery export active
- [ ] GTM change notes/version comments recorded

## Required change protocol (MANDATORY)

For any analytics-impacting change under `apps/public_www/src/**`:

1. Update instrumentation code (`trackAnalyticsEvent` calls) as needed.
2. Update the contract at
   `apps/public_www/src/lib/analytics-taxonomy.json` when event names or custom
   params change.
3. Update this runbook if setup/process/event semantics changed.
4. Add an entry to `docs/architecture/analytics-change-log.md` with GA4 + GTM
   actions taken.
5. Update GTM workspace/tag configuration to match contract changes.
6. Update GA4 custom definitions/key events if contract changes require it.

CI enforcement:

- `npm run validate:analytics-contract`
- `npm run validate:analytics-governance`

Both checks run through Public WWW lint/verification workflows.

## Admin console (optional / not in public taxonomy)

The admin web app may emit **`admin_referral_qr_opened`** and **`admin_referral_qr_downloaded`** from the discount referral QR utility, **`admin_public_page_qr_opened`** / **`admin_public_page_qr_downloaded`** from the Website → public page QR screen, and **`admin_booking_link_opened`** / **`admin_booking_link_copied`** / **`admin_booking_link_qr_downloaded`** from the Services instance booking-link dialog (`trackAdminAnalyticsEvent`). These are **not** part of `apps/public_www/src/lib/analytics-taxonomy.json` and are currently **no-ops outside development** unless product wires them to `dataLayer`/GTM on the admin host. If they are enabled later, add GA4/GTM mappings separately from the public-site container.

## Programmatic setup prerequisites (for service-account automation)

To automate GA4/GTM setup from a script, ensure the service account has:

- GA4 property **Editor** (or Admin)
- GTM container **Admin** with workspace + publish permissions

Required identifiers:

- `GA4_PROPERTY_ID`
- `GA4_WEB_DATA_STREAM_ID`
- `GTM_ACCOUNT_ID`
- `GTM_CONTAINER_ID`
- `GTM_WORKSPACE_ID`

