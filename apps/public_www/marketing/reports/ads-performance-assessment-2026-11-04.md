# Google Ads Performance Assessment and Restructure

**Date**: 2026-11-04 (Wednesday)
**Previous assessment**: 2026-04-17 (201 days ago)
**Data sources**: Google Ads API (v26), GA4 Data API (v1beta), GA4 Admin
API (v1alpha). Raw pulls: `generated-reports/2026-11-04-google-ads.txt`,
`generated-reports/2026-11-04-ga4.txt` (git-ignored).

This report answers one question: *is the Google Ads spend producing
value?* Short answer: **no, not in its April shape**. The account spent
HK$1,520/month on autopilot for six months, roughly two thirds of it on
one broad-match keyword whose traffic was 91% irrelevant. The second half
of the report lists what was changed in the live account today and what
still needs a human.

---

## Executive Summary

| Metric | 2026-04-17 | 2026-11-04 | Change |
|---|---|---|---|
| Spend (all time) | HK$1,277 | **HK$11,190** | +HK$9,913 |
| Impressions (all time) | 2,516 | 39,044 | +36,528 |
| Clicks (all time) | 136 | 1,700 | +1,564 |
| CPC (all time) | HK$9.39 | HK$6.58 | -HK$2.81 |
| Google-attributed primary conversions (all time) | 0 | **0** | — |
| Soft conversions (all conv, all time) | n/a | 24 | — |
| Daily budget | HK$50 | HK$30 (after today) | -HK$20 |

- **Spend was flat at HK$1,520/month from April to October** with zero
  primary conversions. 24 "all conversions" over the life of the account
  are WhatsApp clicks, Confirm-and-Pay clicks and one guide download;
  none is a paid booking.
- **One keyword ate the budget.** Broad-match `montessori consultation`
  (Family Consultations ad group) spent HK$3,069 in the last 90 days, 62%
  of lifetime spend, and **83% of October spend**. Search-term review
  shows only **9%** of that money went to relevant queries; 36% was
  navigational (`solidmemory`, `i learner`, `sunshine online`, `eclass`,
  `starfall`), 26% generic how-to parenting questions, 29% other generic.
- **The ad group that works was starved.** Helper Training Course produced
  8 of the 10 soft conversions in the last 90 days at HK$142 per soft
  conversion, against HK$1,651 for Family Consultations, yet got only
  17% of October spend because Maximize Clicks chases the cheapest clicks.
- **Impression share is 10%**, lost mostly to **rank (69–75%)**, not
  budget (16–21%). Quality Scores are 3–7 with landing page experience
  **below average** on every scored keyword. More budget would not help;
  better relevance and a better landing page would.
