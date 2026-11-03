# Instagram Reels Assessment — Reel vs Reel

**Date**: 2026-10-28 (Wednesday, 19:06 HKT)
**Account**: `@evolvesprouts` (Instagram business account)
**Data source**: Instagram Graph API via
`scripts/instagram-assessment.py --reels` (read-only), plus a local
`ffprobe` pass over each downloaded Reel for duration and blank-frame
detection. Raw output: `generated-reports/2026-10-28-instagram-reels.txt`.
**Companion report**: `instagram-organic-assessment-2026-10-28.md`
(stories and 30-day baseline).

None of the 20 Reels on the account were boosted (the three ads in the ad
account reference other posts), so every number below is organic.

---

## Executive Summary

| Reel | Length | Reach | Avg watch | Watched % | Skip rate | Interactions | Int. / reach |
|---|---|---|---|---|---|---|---|
| Oct 27 — velcro pizza honest review | **210s** (100s content + **110s white screen**) | 111 | 16.6s | 8% | 63% | 7 | 6.3% |
| Sep 22 — meltdown in Causeway Bay | 130s | 260 | 18.9s | 15% | 54% | 17 | 6.5% |
| Jul 29 — three things I don't stop my toddler doing | 26s | 362 | 9.0s | 34% | 48% | 7 | 1.9% |
| Apr 28 — "my dad says I turned out fine" | **8s** | **1,282** | 6.9s | **87%** | **38%** | 14 | 1.1% |
| Apr 11 — stock-footage "chaos at home?" | 15s | 123 | 4.8s | 31% | **74%** | 1 | 0.8% |
| Mar 30 — helper and play (event promo) | 23s | 257 | 6.1s | 27% | 56% | 3 | 1.2% |

- **Attention caps at about 17–19 seconds regardless of length.** The two
  long talking-head Reels earn the longest watch time on the account, but
  at 130s and 210s that is 8–15% of the video. The algorithm scores
  watched-percentage, so length is working against the best content.
- **The two formats do different jobs.** Short real-footage Reels with one
  line of text (Apr 28, Feb 4) carry reach (1,282 and 744); long personal
  talking-heads (Sep 22, May 2025 toy tips) carry engagement (6–9% of
  reach interacting). The Oct 27 Reel is a talking-head at the far end of
  the length scale and got neither: the lowest reach of any real-footage
  Reel this year.
- **The Oct 27 Reel is broken.** The file is 210s long but the picture goes
  to pure white at 1:40 and the audio to silence; the last 110 seconds are
  blank. Anyone who stays past the ending sees a white screen, and the
  blank tail halves the completion rate Instagram uses to rank it.
- **Facebook crossposting has collapsed.** Earlier 2026 Reels picked up
  254–548 Facebook views each; the Sep 22 Reel got 54 and the Oct 27 Reel
  got 5. Worth checking whether the Facebook share setting changed.
- **Stock footage is the worst performer on every metric** (Apr 11: 74%
  skip rate, 0.8% interaction rate). Real children in real Hong Kong homes
  are the account's edge.

---

## All 20 Reels, newest first

ER = total interactions / reach. Watched % = average watch time / video
length. Skip rate and FB views are only served by the API for the six
most recent Reels. Earlier Reels ran on a smaller follower base, so reach
comparisons across a year favour the recent ones slightly.

