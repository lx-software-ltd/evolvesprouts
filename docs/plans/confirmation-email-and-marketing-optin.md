# Plan: Transactional Confirmation Emails and Marketing Opt-In

**Status**: Draft — awaiting owner approval before implementation.

> **Update (2026-04):** The legacy public API bridge described in this draft was
> removed. Contact-us and booking flows are native: `public_contact.py`,
> `public_reservations.py`, and shared hooks in `public_form_hooks.py`. Treat the
> legacy-proxy sections below as historical context only.

---

## 1. Goal

Add two capabilities to every public form submission flow (Contact Us, Media
Download, Booking):

1. **Transactional confirmation email** — always sent to the submitter via
   AWS SES immediately after a successful submission.
2. **Marketing opt-in** — an optional, unchecked-by-default checkbox on each
   form. When checked, the submitter is added to the Mailchimp audience with a
   flow-specific tag, and a shared welcome Customer Journey is triggered.

Additionally, the media download link delivery is migrated from a Mailchimp
Customer Journey to a direct SES email. The Mailchimp journey is kept active
during a transition period (both send), then removed in a follow-up.

---

## 2. Scope

### In scope

| Flow | Frontend form | Backend handler |
|------|--------------|----------------|
| Contact Us | `contact-us-form.tsx` / `contact-us-form-fields.tsx` | `public_contact.py` |
| Media download | `media-form.tsx` | `public_media.py` → SNS → `media_processor/handler.py` |
| Booking (events, consultations, MBA) | `reservation-form.tsx` / `reservation-form-fields.tsx` | `public_reservations.py` |

### Out of scope

- **Event notification form** (`event-notification.tsx`) — collects email only
  (no name), serves a different purpose (event alerts). Address in a follow-up.
- **Native reservation handler** (`public_reservations.py` at
  `/v1/reservations`) — not used by any frontend client today. Do not modify.
- **Re-consent campaign** for existing Mailchimp audience members who were
  subscribed without explicit opt-in — business/legal decision, separate from
  this work.
- **Mailchimp journey removal** for media download — planned for removal in a
  follow-up after the transition period. See §10.

---

## 3. Architecture principles

1. **Transactional and marketing are separate concerns.** SES handles promised
   content (confirmations, download links). Mailchimp handles audience
   membership and marketing journeys.
2. **Marketing subscribe requires explicit consent.** No Mailchimp audience
   add without the user checking the opt-in box.
3. **Transactional email must not depend on marketing.** If Mailchimp is down
   or the user did not opt in, the confirmation email still arrives.
4. **Marketing failures are non-blocking.** Mailchimp errors are logged but
   never fail the user response. The primary action (proxy / SNS publish)
   already succeeded.

---

## 4. Design decisions (resolved)

These decisions were confirmed by the product owner and are binding for
implementation.

| # | Decision | Detail |
|---|----------|--------|
| D1 | Legacy APIs tolerate unknown fields | The new fields (`marketing_opt_in`, `locale`, `title`, etc.) can be forwarded to the legacy API without stripping. |
| D2 | Welcome journey not yet created | Deploy with empty placeholder values for `MAILCHIMP_WELCOME_JOURNEY_ID` and `MAILCHIMP_WELCOME_JOURNEY_STEP_ID` (empty disables the trigger). The existing `MAILCHIMP_FREE_RESOURCE_JOURNEY_ID` and `MAILCHIMP_FREE_RESOURCE_JOURNEY_STEP_ID` GitHub vars and CDK parameters stay unchanged — they serve the media download delivery during the transition period and are a separate journey. |
| D3 | WhatsApp URL — no new CDK parameter | Use the same hardcoded fallback URL as the website content JSON (`whatsappContact.href` in `en.json`): `https://wa.me/message/ZQHVW4DEORD5A1?src=qr`. Define this as a module constant in a shared email template utilities module (`backend/src/app/templates/constants.py`). Keep it in sync with `apps/public_www/src/content/en.json` → `whatsappContact.href`. This mirrors how the website treats it as a brand-level fallback constant. |
| D4 | Email sender: `hello@evolvesprouts.com` | Customer-facing confirmation emails use the `AuthEmailFromAddress` parameter (`hello@evolvesprouts.com`). Internal notifications continue using `SesSenderEmail` (`no-reply@`). The SES domain identity ARN (`identity/evolvesprouts.com`) already covers both addresses. |
| D5 | Legacy APIs accept `first_name` | Making `first_name` required on the Contact Us form and forwarding it in the body is safe. |
| D6 | Booking display fields tolerated | Adding `title`, `schedule_date`, `schedule_time`, and `location_name` to the reservation POST body is safe. |
| D7 | Email templates: SES native templates (Handlebars) | Use SES stored templates with Handlebars syntax (`{{variable}}`, `{{#if}}`, `{{#each}}`). The `send_templated_email` function already exists in `backend/src/app/services/email.py`. Templates are created/updated via a CDK custom resource at deploy time. This is the AWS-native approach and avoids maintaining complex HTML in Python string-format templates. See §6.6 for details. |
| D8 | SES is in production mode | No sending limit concerns. |
| D9 | Marketing opt-in checkbox: unchecked by default | True opt-in across all three forms. |

---

## 5. Current state

