"""Meta Ads — launch a single-video traffic campaign for a landing page.

Builds the recipe that worked for the Easter 2026 workshop: one campaign
(OUTCOME_TRAFFIC), one ad set optimised for landing-page views with a
lifetime budget and a fixed end date, one ad whose creative is a vertical
video served from the Instagram account, with the destination URL tagged
per the UTM convention in ../../README.md.

Idempotent on campaign name: if a campaign with the same name already
exists, the script reports it and exits instead of creating a duplicate.

Required env vars:
    EVOLVESPROUTS_META_SYSTEM_USER_ACCESS_TOKEN
    EVOLVESPROUTS_META_AD_ACCOUNT_ID
    EVOLVESPROUTS_META_PAGE_ID
    EVOLVESPROUTS_META_INSTAGRAM_BUSINESS_ACCOUNT_ID

Usage:
    python3 scripts/apply/meta-launch-video-traffic-campaign.py \\
        --name "Mealtimes Workshop — Traffic — HK" \\
        --video /path/to/reel.mov --thumbnail /path/to/frame.jpg \\
        --link https://<site>/en/<slug> --utm-campaign mealtimes-workshop-nov-2026 \\
        --utm-content reel-mealtimes-v3 --budget-hkd 350 --days 7 \\
        --primary-text-file copy.txt --headline "..." --description "..." \\
        [--age-min 28 --age-max 45 --gender women] [--apply] [--activate]

Without --apply nothing is written. With --apply the campaign, ad set and ad
are created PAUSED. Add --activate to set all three ACTIVE in the same run
(the ad still goes through Meta review before delivery starts).

To swap the creative of a campaign this script already built, re-run with the
new --video / --thumbnail, a new --utm-content and --replace-video: the new
video becomes a fresh ad in the existing ad set (same budget and schedule) and
the previous ads are archived.
"""

import argparse
import json
import os
import sys
import time
from datetime import UTC, datetime, timedelta, timezone
from urllib.parse import urlencode

import requests

BASE_URL = "https://graph.facebook.com/v21.0"
HKT = timezone(timedelta(hours=8))
GENDERS = {"women": [2], "men": [1], "all": None}


def _env(name):
    value = os.environ.get(name, "")
    if not value:
        sys.exit(f"{name} not set")
    return value


def _get(path, params=None):
    resp = requests.get(
        f"{BASE_URL}/{path}",
        params={
            **(params or {}),
            "access_token": _env("EVOLVESPROUTS_META_SYSTEM_USER_ACCESS_TOKEN"),
        },
        timeout=60,
    )
    if resp.status_code >= 300:
        print(f"  !! GET {path} -> HTTP {resp.status_code}: {resp.text[:400]}")
        resp.raise_for_status()
    return resp.json()


def _post(path, data=None, files=None):
    resp = requests.post(
        f"{BASE_URL}/{path}",
        data={
            **(data or {}),
            "access_token": _env("EVOLVESPROUTS_META_SYSTEM_USER_ACCESS_TOKEN"),
        },
        files=files,
        timeout=600,
    )
    if resp.status_code >= 300:
        print(f"  !! POST {path} -> HTTP {resp.status_code}: {resp.text[:600]}")
        resp.raise_for_status()
    return resp.json()


def _existing_campaign(account_id, name):
    data = _get(f"{account_id}/campaigns", {"fields": "id,name,status", "limit": 200})
    return next((c for c in data.get("data", []) if c["name"] == name), None)


def _activate_tree(campaign_id):
    print(f"Activating campaign {campaign_id} and everything under it...")
    for path in ("adsets", "ads"):
        for obj in _get(f"{campaign_id}/{path}", {"fields": "id,status"}).get(
            "data", []
        ):
            _post(obj["id"], {"status": "ACTIVE"})
            print(f"  {path[:-1]} {obj['id']} -> ACTIVE")
    _post(campaign_id, {"status": "ACTIVE"})
    print(f"  campaign {campaign_id} -> ACTIVE")


def _campaign_has_adsets(campaign_id):
    data = _get(f"{campaign_id}/adsets", {"fields": "id", "limit": 1})
    return bool(data.get("data"))


def _pixel_id(account_id):
    data = _get(f"{account_id}/adspixels", {"fields": "id,name,last_fired_time"})
    pixels = data.get("data", [])
    if not pixels:
        sys.exit(
            "No pixel on the ad account; LANDING_PAGE_VIEWS optimisation needs one"
        )
    return pixels[0]["id"]


def _tagged_link(link, utm_campaign, utm_content):
    params = {
        "utm_source": "meta",
        "utm_medium": "paid_social",
        "utm_campaign": utm_campaign,
        "utm_content": utm_content,
    }
    joiner = "&" if "?" in link else "?"
    return f"{link}{joiner}{urlencode(params)}"