- **54% of search-term spend is hidden** by Google ("Other search
  terms"), so the leak list above is a floor, not a ceiling.
- **Measurement is weaker than it looks.** The two "GA4 - …" WEBPAGE
  conversion actions have never fired because the site has no `AW-`
  Google Ads tag; only the GA4-imported actions carry data. Until today
  the real lead signals (`whatsapp_click`, `booking_confirm_pay_click`)
  were *secondary*, so bidding had nothing to optimise toward.

### Monthly trend (since March)

| Month | Cost | Imp | Clicks | CPC | Soft conv | FC share of spend |
|---|---|---|---|---|---|---|
| 2026-03 | HK$392 | 555 | 30 | HK$13.07 | 0 | 0% |
| 2026-04 | HK$1,508 | 4,047 | 212 | HK$7.11 | 1 | 36% |
| 2026-05 | HK$1,519 | 6,095 | 221 | HK$6.87 | 2 | 71% |
| 2026-06 | HK$1,524 | 5,381 | 226 | HK$6.74 | 4 | 75% |
| 2026-07 | HK$1,520 | 4,742 | 225 | HK$6.76 | 7 | 75% |
| 2026-08 | HK$1,519 | 5,872 | 236 | HK$6.44 | 7 | 69% |
| 2026-09 | HK$1,518 | 6,392 | 273 | HK$5.56 | 2 | 72% |
| 2026-10 | HK$1,520 | 5,445 | 251 | HK$6.06 | 0 | **83%** |

FC = Family Consultations ad group. The drift toward FC is the automated
bidder, not a decision anyone made: broad match plus Maximize Clicks
rewards whichever keyword buys the cheapest clicks.

---

## Google Ads Assessment (last 90 days, 2026-08-06 → 2026-11-03)

### Ad groups

| Ad group | Imp | Clicks | CTR | CPC | Cost | Soft conv | Cost / soft conv |
|---|---|---|---|---|---|---|---|
| Family Consultations | 14,507 | 556 | 3.83% | HK$5.94 | HK$3,301 | 2 | HK$1,651 |
| Helper Training Course | 2,827 | 191 | 6.76% | HK$5.95 | HK$1,136 | 8 | HK$142 |

### Keywords with impressions

| Keyword | Match | QS (LP exp.) | Cost | Clicks | Soft conv |
|---|---|---|---|---|---|
| montessori consultation | BROAD | n/a | HK$3,069 | 516 | 0 |
| montessori helper training | BROAD | 7 (below avg) | HK$453 | 77 | 6 |
| helper training hong kong | PHRASE | 3 (below avg) | HK$345 | 58 | 1 |
| family consultation hong kong | BROAD | n/a | HK$179 | 31 | 2 |
| helper training hong kong | BROAD | 3 (below avg) | HK$176 | 29 | 0 |
| childcare helper training | PHRASE | n/a | HK$94 | 16 | 1 |
| domestic helper course hong kong | PHRASE | n/a | HK$60 | 10 | 0 |
| positive discipline hong kong | BROAD | 3 (below avg) | HK$54 | 9 | 0 |

56 enabled keywords had zero impressions.

### Search-term relevance (visible terms only)

| Keyword | Spend | Relevant | Navigational | How-to | Other |
|---|---|---|---|---|---|
| montessori consultation | HK$1,521 | **9%** | 36% | 26% | 29% |
| montessori helper training | HK$211 | 44% | 0% | 9% | 47% |
| helper training hong kong | HK$169 | 38% | 30% | 3% | 29% |
| family consultation hong kong | HK$53 | 0% | 12% | 23% | 65% |

Top leaks: `solidmemory` / `solid memory` (HK$327, 60 clicks, 0 conv),
`i learner` URLs (HK$58), `sunshine online`, `starfall com`, `eclass`,
`ymca … domestic helper courses`, `caregiver school in hk`, tantrum /
potty / ADHD / autism how-to questions.

### Devices

Mobile: 16,452 imp, 690 clicks, HK$4,111, 10 soft conv. Tablet and
desktop together: HK$327, 0 soft conv.

### Conversion actions (before today)

| Action | Source | Status | Role |
|---|---|---|---|
| GA4 - Booking Submit Success | WEBPAGE (Ads tag) | ENABLED | primary, never fires |
| GA4 - Contact Form Submit Success | WEBPAGE (Ads tag) | ENABLED | secondary, never fires |
| booking_submit_success | GA4 import | HIDDEN | — |
| contact_form_submit_success | GA4 import | HIDDEN | — |
| booking_confirm_pay_click | GA4 import | ENABLED | secondary |
| whatsapp_click | GA4 import | ENABLED | secondary |
| media_form_submit_success | GA4 import | ENABLED | secondary |
| community_signup_submit_success | GA4 import | ENABLED | secondary |

---

## GA4 (last 30 days)

- 484 sessions, 431 users, 8 conversions, bounce 71.9%.
- `google/cpc`: 227 sessions (47% of all traffic), 69 engaged, **2
  conversions**, bounce 70%.
- `(direct)/(none)`: 203 sessions, 1 conversion.
- Google organic: 9 sessions, bounce 22%.

### Booking funnel

| Event | Events | Users |
|---|---|---|
| booking_age_selected | 52 | 16 |
| booking_date_selected | 1 | 1 |
| booking_confirm_pay_click | 1 | 1 |
| booking_submit_success | 0 | 0 |
| whatsapp_click | 6 | 6 |
| media_form_submit_success | 1 | 1 |

**The age → date "drop-off" is a measurement artefact, not a bug.** In
`my-best-auntie-booking.tsx` the first available date is pre-selected
(`findPreferredCohortId`) as soon as an age is chosen, and
`booking_date_selected` only fires when a visitor clicks a *different*
date card. So 15 of 16 users never needed to click a date. The real
funnel is: 16 users touched the age selector (3.25 clicks each, i.e.
they toggled between age groups), **1** pressed Confirm and Pay, **0**
completed. The price (HK$9,000) only appears after an age is picked and
the course page has no WhatsApp CTA near the widget, which is what the
new landing page fixes.

### Google Ads conversion tag

No `AW-` / `gtag('config', 'AW-…')` exists anywhere in
`apps/public_www/src`. All Google Ads conversion data comes through the
GA4 link. The two WEBPAGE actions are dead and can be ignored; making the
GA4 imports primary (done today) is the correct fix. Enhanced Conversions
and a first-party Ads tag remain UI/consent decisions (see manual steps).

### GA4 → Google Ads audience export

Admin API read-back (`ga4-audience-link-diagnosis` in the artifacts):

- Two Google Ads links exist on the property, both with
  `ads_personalization_enabled = True`; one is CID `4991144901`, the
  other is an unrelated customer `6286485411` created the same day.
- Five audiences exist (`All Users`, `Purchasers`, `Course Page
  Visitors`, `High-Engagement Visitors`, `Booking Intent - Did Not
  Complete`), all with ads personalisation on.
- **Google Signals is `GOOGLE_SIGNALS_DISABLED`.** This is why every
  GA4-sourced user list in Google Ads shows **search size 0** while the
  legacy AdWords-tag lists show 150. GA4 audiences cannot be used for
  Search remarketing (RLSA) or Display without Google Signals (or a
  consent-mode identity source). Turning it on is a privacy-policy and
  consent decision, so it is left as a manual step.

---

## What was changed in the live account today

Applied with `scripts/apply/google-ads-apply-nov-restructure.py --apply
--all` (idempotent; the re-run printed only skips). Read-back is in
`generated-reports/2026-11-04-google-ads.txt`.

| Step | Result |
|---|---|
| `negatives` | +28 phrase negatives on both search campaigns (65 total each): navigational (`solid memory`, `solidmemory`, `starfall`, `sunshine online`, `eclass`, `i learner`, `kindergarten`, `school(s)`, `playschool`, `academy`, `app(s)`, `toys`, `pdf`, `books`), how-to questions (`tantrum(s)`, `potty`, `adhd`, `autism`, `newborn`, `teenager(s)`, `milestones`) and `caregiver`. `ymca` and `i learner` widened from EXACT to PHRASE. |
| `consult-campaign` | New campaign **My Best Auntie — Consultations — HK** (ID `24433649251`), HK$12/day, Maximize Clicks with HK$12 ceiling, Google Search only, Hong Kong presence, English. Ad group `Family Consultations` (ID `204247506200`) with 14 PHRASE/EXACT keywords only, RSA `830514546881` (review in progress), 6 sitelinks cloned. |
| `pause-old-consult` | Original `Family Consultations` ad group (`195398533196`) **PAUSED**: broad `montessori consultation`, `family consultation hong kong`, `positive discipline hong kong` stop serving. |
| `pause-helper-broad` | BROAD `helper training hong kong` paused (HK$1,087 lifetime, 0 soft conv; its PHRASE twin stays). |
| `budget` | Search campaign budget HK$50 → **HK$30/day**. Combined daily cap is now HK$42 instead of HK$50, with ~70% of it on Helper Training. |
| `primary-conv` | `whatsapp_click`, `media_form_submit_success`, `booking_confirm_pay_click`, `booking_submit_success` → **ENABLED, primary**; `contact_form_submit_success` → ENABLED, secondary. |
| `assets` | 6 callouts (3 course-only ones restricted to the Search campaign), 1 structured snippet (Services), "Book a Free 15-min Call" sitelink to `/en/book-a-free-call` on both campaigns. |

Not applied yet: `helper-lp-url` (points the Helper Training ads at
`/en/helper-training-hong-kong`). Run it once this PR is deployed:

```bash
python3 scripts/apply/google-ads-apply-nov-restructure.py --apply --steps helper-lp-url
```

### Code shipped in the same PR

- **`/en/helper-training-hong-kong`** (also `zh-CN`, `zh-HK`): a
  course-booking landing page for paid traffic. Hero shows the price and
  next cohort from the CRM calendar, a "See dates & book" anchor and an
  "Ask on WhatsApp" button above the fold; the cohort picker with
  Confirm and Pay sits directly under the hero, then what's included,
  good-to-know, testimonials, coach, FAQ. No outline, no mid-page CTA
  strip, nothing to distract from booking or messaging.
- `google-ads-assessment.py` moved to API v26 (v20 is sunset) and now
  prints monthly trend, spend mix by ad group, impression-share loss
  split, hidden-term share and a per-keyword relevance bucket.

---

## Expected effect and kill criteria

With the broad consultation keyword off and the negatives in place, the
realistic outcome is **HK$900–1,250/month** spend (down from HK$1,520),
most of it on helper-training queries at ~HK$6 CPC, i.e. ~150–200 clicks
a month to a page built to convert. At the historical 4% soft-conversion
rate on Helper Training traffic that is 6–8 lead actions a month; the
landing page should lift it.

Review on **2026-12-16** (6 weeks):

- **Pause Google Ads and move the budget to Meta** if the two campaigns
  together produced fewer than **10 primary conversions** (WhatsApp,
  guide, Confirm-and-Pay, booking) or cost more than **HK$300 per
  primary conversion**.
- Do **not** switch to Target CPA until a campaign has **15+ primary
  conversions in a 30-day window**; before that the bidder has nothing
  to learn from.
- Keep the Consultations campaign only if it books at least one call or
  consultation; otherwise fold its budget into Helper Training.

One course booking (HK$9,000) covers roughly eight months of the new
spend level, so the bar is one booking per two quarters for the channel
to be worth keeping.

---

## Still needs a human

Listed in `google-ads-manual-setup-steps.md` §10 and
`ga4-manual-setup-steps.md` §12:

1. Run `--steps helper-lp-url` after deploy, then watch QS / landing
   page experience on the Helper Training keywords.
2. Approve the new Consultations RSA if it is still "review in progress"
   after 24 h.
3. Decide on Google Signals (privacy policy update required) so the GA4
   audiences populate in Google Ads.
4. Add a call asset and image assets in the UI (no API path here: the
   business phone is a build-time placeholder and image assets need
   uploaded creatives).
5. Enhanced Conversions for Web (UI toggle, needs consent review).