| Flow | Email to user | Email to team | Mailchimp | Consent |
|------|--------------|--------------|-----------|---------|
| Contact Us | None | None (legacy handles) | None | None |
| Media download | Mailchimp journey (download link) | SES (sales notification) | Subscribe + tag + journey | **None** |
| Booking | None | None (legacy handles) | None | None |

### Problems

- **Media**: Download link delivery is coupled to Mailchimp subscribe. Users
  are added to the marketing audience without consent.
- **Contact Us**: No confirmation email. No marketing capability.
- **Booking**: No confirmation email for paying customers. No marketing
  capability.

---

## 6. Target state

| Flow | Email to user | Email to team | Mailchimp | Consent |
|------|--------------|--------------|-----------|---------|
| Contact Us | SES confirmation (always) | Unchanged (legacy) | Subscribe + tag + journey (if opted in) | Checkbox (unchecked) |
| Media download | SES download link (always) | SES sales notification (unchanged) | Subscribe + tag + journey (if opted in) | Checkbox (unchecked) |
| Booking | SES booking confirmation (always) | Unchanged (legacy) | Subscribe + tag + journey (if opted in) | Checkbox (unchecked) |

### Media transition period

During the transition the media flow sends the download link via **both** SES
and the existing Mailchimp Customer Journey. The Mailchimp journey continues to
fire for **all** media submissions (opted in or not) until the removal
follow-up. This ensures no user misses their download link if SES delivery has
issues in the initial rollout. See §10 for the removal checklist.

---

## 7. Detailed changes

### 7.1 Frontend — Contact Us form

**Files to modify:**

| File | Change |
|------|--------|
| `apps/public_www/src/components/sections/contact-us-form-fields.tsx` | 1. Make `firstName` field required: add required marker (`*`), add `required` attribute, add `aria-invalid` + error message (same pattern as email field). 2. Add marketing opt-in checkbox below the captcha field, above submit. Unchecked by default. Use locale content for label. |
| `apps/public_www/src/components/sections/contact-us-form.tsx` | 1. Add `isFirstNameTouched` state + blur handler. 2. Validate `firstName` is non-empty after sanitize in `handleSubmit`. 3. Add `marketingOptIn` boolean state (default `false`). 4. Include `first_name` (always) and `marketing_opt_in` in the POST body. |
| `apps/public_www/src/content/en.json` | Add under `contactUs.form`: `firstNameRequiredError` ("Please enter your name"), `marketingOptInLabel` ("Keep me updated with parenting tips and resources"). |
| `apps/public_www/src/content/zh-CN.json` | Chinese Simplified translations for the two new keys. |
| `apps/public_www/src/content/zh-HK.json` | Chinese Traditional translations for the two new keys. |
| `apps/public_www/tests/components/sections/contact-us-form.test.tsx` | Update: required first name validation, marketing checkbox presence and default state, payload includes `first_name` and `marketing_opt_in`. |
| `apps/public_www/tests/components/sections/contact-us-form-fields.test.tsx` | Update: first name required marker, error state, checkbox rendering. |

**Props changes to `ContactFormFields`:**

Add to the component interface:

- `hasFirstNameError: boolean`
- `marketingOptIn: boolean`
- `onFirstNameBlur: () => void`
- `onMarketingOptInChange: (checked: boolean) => void`

The content type (`ContactUsContent['form']`) will need the two new keys added
to the TypeScript type in `apps/public_www/src/content/index.ts` (or wherever
the content types are defined).

**Request body change:**

```
Before: { email_address, message, first_name?, phone_number? }
After:  { email_address, message, first_name, phone_number?, marketing_opt_in }
```

`first_name` becomes always-present (required). `marketing_opt_in` is a boolean
(default `false` if omitted).

### 7.2 Frontend — Media download form

**Files to modify:**

| File | Change |
|------|--------|
| `apps/public_www/src/components/sections/media-form.tsx` | Add `marketingOptIn` boolean state (default `false`). Add checkbox below email field, before captcha. Include `marketing_opt_in` in the POST body. |
| `apps/public_www/src/content/en.json` | Add under `resources`: `formMarketingOptInLabel` ("Keep me updated with parenting tips and resources"). |
| `apps/public_www/src/content/zh-CN.json` | Chinese Simplified translation. |
| `apps/public_www/src/content/zh-HK.json` | Chinese Traditional translation. |
| `apps/public_www/tests/components/sections/media-form.test.tsx` | Update: checkbox rendering, default state, payload includes `marketing_opt_in`. |

**Request body change:**

```
Before: { first_name, email, resource_key? }
After:  { first_name, email, resource_key?, marketing_opt_in }
```

### 7.3 Frontend — Booking reservation form

**Files to modify:**