| Posted (HKT) | Len | Reach | Views | Avg watch | Watched % | Skip % | Likes | Cmts | Saves | Shares | ER | FB views | Subject |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-27 Tue 19:00 | 210s | 111 | 192 | 16.6s | 8% | 63 | 6 | 0 | 1 | 0 | 6.3% | 5 | Velcro pizza honest review (talking head) |
| 2026-09-22 Tue 19:57 | 130s | 260 | 415 | 18.9s | 15% | 54 | 12 | 2 | 2 | 0 | 6.5% | 54 | Causeway Bay meltdown story (talking head) |
| 2026-07-29 Wed 18:35 | 26s | 362 | 444 | 9.0s | 34% | 48 | 6 | 0 | 1 | 0 | 1.9% | 390 | 3 things I don't stop my toddler doing (text over footage) |
| 2026-04-28 Tue 09:30 | 8s | **1,282** | 1,879 | 6.9s | 87% | 38 | 10 | 2 | 2 | 0 | 1.1% | 548 | "My dad says I turned out fine" (one line over footage) |
| 2026-04-11 Sat 07:05 | 15s | 123 | 172 | 4.8s | 31% | 74 | 1 | 0 | 0 | 0 | 0.8% | 254 | Chaos at home vs school (stock footage) |
| 2026-03-30 Mon 12:28 | 23s | 257 | 288 | 6.1s | 27% | 56 | 2 | 0 | 1 | 0 | 1.2% | 444 | What if your helper knew what to do during play (event promo) |
| 2026-03-24 Tue 18:29 | 49s | 324 | 389 | 5.0s | 10% | — | 3 | 0 | 1 | 1 | 1.5% | — | Your child can't play alone? (text over footage) |
| 2026-02-17 Tue 11:55 | 14s | 262 | 419 | 5.0s | 35% | — | 6 | 0 | 0 | 0 | 2.3% | — | It isn't about the garlic (child peeling garlic) |
| 2026-02-11 Wed 16:55 | 10s | 283 | 432 | 6.9s | 71% | — | 8 | 0 | 1 | 0 | 3.2% | — | Let your children help |
| 2026-02-04 Wed 10:25 | 18s | **744** | 1,006 | 9.4s | 54% | — | 11 | 0 | 1 | **4** | 2.2% | — | "She's only 13 months old" (real footage) |
| 2025-11-22 Sat 13:54 | 8s | 224 | 403 | 7.1s | 90% | — | 4 | 2 | 0 | 1 | 3.1% | — | Elf on the Shelf reminder |
| 2025-09-04 Thu 09:30 | 8s | 212 | 306 | 6.0s | 71% | — | 6 | 0 | 1 | 0 | 3.3% | — | Baby helping with laundry |
| 2025-08-26 Tue 12:35 | 6s | 178 | 229 | 3.4s | 54% | — | 4 | 0 | 0 | 1 | 2.8% | — | Absorbent mind stat |
| 2025-08-13 Wed 12:00 | 16s | 168 | 207 | 4.0s | 24% | — | 6 | 3 | 1 | 0 | 6.0% | — | Hours with your helper (course lead-in) |
| 2025-07-08 Tue 12:00 | 13s | 92 | 129 | 3.6s | 27% | — | 6 | 2 | 1 | 0 | 9.8% | — | 15% off course, 3 days left (promo) |
| 2025-07-01 Tue 09:10 | 16s | 195 | 231 | 6.0s | 36% | — | 6 | 0 | 0 | 1 | 3.6% | — | Montessori coat flip |
| 2025-06-08 Sun 09:00 | 16s | 120 | 174 | 5.6s | 34% | — | 7 | 0 | 0 | 0 | 5.8% | — | Caregivers and Montessori in HK |
| 2025-06-03 Tue 13:21 | 16s | 102 | 152 | 5.9s | 36% | — | 8 | 0 | 0 | 0 | 7.8% | — | Montessori begins at birth |
| 2025-05-19 Mon 12:06 | 34s | 260 | 409 | 16.3s | 48% | — | **17** | **4** | 2 | 1 | **9.2%** | — | Toy don'ts (talking head, list) |
| 2025-05-16 Fri 10:37 | 24s | **438** | 646 | 10.4s | 44% | — | **25** | 1 | **3** | 1 | 6.8% | — | Tips for playing with toys (talking head, list) |

Account medians across the 20: reach 240, length 16s, watched 35%,
interaction rate 3.2%.

---

## The six most recent, one by one

### Oct 27 — velcro pizza honest review (210s)

- **What happens on screen.** 0–20s: a static product image fills the top
  two-thirds, the presenter is a small picture-in-picture at the bottom,
  and the opening line is "A mom I work with today asked me what I think
  about this toy". The verdict and the proof footage (toddler cutting a
  real banana with a crinkle cutter) arrive after 20s. Burned-in captions
  are a small serif font in the lower third. At **1:40 the picture goes
  white and the audio goes silent**, and the file continues like that to
  3:30.
- **Numbers.** 111 reach, the lowest of 2026 apart from the stock-footage
  Reel. 63% skip rate (second worst). 16.6s average watch is the third
  highest on the account, which says the content holds people once they
  commit, but 8% watched-percentage is the lowest ever.
