# Marketing Apply Scripts

Live, write-enabled scripts that operate on Google Ads, Meta, and GA4
via their respective APIs. Complement the read-only assessment scripts
one directory up.

Every apply script follows the same contract:

- `--dry-run` (default): list the operations that would run.
- `--apply`: actually mutate the remote platform.
- Idempotent: re-runs are safe and print "skip (exists)" for no-ops.

Source of truth for the "why" behind each change:

- `apps/public_www/marketing/reports/ads-performance-assessment-2026-04-17.md`
  (assessment + improvement plan).
- `apps/public_www/marketing/reports/google-ads-manual-setup-steps.md`
- `apps/public_www/marketing/reports/meta-ads-manual-setup-steps.md`
- `apps/public_www/marketing/reports/ga4-manual-setup-steps.md`

## Scripts

| Script | Platform | What it does |
|---|---|---|
| `meta-archive-ended-campaigns.py` | Meta | Archives campaigns whose status is ACTIVE/PAUSED and `stop_time` is in the past. |
| `meta-create-custom-audiences.py` | Meta | Creates 6 Custom Audiences (website, course page, Easter Reel viewers, IC-not-Purchase, IG engagers, FB engagers). **Requires one-time Custom Audience ToS acceptance** at `facebook.com/customaudiences/app/tos/?act=<acct_id>` before first run. |
| `meta-launch-video-traffic-campaign.py` | Meta | Uploads a vertical video + thumbnail and creates one `OUTCOME_TRAFFIC` campaign → one `LANDING_PAGE_VIEWS` ad set (lifetime budget, fixed end date, HK targeting, Advantage audience off) → one video ad with a UTM-tagged `BOOK_NOW` link. Created PAUSED; `--apply --activate` on an existing campaign switches the whole tree on. `--replace-video` adds a new video as a fresh ad in the existing ad set and archives the old ads. `--video-id` / `--image-hash` reuse assets from an earlier run. |
| `google-ads-apply-tuesday-changes.py` | Google Ads | Adds campaign-level negative keywords, phrase-match variants of winners, and UTM-tags enabled ads' final URLs. |
| `google-ads-enable-secondary-conversions.py` | Google Ads | Promotes HIDDEN GA4-synced conversion actions to ENABLED + "Secondary" so they feed bidding without polluting ROAS. |
| `ga4-mark-key-events.py` | GA4 | Creates KeyEvent resources for taxonomy events we want Google Ads to auto-sync as conversion actions. |

## Applied on 2026-04-17

| Script | Result |
|---|---|
| `meta-archive-ended-campaigns.py --apply` | Archived `Easter Workshop — Traffic — HK` and `Instagram Boost — Organic Top Performers`. |
| `meta-create-custom-audiences.py --apply` | **BLOCKED** by error 2663 (Custom Audience ToS not accepted). Human must click through the one-time ToS, then re-run. |
| `google-ads-apply-tuesday-changes.py --apply --all` | Added 29 campaign-level negative keywords, 3 phrase-match variants on Helper Training Course, UTM-tagged 3 enabled ads. |
| `ga4-mark-key-events.py --apply` | Created Key Events for `booking_confirm_pay_click` and `whatsapp_click`. |
| `google-ads-enable-secondary-conversions.py --apply` | Promoted 4 HIDDEN conversion actions to ENABLED (Secondary): media_form, community_signup, booking_confirm_pay_click, whatsapp_click. |

## Applied on 2026-11-09

| Script | Result |
|---|---|
| `meta-launch-video-traffic-campaign.py --apply` | Created `Mealtimes Workshop — Traffic — HK` (campaign `120252906972330439`, ad set `120252906983060439`, ad `120252906985180439`, video `1867110284305793`) **PAUSED**, HK$350 lifetime, women 28–45 in HK, landing page `/en/nov-2026-mealtimes-workshop` with `utm_content=reel-mealtimes-v3`. Left paused because the export's opening title (0–1.6s) showed the end-card line instead of the hook. |
| `meta-launch-video-traffic-campaign.py --replace-video --apply --activate` | Re-exported video (`1833537467959198`, 59.3s, hook and end card fixed) uploaded as ad `120252907392670439` (`utm_content=reel-mealtimes-v4`) in the same ad set; v3 ad `120252906985180439` archived; campaign, ad set and ad **ACTIVE** at 23:03 HKT. Ad in Meta review (`IN_PROCESS`). Lifetime budget and 16 Nov end date unchanged. |
| Manual pause, 23:26 HKT (`POST /120250911167180439` `status=PAUSED`) | Paused `My Best Auntie — Free Intro Call — Click-to-WhatsApp` so it stops bidding against Mealtimes for the same HK women. Its two ad sets (Cold HK$56/day, Warm HK$14/day) keep their settings; setting the campaign back to ACTIVE resumes both. **Resume on 16 Nov 2026**, after the Mealtimes ad set ends. Free Guide Downloads stays paused. |

Two Marketing API changes bit on this run and are now baked into the
script: campaigns with ad-set budgets must send
`is_adset_budget_sharing_enabled`, and `LANDING_PAGE_VIEWS` ad sets on this
account take `promoted_object={"page_id": ...}`, not the pixel.

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