| File | Change |
|------|--------|
| `apps/public_www/src/components/sections/booking-modal/reservation-form-fields.tsx` | Add marketing opt-in checkbox. Place it after the topics textarea and before the payment section. Visually distinguish from the required terms checkbox (terms has `*`, marketing does not). Pass `marketingOptIn` and `onMarketingOptInChange` as new props. |
| `apps/public_www/src/components/sections/booking-modal/reservation-form.tsx` | Add `marketingOptIn` boolean state (default `false`). Include `marketing_opt_in` in the reservation payload. Pass the `locale` prop value into the POST body as `locale` (string, e.g. `"en"`, `"zh-CN"`, `"zh-HK"`). Include display fields from `reservationSummary`: `title`, `schedule_date`, `schedule_time`, `location_name`. |
| `apps/public_www/src/lib/reservations-data.ts` | Add to `ReservationSubmissionPayload`: `marketing_opt_in?: boolean`, `locale?: string`, `title?: string`, `schedule_date?: string`, `schedule_time?: string`, `location_name?: string`. |
| `apps/public_www/src/content/en.json` | Add under `bookingModal.paymentModal`: `marketingOptInLabel` ("Keep me updated with parenting tips and resources"). |
| `apps/public_www/src/content/zh-CN.json` | Chinese Simplified translation. |
| `apps/public_www/src/content/zh-HK.json` | Chinese Traditional translation. |
| Tests for the reservation form components. | Update: checkbox rendering, default state, payload includes new fields. |

**Request body change:**

```
Before: { full_name, email, phone_number, cohort_age, cohort_date, ... }
After:  { full_name, email, phone_number, cohort_age, cohort_date, ...,
          marketing_opt_in, locale, title, schedule_date,
          schedule_time, location_name }
```

`locale` is passed from the frontend so the backend can select the correct
email template language. Display fields are sourced from `reservationSummary`
in `reservation-form.tsx`.

### 7.4 Frontend — Shared checkbox component

All three forms need an identical marketing opt-in checkbox. To avoid
duplication, extract a shared component:

**New file:**
`apps/public_www/src/components/shared/marketing-opt-in-checkbox.tsx`

Props: `label: string`, `checked: boolean`, `onChange: (checked: boolean) => void`.

Renders a styled `<label>` with `<input type="checkbox">` using existing
`es-form-*` CSS classes. No required marker. Accessible (`aria-*` attributes
not needed beyond the label association).

### 7.5 Backend — Shared marketing subscribe helper

**New file:** `backend/src/app/services/marketing_subscribe.py`

Purpose: reusable, non-blocking wrapper for Mailchimp audience subscribe +
tag + welcome journey trigger. Called from all three flows.

```python
def subscribe_to_marketing(
    *,
    email: str,
    first_name: str,
    tag_name: str,
    merge_fields: dict[str, str] | None = None,
    logger: Logger,
) -> bool:
    """Add a contact to the Mailchimp audience with a tag and trigger the
    welcome journey. Returns True if the subscribe succeeded.

    Non-blocking: logs errors but never raises.
    """
```

Implementation:

1. Call `add_subscriber_with_tag(email=email, first_name=first_name,
   tag_name=tag_name, merge_fields=merge_fields)` with `run_with_retry`
   (3 attempts, 1s base delay, `_is_retryable_mailchimp_exception`).
2. On success, read `MAILCHIMP_WELCOME_JOURNEY_ID` and
   `MAILCHIMP_WELCOME_JOURNEY_STEP_ID` from env. If both non-empty, call
   `trigger_customer_journey(email=email, journey_id=..., step_id=...)`
   with `run_with_retry`. If either is empty, skip (journey not configured).
3. Catch and log all exceptions. Return `False` on failure.

Environment variables consumed:
- `MAILCHIMP_API_SECRET_ARN` (existing)
- `MAILCHIMP_LIST_ID` (existing)
- `MAILCHIMP_SERVER_PREFIX` (existing)
- `MAILCHIMP_WELCOME_JOURNEY_ID` (new — deploy with empty string initially)
- `MAILCHIMP_WELCOME_JOURNEY_STEP_ID` (new — deploy with empty string initially)

These are the **shared** welcome journey IDs — all three flows trigger the same
journey. They are **separate** from the existing
`MAILCHIMP_FREE_RESOURCE_JOURNEY_ID` / `MAILCHIMP_FREE_RESOURCE_JOURNEY_STEP_ID`
which serve the media download delivery Mailchimp journey and remain unchanged
during the transition period.

### 7.6 Backend — Email templates

#### 7.6.0 Template approach: SES stored templates with Handlebars

AWS SES natively supports stored email templates with Handlebars syntax
(`{{variable}}`, `{{#if condition}}`, `{{#each list}}`). The
`send_templated_email` function already exists in
`backend/src/app/services/email.py` and calls
`ses:SendTemplatedEmail`.

**Template management:** Templates will be created/updated at deploy time via
a CDK custom resource (Lambda-backed) that calls `ses:CreateTemplate` /
`ses:UpdateTemplate`. Template source lives in Python modules under
`backend/src/app/templates/ses/` as dictionaries (template name → subject/HTML/text).
The custom resource Lambda reads these and upserts them into SES.

Each template is **locale-suffixed** to support three languages:

- `evolvesprouts-contact-confirmation-en`
- `evolvesprouts-contact-confirmation-zh-CN`
- `evolvesprouts-contact-confirmation-zh-HK`
- `evolvesprouts-media-download-en` / `zh-CN` / `zh-HK`
- `evolvesprouts-booking-confirmation-en` / `zh-CN` / `zh-HK`

The handler selects the correct template by appending the validated locale
suffix (default `en`).

**Template data** is passed as a JSON object via `send_templated_email`'s
`template_data` parameter.