- **Read.** Three independent problems: a slow hook, a length no one
  finishes, and a broken export. The same content ran as a 60s story the
  same night and reached 92, so the material itself is fine.

### Sep 22 — meltdown in Causeway Bay (130s)

- **On screen.** Talking head at a window, orange auto-captions. Opens
  with "Hi!" and "So, I..." for the first 3 seconds; the hook sentence
  ("I gave her the warning. She melted down anyway.") is in the caption,
  not on screen.
- **Numbers.** 260 reach, **17 interactions, 2 comments, 1 repost, 6.5%
  interaction rate**; 18.9s average watch is the highest on the account.
- **Read.** This is the best engagement format the account has: a
  personal, specific, Hong Kong-located story told to camera. It is twice
  as long as the attention it gets. The first 3 seconds are a greeting
  rather than a hook.

### Jul 29 — three things I don't stop my toddler doing (26s)

- **On screen.** Big text hook ("3 THINGS I DON'T STOP MY TODDLER DOING")
  over real footage from frame one; numbered cards 1, 2, 3; closing
  nuance card.
- **Numbers.** 362 reach, 48% skip, 9.0s average watch (34% watched),
  1.9% interaction rate, 390 Facebook views.
- **Read.** The hook works (lowest skip rate of the long-ish Reels) and
  the list format signals its length. People leave after card 1 or 2
  because each card is a full paragraph of text. It asks for nothing at
  the end, so reach did not convert to interactions.

### Apr 28 — "my dad says I turned out fine without all this" (8s)

- **On screen.** Mother and child walking in a park, one sentence in a
  speech bubble, a second bubble "but I don't agree" at 3s. The caption
  carries the whole story.
- **Numbers.** **1,282 reach, 1,879 views** — 3x any other Reel. 38% skip
  rate (best), 87% watched. 14 interactions, 1.1% interaction rate.
- **Read.** The reach template: a relatable one-liner every parent has
  heard, real footage, under 10 seconds, nothing to skip. It is low on
  interactions because there is nothing to respond to on screen; the
  question lives in the caption.

### Apr 11 — chaos at home vs school (15s)

- **On screen.** A montage of stock clips of other people's children, a
  few words of text per clip.
- **Numbers.** 123 reach, **74% skip rate**, 0.8% interaction rate, 1 like.
- **Read.** The worst Reel on the account on every measure. Stock
  footage reads as an ad and removes the one thing the account has that
  larger parenting pages do not: real Hong Kong children and homes.

### Mar 30 — helper and play (23s, event promo)