def _upload_video(account_id, path):
    with open(path, "rb") as fh:
        res = _post(f"{account_id}/advideos", files={"source": fh})
    video_id = res["id"]
    for _ in range(60):
        status = _get(video_id, {"fields": "status"}).get("status", {})
        state = status.get("video_status")
        if state == "ready":
            return video_id
        if state == "error":
            sys.exit(f"Video processing failed: {json.dumps(status)}")
        time.sleep(10)
    sys.exit("Video did not finish processing in 10 minutes")


def _upload_thumbnail(account_id, path):
    with open(path, "rb") as fh:
        res = _post(f"{account_id}/adimages", files={"filename": fh})
    images = res.get("images", {})
    return next(iter(images.values()))["hash"]


def _targeting(args):
    targeting = {
        "geo_locations": {"countries": ["HK"], "location_types": ["home", "recent"]},
        "age_min": args.age_min,
        "age_max": args.age_max,
        "publisher_platforms": ["instagram", "facebook"],
        "instagram_positions": ["stream", "story", "reels"],
        "facebook_positions": ["feed", "story", "facebook_reels"],
        "targeting_automation": {"advantage_audience": 0},
    }
    genders = GENDERS[args.gender]
    if genders:
        targeting["genders"] = genders
    return targeting


def _schedule(days):
    start = datetime.now(UTC) + timedelta(minutes=10)
    end = start + timedelta(days=days)
    return start, end


def _print_plan(args, account_id, link):
    start, end = _schedule(args.days)
    print(f"Meta ad account: {account_id}")
    print(
        f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}"
        f"{' + ACTIVATE' if args.activate else ''}\n"
    )
    print("Campaign")
    print(f"  name:        {args.name}")
    print("  objective:   OUTCOME_TRAFFIC")
    print("Ad set")
    print(
        "  optimise:    LANDING_PAGE_VIEWS | billing IMPRESSIONS | LOWEST_COST_WITHOUT_CAP"
    )
    print(
        f"  budget:      HK${args.budget_hkd} lifetime over {args.days} days "
        f"(~HK${args.budget_hkd / args.days:.0f}/day)"
    )
    print(
        f"  schedule:    {start.astimezone(HKT):%Y-%m-%d %H:%M} -> "
        f"{end.astimezone(HKT):%Y-%m-%d %H:%M} HKT"
    )
    print(
        f"  targeting:   HK, {args.gender}, {args.age_min}-{args.age_max}, "
        "IG feed/story/reels + FB feed/story/reels, Advantage audience off"
    )
    print("Ad")
    print(f"  video:       {args.video} ({os.path.getsize(args.video) / 1e6:.1f} MB)")
    print(f"  thumbnail:   {args.thumbnail}")
    print(f"  link:        {link}")
    print(f"  headline:    {args.headline}")
    print(f"  description: {args.description}")
    print(f"  CTA:         {args.cta}")
    print("  primary text:")
    for line in args.primary_text.splitlines():
        print(f"    {line}")
    print()