#### 7.6.1 Shared template constants

**New file:** `backend/src/app/templates/constants.py`

Module-level helpers shared across email templates:

```python
def build_whatsapp_phone_url() -> str:
    """Build ``https://wa.me/<digits>`` from the business phone env var."""
```

The phone number is read from `PUBLIC_WWW_BUSINESS_PHONE_NUMBER` (or
`NEXT_PUBLIC_BUSINESS_PHONE_NUMBER`), matching the public website env var.
Transactional email uses the numeric `wa.me` form for reliable link handling;
`whatsappContact.href` on the public site may still use a `wa.me/message/...` QR
link. Env-provided `wa.me/message/...` URLs are coerced to the numeric form when
building template data using this phone number.

Also defines a `resolve_public_www_base_url()` helper that reads
`PUBLIC_WWW_BASE_URL` env var (set on Lambda from CDK
`publicWwwDomainName`).

#### 7.6.2 SES template definitions

**New file:** `backend/src/app/templates/ses/contact_confirmation.py`

Template name pattern: `evolvesprouts-contact-confirmation-{locale}`

Template data variables:
- `{{first_name}}`
- `{{whatsapp_url}}`
- `{{faq_url}}`

Content:
- Subject: "We received your message — Evolve Sprouts"
- Body: Greeting with first name. "We received your message and will get back
  to you within 24–48 hours." Links: FAQ page URL, WhatsApp URL. Closing.
- HTML: Branded template (inline CSS, 600px max-width, Evolve Sprouts header).
  Handlebars variables for dynamic content.

**New file:** `backend/src/app/templates/ses/media_download_link.py`

Template name pattern: `evolvesprouts-media-download-{locale}`

Template data variables:
- `{{first_name}}`
- `{{media_name}}`
- `{{download_url}}`
- Plus shared shell keys (logo, footer, `my_best_auntie_url`, `free_intro_call_url`).

Content:
- Subject: "Your free guide is ready — Evolve Sprouts"
- Banner headline: "YOUR FREE GUIDE IS HERE!" (localized for `zh-CN` / `zh-HK`).
- Body: Greeting with first name. "Here is your download link for
  {{media_name}}." Left-aligned CTA: "Download your free guide". Fallback URL
  copy. Horizontal rule, then "What you'll find inside", numbered suggestions,
  and a bordered callout linking My Best Auntie (`{{my_best_auntie_url}}`) and
  a free intro call (`{{free_intro_call_url}}`).
- HTML: Branded template with inline CSS.

**New file:** `backend/src/app/templates/ses/booking_confirmation.py`

Template name pattern: `evolvesprouts-booking-confirmation-{locale}`

Template data variables:
- `{{full_name}}`
- `{{title}}`
- `{{schedule_date}}` (optional — use `{{#if}}`)
- `{{schedule_time}}` (optional)
- `{{payment_method}}`
- `{{total_amount}}`
- `{{is_pending_payment}}` (boolean — for non-Stripe note)
- `{{whatsapp_url}}`

Content:
- Subject: "Booking confirmed — {{title}} — Evolve Sprouts"
- Body: Greeting with full name. "Thank you for your booking!" Details table:
  course/event name, date/time, payment amount (HKD), payment method.
  `{{#if is_pending_payment}}` block: "Your reservation is pending until
  payment is confirmed." WhatsApp link for questions. Closing.
- HTML: Branded template. Details table. WhatsApp CTA.

#### 7.6.3 SES template deployment custom resource

**New file:** `backend/lambda/ses_template_manager/handler.py`

A simple CloudFormation custom resource Lambda that:
- On CREATE/UPDATE: reads template definitions, calls
  `ses:CreateTemplate` or `ses:UpdateTemplate` for each.
- On DELETE: calls `ses:DeleteTemplate` for each.
- Returns template names as outputs.

**CDK wiring** in `api-stack.ts`: a `CustomResource` backed by this Lambda,
triggered on every deploy. The Lambda is granted `ses:CreateTemplate`,
`ses:UpdateTemplate`, `ses:DeleteTemplate`, `ses:GetTemplate` permissions.
It runs outside the VPC (SES API is public). Template source is bundled with
the Lambda code.

### 7.7 Backend — Contact Us handler changes

**File:** `backend/src/app/api/public_legacy_proxy.py`

Modify `handle_legacy_contact_us`:

```
Current flow:
  1. Validate method → parse body → proxy to legacy API → return response

New flow:
  1. Validate method → parse body → proxy to legacy API
  2. If proxy returned a success status (200 or 202):
     a. Extract email_address, first_name, marketing_opt_in from the
        ORIGINAL parsed body (not the proxy response).
     b. Determine locale: read Accept-Language header from the original
        event, or default to "en".
     c. Send SES confirmation email via send_templated_email using
        template evolvesprouts-contact-confirmation-{locale}
        (fire-and-forget with error logging).
     d. If marketing_opt_in is truthy AND first_name is non-empty:
        call subscribe_to_marketing (fire-and-forget).
  3. Return the proxy response (unchanged).
```

The SES send and Mailchimp calls MUST NOT delay or alter the response. Wrap
each in a try/except that logs and swallows errors.