- **On screen.** Real baby with stacking rings, large text hook ("What if
  your helper knew exactly what to do during play?"), event details card,
  "link in bio".
- **Numbers.** 257 reach, 56% skip, 1.2% interaction rate, 444 Facebook
  views.
- **Read.** Decent reach for a promo, which the hook earned; the event
  card and "link in bio" ending is where people leave.

Frame sheets (first second of each 2026 Reel, and 0s/1s/2s/3s plus
quartile frames per Reel) were reviewed for the reads above; they are not
committed with this report.

---

## What separates the winners

| Pattern | Evidence |
|---|---|
| **Under 20s with one relatable line → reach** | Apr 28 (8s) 1,282; Feb 4 (18s) 744 with 4 shares; Feb 11 (10s) 283 at 71% watched. |
| **Talking head with a personal story → engagement** | Sep 22 6.5% ER and 2 comments; May 2025 toy-tips pair 6.8–9.2% ER, 25 and 17 likes. |
| **Real footage beats stock** | Apr 11 stock montage: 74% skip, 0.8% ER. Every Reel above 250 reach uses the founder's own footage. |
| **Shares drive reach more than likes** | Feb 4 has the most shares (4) and the second-highest reach. Apr 28 has 0 shares but 1,282 reach, so a universal one-liner can also travel on its own. |
| **Lists signal length and lose people** | Jul 29 and May 19 are list formats; both have strong hooks and both lose viewers card by card (34% and 48% watched). |
| **Promos reach fine, convert poorly** | Mar 30 and Jul 2025 promo Reels: 1.2% and 9.8% ER but the Jul 2025 one had the lowest reach on the account (92). |
| **Text hook on frame one** | Jul 29, Mar 30, Mar 24, Feb 4 all open with a full sentence on screen at 0s. Oct 27 opens on a product image; Sep 22 opens with "Hi!". |
| **Morning posts in the top two** | Apr 28 (09:30 HKT) and Feb 4 (10:25 HKT). Recent Reels went out at 19:00–20:00. Six 2026 Reels is too few to conclude; worth testing. |

---

## Recommendations

### Immediate

1. **Replace the Oct 27 Reel.** Delete it and re-upload a 35–45 second
   cut: open on the real-cutting shot with the verdict as large text
   ("The velcro pizza is fine. It just teaches the hand nothing."), keep
   the 20–60s section, end on a question ("Which toy should I review
   next?"). Instagram cannot trim a Reel after posting, so a re-upload is
   the only fix for the 110-second white tail. Before uploading, check the
   export in the Instagram preview to the final frame.
2. **Check Facebook crossposting.** Facebook views per Reel fell from
   254–548 (Mar–Jul) to 54 (Sep) and 5 (Oct). In the Instagram app:
   Settings → Sharing to other apps → Facebook → "Share your reels to
   Facebook" on, and the linked Page is the right one.

### Format rules for the next ten Reels

3. **Two formats, two jobs, nothing in between.**
   *Reach Reel*: 7–15s, real footage, one relatable sentence on screen
   from frame one, the nuance in the caption. Target one a week. Template
   is Apr 28 / Feb 4.
   *Depth Reel*: 45–75s talking head, personal and specific to Hong Kong,
   opens on the hook sentence as spoken and on screen, no greeting. Target
   one every two weeks. Template is Sep 22 minus the first 3 seconds and
   minus half the length.
4. **Hard cap at 90 seconds.** Average watch time has never exceeded 19
   seconds on this account; every second past the point people leave
   lowers watched-percentage and distribution.
5. **No stock footage.** The Apr 11 Reel is the control group.
6. **Ask for one thing at the end of every Reel.** The reach Reels run
   1–2% interaction rate because nothing on screen invites a response.
   End cards that worked elsewhere: a question ("Does your helper do
   this?"), or "send this to your helper/partner" (shares are the reach
   lever; Feb 4's four shares produced 744 reach).
7. **Captions on screen: bigger, higher, sans-serif.** Use Instagram's
   caption sticker or a large bold font inside the central safe zone.
   The Oct 27 small serif captions in the lower third are the least
   legible on the account.
8. **Cover frame and first frame should be the same sentence.** Feed
   visitors see the cover; the For You feed sees frame one. Make both the
   hook text.

### Cadence and measurement

9. **Three Reels in the last six months is the real constraint.** Reels
   are four of the five highest-reach posts the account has ever made.
   One reach Reel a week plus one depth Reel a fortnight is six Reels a
   month and reuses footage the account already films for sessions.
10. **Track three numbers per Reel** with
    `python3 scripts/instagram-assessment.py --reels`: skip rate (target
    under 50%), watched-percentage (target over 50% for reach Reels, over
    30% for depth Reels), and interactions per reach (target over 3%).
    Pull within two weeks of posting, before the API stops serving skip
    rate for older media.
11. **Test posting time.** Alternate 09:30 HKT and 19:00 HKT for the next
    six Reels and compare 48-hour reach.

---

## Data Integrity Notes

- Instagram Graph API queried via system user token against the IG
  business account ID in `EVOLVESPROUTS_META_INSTAGRAM_BUSINESS_ACCOUNT_ID`.
  All calls read-only.
- `reels_skip_rate`, `facebook_views` and `reposts` are only served for
  the six most recent Reels; older Reels return an opaque "Fatal" error for
  those metrics and the script falls back to the basic set.
- Video length and the blank-tail check come from `ffprobe`/`ffmpeg` on
  the `media_url` files, not from the API (the API does not expose
  duration). Blank detection flagged frames with mean luminance ≥ 250 of
  255; only the Oct 27 Reel had any (111 trailing seconds), and its audio
  track is −91 dB (silence) over the same span.
- Watched % is average watch time divided by video length and is a proxy;
  Instagram's own completion metric is not exposed via the API.
- Boost check: `act_…/ads` creatives reference three feed posts, none of
  the 20 Reels.
- Follower count was 405 at pull time; the account was smaller when the
  2025 and early-2026 Reels ran, which flatters recent reach slightly in
  the comparison.
