# Marketing Apply Scripts

Live, write-enabled scripts that operate on Google Ads, Meta, and GA4
via their respective APIs. Complement the read-only assessment scripts
one directory up.

Install the same venv as the assessment scripts first
(`marketing/README.md` Prerequisites). A raw `python3` on Alpine
raises `ModuleNotFoundError: google` because `google-ads` is not on
the system interpreter.

Every apply script follows the same contract:

- `--dry-run` (default): list the operations that would run.
- `--apply`: actually mutate the remote platform.
- Idempotent: re-runs are safe and print "skip (exists)" for no-ops.

Source of truth for the "why" behind each change:

- `apps/public_www/marketing/reports/ads-performance-assessment-2026-04-17.md`
  (assessment + improvement plan).
- `apps/public_www/marketing/reports/ads-performance-assessment-2026-11-04.md`
  (Google Ads restructure: campaign split, primary conversions, kill criteria).
- `apps/public_www/marketing/reports/google-ads-manual-setup-steps.md`
- `apps/public_www/marketing/reports/meta-ads-manual-setup-steps.md`
- `apps/public_www/marketing/reports/ga4-manual-setup-steps.md`

## Scripts

| Script | Platform | What it does |
|---|---|---|
| `meta-archive-ended-campaigns.py` | Meta | Archives campaigns whose status is ACTIVE/PAUSED and `stop_time` is in the past. |
| `meta-create-custom-audiences.py` | Meta | Creates 6 Custom Audiences (website, course page, Easter Reel viewers, IC-not-Purchase, IG engagers, FB engagers). **Requires one-time Custom Audience ToS acceptance** at `facebook.com/customaudiences/app/tos/?act=<acct_id>` before first run. |
| `google-ads-apply-tuesday-changes.py` | Google Ads | Adds campaign-level negative keywords, phrase-match variants of winners, and UTM-tags enabled ads' final URLs. |
| `google-ads-enable-secondary-conversions.py` | Google Ads | Promotes HIDDEN GA4-synced conversion actions to ENABLED + "Secondary" so they feed bidding without polluting ROAS. |
| `ga4-mark-key-events.py` | GA4 | Creates KeyEvent resources for taxonomy events we want Google Ads to auto-sync as conversion actions. |
| `google-ads-apply-nov-restructure.py` | Google Ads | November 2026 restructure. Steps: `negatives`, `consult-campaign` (new phrase/exact-only Consultations campaign + RSA + sitelinks), `pause-old-consult`, `pause-helper-broad`, `budget`, `primary-conv`, `assets`, and `helper-lp-url`. `--all` runs every step except `helper-lp-url`; pass `--steps` to pick. |

## Applied on 2026-11-04

| Script | Result |
|---|---|
| `google-ads-apply-nov-restructure.py --apply --all` | +28 phrase negatives on both search campaigns; created `My Best Auntie — Consultations — HK` (HK$12/day, 14 phrase/exact keywords, 1 RSA, 6 sitelinks); paused the old `Family Consultations` ad group and the broad `helper training hong kong` keyword; Search budget HK$50 → HK$30/day; `whatsapp_click`, `media_form_submit_success`, `booking_confirm_pay_click`, `booking_submit_success` set to primary; 6 callouts, 1 structured snippet, 1 free-call sitelink. Re-run printed only skips. |
| `google-ads-apply-nov-restructure.py --apply --steps helper-lp-url` | **Deferred** until `/en/helper-training-hong-kong` is deployed. The step fetches the page and aborts on a non-200 response. |

## Applied on 2026-04-17

| Script | Result |
|---|---|
| `meta-archive-ended-campaigns.py --apply` | Archived `Easter Workshop — Traffic — HK` and `Instagram Boost — Organic Top Performers`. |
| `meta-create-custom-audiences.py --apply` | **BLOCKED** by error 2663 (Custom Audience ToS not accepted). Human must click through the one-time ToS, then re-run. |
| `google-ads-apply-tuesday-changes.py --apply --all` | Added 29 campaign-level negative keywords, 3 phrase-match variants on Helper Training Course, UTM-tagged 3 enabled ads. |
| `ga4-mark-key-events.py --apply` | Created Key Events for `booking_confirm_pay_click` and `whatsapp_click`. |
| `google-ads-enable-secondary-conversions.py --apply` | Promoted 4 HIDDEN conversion actions to ENABLED (Secondary): media_form, community_signup, booking_confirm_pay_click, whatsapp_click. |

## What is deliberately NOT in an apply script

- **Enhanced Conversions for Web** on Google Ads — no API surface, UI
  toggle only. See
  `../reports/google-ads-manual-setup-steps.md` §1.
- **Meta billing / Business Verification / account status = 9** — no
  API surface; requires a card + verification flow in Business Manager.
- **Launching or un-pausing paid campaigns** (Display remarketing,
  Free Guide relaunch, Evergreen brand, Performance Max) — these
  commit real HKD daily budgets and deserve explicit per-campaign
  human sign-off.
- **Consent Mode v2 banner, CAPI relay Lambda, CloudFront 308
  redirects** — separate code / infra PRs.