**Refactoring the proxy:** The legacy proxy handler currently does not parse the
body for its own use — it forwards it opaquely. For the post-success hooks, the
parsed body must be accessible. The body is already parsed via `parse_body(event)`
in `_handle_legacy_proxy`.

**Recommended approach:** Have `handle_legacy_contact_us` call `parse_body`
first, then pass the result to a slightly refactored `_handle_legacy_proxy`
that accepts an already-parsed payload. This avoids double-parsing and keeps
the generic proxy clean.

**From address:** Use `CONFIRMATION_EMAIL_FROM_ADDRESS` env var
(`hello@evolvesprouts.com`).

### 7.8 Backend — Booking handler changes

**File:** `backend/src/app/api/public_legacy_proxy.py`

Modify `handle_legacy_reservations`:

Same pattern as Contact Us. After successful proxy response:

1. Extract `full_name`, `email`, `title`, `schedule_date`,
   `schedule_time`, `payment_method`, `price`,
   `stripe_payment_intent_id`, `marketing_opt_in`, `locale` from the
   original parsed body.
2. Derive first name from `full_name` by splitting on first whitespace.
3. Determine locale: use `locale` from the body (passed by the frontend),
   validate against `["en", "zh-CN", "zh-HK"]`, fall back to `"en"`.
4. Determine `is_pending_payment`: `True` when `payment_method` is not
   a Stripe variant (not `"stripe"`) and `stripe_payment_intent_id` is empty.
5. Send SES booking confirmation email via `send_templated_email` using
   template `evolvesprouts-booking-confirmation-{locale}`
   (fire-and-forget).
6. If `marketing_opt_in` is truthy AND derived first name is non-empty:
   call `subscribe_to_marketing` with tag `booking-customer`
   (fire-and-forget).

**From address:** Use `CONFIRMATION_EMAIL_FROM_ADDRESS` env var
(`hello@evolvesprouts.com`).

**Note on `full_name` → `first_name`:** The booking form collects `full_name`
(e.g., "Jane Smith"). Mailchimp's `FNAME` merge field expects a first name.
Split `full_name` on the first whitespace and use the first segment. If the
name has no spaces, use the entire string.

### 7.9 Backend — Media processor changes

**File:** `backend/src/app/api/public_media.py`

Add `marketing_opt_in` to the SNS message payload:

```python
message_payload = {
    "event_type": _EVENT_TYPE,
    "first_name": first_name,
    "email": email,
    "submitted_at": ...,
    "request_id": ...,
    "marketing_opt_in": body.get("marketing_opt_in", False),
}
```

**File:** `backend/lambda/media_processor/handler.py`

Modify `_process_message`:

```
Current flow:
  1. Upsert contact in DB            (always)
  2. add_subscriber_with_tag()        (always)
  3. trigger_customer_journey()       (always, if step 2 succeeded)
  4. SES to sales team                (always)

New flow:
  1. Upsert contact in DB            (always)
  2. SES download link to user        (always — NEW, via send_templated_email
     using evolvesprouts-media-download-{locale})
  3. SES to sales team                (always — unchanged)
  4. add_subscriber_with_tag()        (TRANSITION: always;
                                       POST-TRANSITION: only if marketing_opt_in)
  5. trigger_customer_journey()       (TRANSITION: always if step 4 succeeded;
     [free resource journey]           POST-TRANSITION: only if marketing_opt_in)
  6. subscribe_to_marketing()         (only if marketing_opt_in — NEW;
     [welcome journey]                 uses shared helper from §7.5)
```

**Step 2 detail:** After `_ensure_share_link_url_for_asset` returns the
download URL, call `send_templated_email` with the media download template.
Use `CONFIRMATION_EMAIL_FROM_ADDRESS` (`hello@evolvesprouts.com`) as the
source, send to the user's email.

**Locale for media:** The media form does not currently pass a `locale` field.
Add `locale` to the media form frontend payload (§7.2) and pass it through
the SNS message. Default to `"en"` if missing.

**Transition behavior:** During the transition period, steps 4 and 5 remain
unconditional (matching current behavior), controlled by the env var
`MAILCHIMP_REQUIRE_MARKETING_CONSENT`. When `"false"` (default during
transition), Mailchimp subscribe + free resource journey fire unconditionally.
When `"true"` (post-transition), they are gated behind `marketing_opt_in`.

Step 6 (welcome journey via shared helper) **always** requires
`marketing_opt_in` regardless of the transition flag — it is a new behavior
that only fires for opted-in users.

**From address:** Use `CONFIRMATION_EMAIL_FROM_ADDRESS` env var
(`hello@evolvesprouts.com`). Add this env var to the media processor.

### 7.10 Backend — Infrastructure (CDK) changes

**File:** `backend/infrastructure/lib/api-stack.ts`

#### 7.10.1 Admin Lambda SES permissions

Add `ses:SendEmail`, `ses:SendRawEmail`, and `ses:SendTemplatedEmail` IAM
policy to `adminFunction`. Use the existing `sesSenderDomainIdentityArn`
which covers all `@evolvesprouts.com` addresses (including `hello@`):

```typescript
adminFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
    resources: [sesSenderIdentityArn, sesSenderDomainIdentityArn],
  })
);
```

#### 7.10.2 Admin Lambda environment variables

Add the following to `adminFunction` via `addEnvironment`:

| Env var | Value source | Purpose |
|---------|-------------|---------|
| `SES_SENDER_EMAIL` | `sesSenderEmail.valueAsString` | Internal notifications (existing pattern) |
| `CONFIRMATION_EMAIL_FROM_ADDRESS` | `authEmailFromAddress.valueAsString` | Customer-facing emails (`hello@`) |
| `SUPPORT_EMAIL` | `supportEmail.valueAsString` | Support email reference |
| `MAILCHIMP_API_SECRET_ARN` | `mailchimpApiSecret.secretArn` | Mailchimp API key access |
| `MAILCHIMP_LIST_ID` | `mailchimpListId.valueAsString` | Audience ID |
| `MAILCHIMP_SERVER_PREFIX` | `mailchimpServerPrefix.valueAsString` | Mailchimp API host |
| `MAILCHIMP_WELCOME_JOURNEY_ID` | `mailchimpWelcomeJourneyId.valueAsString` | Shared welcome journey |
| `MAILCHIMP_WELCOME_JOURNEY_STEP_ID` | `mailchimpWelcomeJourneyStepId.valueAsString` | Welcome journey entry step |
| `PUBLIC_WWW_BASE_URL` | `` `https://${publicWwwDomainName.valueAsString}` `` | For FAQ link in emails |

#### 7.10.3 New CfnParameters

```typescript
const mailchimpWelcomeJourneyId = new cdk.CfnParameter(
  this, "MailchimpWelcomeJourneyId", {
    type: "String",
    default: "",
    description:
      "Mailchimp Customer Journey ID for the shared welcome flow " +
      "(triggered for opted-in contacts from contact/media/booking forms). " +
      "Empty disables the trigger.",
  }
);

const mailchimpWelcomeJourneyStepId = new cdk.CfnParameter(
  this, "MailchimpWelcomeJourneyStepId", {
    type: "String",
    default: "",
    description:
      "Mailchimp Customer Journey step ID for the welcome flow entry point. " +
      "Empty disables the trigger.",
  }
);

const mailchimpRequireMarketingConsent = new cdk.CfnParameter(
  this, "MailchimpRequireMarketingConsent", {
    type: "String",
    default: "false",
    allowedValues: ["true", "false"],
    description:
      "When true, the media processor only subscribes to Mailchimp when " +
      "marketing_opt_in is set. Set to false during SES download link " +
      "transition to preserve existing behavior.",
  }
);
```

No `WhatsappUrl` parameter — see decision D3.

#### 7.10.4 Admin Lambda Secrets Manager read

```typescript
mailchimpApiSecret.grantRead(adminFunction);
```

#### 7.10.5 Media processor additional environment variables

Add to `mediaRequestProcessor` environment:

| Env var | Value source | Purpose |
|---------|-------------|---------|
| `CONFIRMATION_EMAIL_FROM_ADDRESS` | `authEmailFromAddress.valueAsString` | Customer-facing download link email |
| `MAILCHIMP_REQUIRE_MARKETING_CONSENT` | `mailchimpRequireMarketingConsent.valueAsString` | Transition flag |
| `MAILCHIMP_WELCOME_JOURNEY_ID` | `mailchimpWelcomeJourneyId.valueAsString` | Shared welcome journey (new, separate from free resource journey) |
| `MAILCHIMP_WELCOME_JOURNEY_STEP_ID` | `mailchimpWelcomeJourneyStepId.valueAsString` | Welcome journey entry step |

Add `ses:SendTemplatedEmail` to the media processor SES IAM policy (it already
has `ses:SendEmail` and `ses:SendRawEmail`).

#### 7.10.6 SES template deployment custom resource

Add a `CustomResource` backed by the SES template manager Lambda (§7.6.3).
Grant it `ses:CreateTemplate`, `ses:UpdateTemplate`, `ses:DeleteTemplate`,
`ses:GetTemplate` on `*`. Run outside VPC. Trigger on every deploy by
including a hash of the template source as a property.

### 7.11 Documentation updates

| File | Change |
|------|--------|
| `docs/api/public.yaml` | Add `marketing_opt_in` (boolean, optional, default false) to `ContactUsSubmissionRequest` and `MediaRequestSubmissionRequest`. Mark `first_name` as required on Contact Us. Add `marketing_opt_in`, `locale`, `title`, `schedule_date`, `schedule_time`, `location_name` to the reservation body description. Add `locale` to `MediaRequestSubmissionRequest`. Document confirmation email behavior in endpoint descriptions. |
| `docs/architecture/aws-messaging.md` | Add section for contact-us and booking transactional emails (SES, synchronous from Admin Lambda). Update media flow: SES sends download link directly, Mailchimp conditional on consent (with transition note). Document the SES template management custom resource. |
| `docs/architecture/lambdas.md` | Update Admin Lambda: add SES permissions, new env vars. Update Media Processor: add `CONFIRMATION_EMAIL_FROM_ADDRESS`, `MAILCHIMP_REQUIRE_MARKETING_CONSENT`, welcome journey vars, `ses:SendTemplatedEmail`. Add SES template manager Lambda entry. |
| `docs/architecture/aws-assets-map.md` | Add new CfnParameters: `MailchimpWelcomeJourneyId`, `MailchimpWelcomeJourneyStepId`, `MailchimpRequireMarketingConsent`. Add SES template custom resource. |