def main():
    parser = argparse.ArgumentParser(
        description=__doc__ or "", formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--name", required=True)
    parser.add_argument("--video", required=True)
    parser.add_argument("--thumbnail", required=True)
    parser.add_argument("--link", required=True, help="Landing page URL without UTMs")
    parser.add_argument("--utm-campaign", required=True)
    parser.add_argument("--utm-content", required=True)
    parser.add_argument("--budget-hkd", type=int, required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--primary-text-file", required=True)
    parser.add_argument("--headline", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--cta", default="BOOK_NOW")
    parser.add_argument("--age-min", type=int, default=28)
    parser.add_argument("--age-max", type=int, default=45)
    parser.add_argument("--gender", choices=sorted(GENDERS), default="women")
    parser.add_argument("--video-id", help="Reuse an already-uploaded advideos id")
    parser.add_argument("--image-hash", help="Reuse an already-uploaded adimages hash")
    parser.add_argument(
        "--replace-video",
        action="store_true",
        help="Campaign exists: add the new video as a fresh ad in its ad set and archive the old ads",
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()

    with open(args.primary_text_file, encoding="utf-8") as fh:
        args.primary_text = fh.read().strip()

    account_id = _env("EVOLVESPROUTS_META_AD_ACCOUNT_ID")
    page_id = _env("EVOLVESPROUTS_META_PAGE_ID")
    ig_id = _env("EVOLVESPROUTS_META_INSTAGRAM_BUSINESS_ACCOUNT_ID")
    link = _tagged_link(args.link, args.utm_campaign, args.utm_content)

    _print_plan(args, account_id, link)

    existing = _existing_campaign(account_id, args.name)
    populated = bool(existing) and _campaign_has_adsets(existing["id"])
    if populated and args.replace_video:
        print(
            f"REPLACE: campaign '{args.name}' (id {existing['id']}) exists; the new "
            f"video becomes a fresh ad '{args.utm_content}' in its ad set and the "
            "current ads are archived."
        )
    elif populated:
        print(
            f"SKIP (exists): campaign '{args.name}' is {existing['status']} "
            f"(id {existing['id']}) and already has an ad set. Nothing created. "
            "Pass --replace-video to swap the creative."
        )
        if args.apply and args.activate:
            _activate_tree(existing["id"])
        return
    if not args.apply:
        print(
            "Dry-run only. Re-run with --apply to create (PAUSED), "
            "--apply --activate to create and switch on."
        )
        return

    _pixel_id(account_id)
    status = "ACTIVE" if args.activate else "PAUSED"
    start, end = _schedule(args.days)
    video_id, image_hash = _assets(args, account_id)

    if populated:
        adset = _get(f"{existing['id']}/adsets", {"fields": "id,name", "limit": 1})[
            "data"
        ][0]
        old_ads = _get(f"{adset['id']}/ads", {"fields": "id,name"}).get("data", [])
        ad = _create_ad(
            args, account_id, page_id, ig_id, adset, video_id, image_hash, link, status
        )
        for old in old_ads:
            _post(old["id"], {"status": "ARCHIVED"})
            print(f"Archived previous ad {old['id']} ({old['name']})")
        if args.activate:
            _activate_tree(existing["id"])
        _report(existing, adset, ad, args.activate)
        return

    if existing:
        campaign = existing
        print(f"Reusing empty campaign id={campaign['id']}")
    else:
        print("Creating campaign...", end=" ", flush=True)
        campaign = _post(
            f"{account_id}/campaigns",
            {
                "name": args.name,
                "objective": "OUTCOME_TRAFFIC",
                "status": status,
                "special_ad_categories": "[]",
                "buying_type": "AUCTION",
                "is_adset_budget_sharing_enabled": "false",
            },
        )
        print(f"id={campaign['id']}")

    print("Creating ad set...", end=" ", flush=True)
    adset = _post(
        f"{account_id}/adsets",
        {
            "name": f"{args.name} — {args.gender} {args.age_min}-{args.age_max} — LPV",
            "campaign_id": campaign["id"],
            "status": status,
            "optimization_goal": "LANDING_PAGE_VIEWS",
            "billing_event": "IMPRESSIONS",
            "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
            "lifetime_budget": str(args.budget_hkd * 100),
            "start_time": start.isoformat(timespec="seconds"),
            "end_time": end.isoformat(timespec="seconds"),
            "destination_type": "WEBSITE",
            "promoted_object": json.dumps({"page_id": page_id}),
            "targeting": json.dumps(_targeting(args)),
        },
    )
    print(f"id={adset['id']}")

    ad = _create_ad(
        args, account_id, page_id, ig_id, adset, video_id, image_hash, link, status
    )
    _report(campaign, adset, ad, args.activate)


def _assets(args, account_id):
    if args.video_id:
        video_id = args.video_id
        print(f"Reusing uploaded video_id={video_id}")
    else:
        print("Uploading video...", end=" ", flush=True)
        video_id = _upload_video(account_id, args.video)
        print(f"video_id={video_id}")
    if args.image_hash:
        image_hash = args.image_hash
        print(f"Reusing uploaded image_hash={image_hash}")
    else:
        print("Uploading thumbnail...", end=" ", flush=True)
        image_hash = _upload_thumbnail(account_id, args.thumbnail)
        print(f"image_hash={image_hash}")
    return video_id, image_hash


def _create_ad(
    args, account_id, page_id, ig_id, adset, video_id, image_hash, link, status
):
    print("Creating creative...", end=" ", flush=True)
    creative = _post(
        f"{account_id}/adcreatives",
        {
            "name": f"{args.name} — {args.utm_content}",
            "object_story_spec": json.dumps(
                {
                    "page_id": page_id,
                    "instagram_user_id": ig_id,
                    "video_data": {
                        "video_id": video_id,
                        "image_hash": image_hash,
                        "message": args.primary_text,
                        "title": args.headline,
                        "link_description": args.description,
                        "call_to_action": {
                            "type": args.cta,
                            "value": {"link": link},
                        },
                    },
                }
            ),
        },
    )
    print(f"id={creative['id']}")

    print("Creating ad...", end=" ", flush=True)
    ad = _post(
        f"{account_id}/ads",
        {
            "name": f"{args.name} — {args.utm_content}",
            "adset_id": adset["id"],
            "creative": json.dumps({"creative_id": creative["id"]}),
            "status": status,
        },
    )
    print(f"id={ad['id']}")
    return ad


def _report(campaign, adset, ad, activated):
    review = _get(ad["id"], {"fields": "effective_status,status"})
    print(f"\nDone. Ad effective_status: {review.get('effective_status')}")
    print(f"Campaign id {campaign['id']} | ad set {adset['id']} | ad {ad['id']}")
    if not activated:
        print(
            "Everything is PAUSED. Re-run the same command with --apply --activate "
            "to switch it on, or activate in Ads Manager."
        )


if __name__ == "__main__":
    main()