---

## 8. Mailchimp tags

| Flow | Tag name | Applied when |
|------|----------|-------------|
| Contact Us | `contact-us-inquiry` | User opts in |
| Media download | `public-www-media-{resource_key}-requested` (existing) | Transition: always. Post-transition: user opts in |
| Booking | `booking-customer` | User opts in |

---

## 9. Execution order

Implementation should proceed in this order to minimize risk and allow
incremental testing:

### Phase 1: Backend infrastructure and shared code

1. CDK changes (§7.10): Admin Lambda SES grant, env vars, new parameters,
   media processor env updates.
2. SES template definitions (§7.6): all three template sets (9 templates
   total: 3 flows × 3 locales).
3. SES template deployment custom resource (§7.6.3).
4. Shared marketing subscribe helper (§7.5): `marketing_subscribe.py`.
5. Shared template constants (§7.6.1): `constants.py`.
6. Run `pre-commit run ruff-format --all-files` after all Python changes.
7. Run `python3 scripts/validate_agent_rules.py`.

### Phase 2: Backend handler changes

8. Contact Us handler (§7.7): post-success SES + Mailchimp hook.
9. Booking handler (§7.8): post-success SES + Mailchimp hook.
10. Media API (§7.9): pass `marketing_opt_in` and `locale` through SNS payload.
11. Media processor (§7.9): add SES download link, transition flag for
    Mailchimp, welcome journey for opt-in.

### Phase 3: Frontend changes

12. Shared checkbox component (§7.4).
13. Contact Us form (§7.1): required first name + checkbox + payload.
14. Media form (§7.2): checkbox + payload + locale.
15. Booking form (§7.3): checkbox + payload + locale + display fields.
16. Update all affected tests.
17. Update locale content in all three JSON files.

### Phase 4: Documentation

18. OpenAPI spec updates (§7.11).
19. Architecture docs updates (§7.11).

---

## 10. Testing checklist

### Backend unit tests

- [ ] `marketing_subscribe.py`: success path, Mailchimp API error (non-blocking),
  missing env vars, empty email/name, empty journey IDs (skip trigger).
- [ ] SES template definitions: validate Handlebars syntax, all variables present,
  all three locales defined for each template.
- [ ] `public_legacy_proxy.py` (contact-us): successful proxy triggers SES +
  Mailchimp when opted in; failed proxy triggers neither; Mailchimp failure
  does not affect response; missing first_name skips Mailchimp.
- [ ] `public_legacy_proxy.py` (booking): same as above, plus locale
  passthrough, full_name → first_name extraction, is_pending_payment logic.
- [ ] `public_media.py`: `marketing_opt_in` and `locale` included in SNS payload.
- [ ] `media_processor/handler.py`: SES download link sent on success;
  Mailchimp gated by transition flag + opt-in; SES failure logged but
  processing continues; welcome journey fires only for opted-in users.

### Frontend component tests

- [ ] Contact Us form: first name required validation, checkbox unchecked by
  default, payload shape, success/error paths unchanged.
- [ ] Media form: checkbox unchecked by default, payload shape includes
  `marketing_opt_in`.
- [ ] Booking form: checkbox unchecked by default, checkbox visually distinct
  from terms, payload includes `marketing_opt_in`, `locale`, and display fields.
- [ ] Shared checkbox component: renders label, toggles state, accessible.

### Integration / manual testing

- [ ] Submit Contact Us with opt-in → receive SES confirmation from
  `hello@evolvesprouts.com` + appear in Mailchimp audience with
  `contact-us-inquiry` tag.
- [ ] Submit Contact Us without opt-in → receive SES confirmation only, not
  added to Mailchimp.
- [ ] Submit media form with opt-in → receive SES download link + Mailchimp
  journey email (transition). Appear in audience with tag and welcome journey.
- [ ] Submit media form without opt-in → receive SES download link + Mailchimp
  journey email (transition). Appear in audience (transition — legacy behavior
  preserved). No welcome journey.
- [ ] Submit booking with opt-in → receive SES booking confirmation with
  correct details + appear in Mailchimp audience with `booking-customer` tag.
- [ ] Submit booking without opt-in → receive SES booking confirmation only.
- [ ] Verify emails render correctly in Gmail, Outlook, Apple Mail.
- [ ] Verify Chinese locale emails render correctly (zh-CN and zh-HK).
- [ ] Verify non-Stripe booking shows pending-payment note in email.
- [ ] Verify Mailchimp welcome journey triggers (once journey is configured).

---

## 11. Media Mailchimp transition → removal checklist

After the SES download link has been confirmed working in production for a
sufficient period (recommended: 2 weeks of monitoring):

1. Set `MailchimpRequireMarketingConsent` parameter to `"true"` in production
   deploy.
2. Verify: media submissions without opt-in no longer appear in Mailchimp
   audience. Media submissions with opt-in still appear.
3. Verify: all users still receive their download link via SES regardless of
   opt-in.
4. Disable the Mailchimp "Free Resource" Customer Journey in the Mailchimp
   dashboard (so it stops sending the download link email on its own).
5. Remove `MAILCHIMP_FREE_RESOURCE_JOURNEY_ID` and
   `MAILCHIMP_FREE_RESOURCE_JOURNEY_STEP_ID` env vars from the media
   processor CDK config. **Do not remove** the corresponding GitHub vars /
   CDK parameters until any other consumer is confirmed to not use them.
6. Remove `MAILCHIMP_REQUIRE_MARKETING_CONSENT` env var and the conditional
   logic in `media_processor/handler.py` — Mailchimp subscribe is now always
   gated by `marketing_opt_in`.
7. Remove `MAILCHIMP_MEDIA_DOWNLOAD_MERGE_TAG` env var from the media
   processor (the download URL merge field is no longer needed since SES
   sends the link directly).
8. Update `docs/architecture/aws-messaging.md` to remove transition notes.

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| SES send failure on contact-us / booking | User does not receive confirmation email | Log error. Return success to user (primary action succeeded). Monitor CloudWatch for SES errors. Consider DLQ retry in a follow-up. |
| SES send failure on media download link | User does not receive download link | During transition: Mailchimp journey is backup. Post-transition: monitor closely; add DLQ retry. |
| SES template not found (deployment issue) | `send_templated_email` fails with `TemplateDoesNotExist` | Custom resource creates templates before handler code runs. If missing, falls back to error logging (non-blocking for contact-us/booking; critical for media download link). |
| Mailchimp API failure after opt-in | User not added to audience | Non-blocking. Log warning. User still gets SES email. Can reconcile via admin tools later. |
| Added latency on contact-us / booking responses | Slower form submission | SES via VPC endpoint: sub-second. Mailchimp via HTTP proxy: 1-3s but fire-and-forget (non-blocking). Total added latency to response: ~200-500ms (SES only; Mailchimp does not block response). |
| `full_name` → `first_name` extraction is lossy | Mailchimp FNAME may be imprecise for non-Western names | Acceptable for a merge field. If the user has a single-word name, the entire name is used. |
| Contact Us `first_name` now required | Existing form users may have muscle memory to skip it | Field was already visually present; only validation changes. Low risk. |
| Booking form locale accuracy | Email sent in wrong language | Frontend passes current route locale. Backend validates against `["en", "zh-CN", "zh-HK"]` and defaults to `"en"`. |
| WhatsApp URL drift between backend constant and content JSON | Email links point to stale URL | Document sync requirement in `constants.py`. Both values are brand-level constants that change rarely. |

---

## 13. File inventory (complete)

### New files

| Path | Purpose |
|------|---------|
| `apps/public_www/src/components/shared/marketing-opt-in-checkbox.tsx` | Shared checkbox component |
| `backend/src/app/services/marketing_subscribe.py` | Shared Mailchimp subscribe helper |
| `backend/src/app/templates/constants.py` | Shared email template constants (WhatsApp URL, public WWW base URL helper) |
| `backend/src/app/templates/ses/__init__.py` | Package init |
| `backend/src/app/templates/ses/contact_confirmation.py` | Contact Us SES template definitions (3 locales) |
| `backend/src/app/templates/ses/media_download_link.py` | Media download SES template definitions (3 locales) |
| `backend/src/app/templates/ses/booking_confirmation.py` | Booking confirmation SES template definitions (3 locales) |
| `backend/lambda/ses_template_manager/handler.py` | CDK custom resource for SES template upsert |

### Modified files

| Path | Summary of change |
|------|------------------|
| `apps/public_www/src/components/sections/contact-us-form.tsx` | Required first name, marketing opt-in state, updated payload |
| `apps/public_www/src/components/sections/contact-us-form-fields.tsx` | Required first name validation, marketing checkbox |
| `apps/public_www/src/components/sections/media-form.tsx` | Marketing opt-in state, checkbox, locale in payload |
| `apps/public_www/src/components/sections/booking-modal/reservation-form.tsx` | Marketing opt-in state, locale + display fields in payload |
| `apps/public_www/src/components/sections/booking-modal/reservation-form-fields.tsx` | Marketing checkbox |
| `apps/public_www/src/lib/reservations-data.ts` | Add `marketing_opt_in`, `locale`, display fields to payload type |
| `apps/public_www/src/content/en.json` | New locale keys for all three forms |
| `apps/public_www/src/content/zh-CN.json` | Chinese Simplified translations |
| `apps/public_www/src/content/zh-HK.json` | Chinese Traditional translations |
| `backend/src/app/api/public_legacy_proxy.py` | Post-success hooks for contact-us and booking |
| `backend/src/app/api/public_media.py` | Pass `marketing_opt_in` and `locale` in SNS payload |
| `backend/lambda/media_processor/handler.py` | SES download link, transition-gated Mailchimp, welcome journey for opt-in |
| `backend/infrastructure/lib/api-stack.ts` | Admin Lambda SES grant + env vars, media processor env updates, new parameters, SES template custom resource |
| `docs/api/public.yaml` | Schema updates for all three endpoints |
| `docs/architecture/aws-messaging.md` | New transactional email flows, updated media flow |
| `docs/architecture/lambdas.md` | Updated Admin Lambda and Media Processor descriptions, new SES template manager entry |
| `docs/architecture/aws-assets-map.md` | New parameters and custom resource |
| Tests (multiple files) | Updated for new fields, checkbox, payload shapes |
