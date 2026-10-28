"""Instagram organic performance assessment (read-only).

Queries the Instagram Graph API for the business account profile, the
stories that are currently live (stories expire after 24 hours and their
insights are no longer retrievable after that, so run this while they are
up), account-level reach and engagement for the last 30 days, follower
demographics, and insights for the most recent feed posts and reels.

Required environment variables:
    EVOLVESPROUTS_META_SYSTEM_USER_ACCESS_TOKEN       System user access token
    EVOLVESPROUTS_META_INSTAGRAM_BUSINESS_ACCOUNT_ID  IG business account ID

Usage:
    python3 instagram-assessment.py [--out PATH] [--media-limit N]

`--out` mirrors stdout to the given file (plaintext).
"""

import argparse
import contextlib
import os
import sys
from datetime import UTC, datetime, timedelta, timezone

import requests

BASE_URL = "https://graph.facebook.com/v21.0"
HKT = timezone(timedelta(hours=8))

STORY_METRICS = "views,reach,replies,shares,total_interactions,profile_visits,follows"
FEED_METRICS = (
    "reach,views,likes,comments,saved,shares,total_interactions,profile_visits,follows"
)
REEL_BASE_METRICS = "reach,views,likes,comments,saved,shares,total_interactions"
REEL_METRICS = f"{REEL_BASE_METRICS},ig_reels_avg_watch_time"
ACCOUNT_TOTAL_METRICS = (
    "profile_views,accounts_engaged,total_interactions,likes,comments,"
    "shares,saves,replies,website_clicks,views"
)


class _Tee:
    """Minimal tee: write to every underlying stream."""

    def __init__(self, *streams):
        self._streams = streams

    def write(self, data):
        for stream in self._streams:
            stream.write(data)
            stream.flush()

    def flush(self):
        for stream in self._streams:
            stream.flush()


def _auth_headers():
    token = os.environ.get("EVOLVESPROUTS_META_SYSTEM_USER_ACCESS_TOKEN", "")
    if not token:
        sys.exit("EVOLVESPROUTS_META_SYSTEM_USER_ACCESS_TOKEN not set")
    return {"Authorization": f"Bearer {token}"}


def _get(endpoint, params=None):
    resp = requests.get(
        f"{BASE_URL}/{endpoint}",
        params=params or {},
        headers=_auth_headers(),
        timeout=30,
    )
    is_json = resp.headers.get("content-type", "").startswith("application/json")
    body = resp.json() if is_json else {}
    if resp.status_code != 200:
        message = body.get("error", {}).get("message", f"HTTP {resp.status_code}")
        print(f"  API Error for {endpoint}: {message}")
        return None
    return body


def _insight_values(data):
    """Flatten an insights response into {metric_name: value}."""
    out = {}
    for row in (data or {}).get("data", []):
        if "total_value" in row:
            out[row["name"]] = row["total_value"].get("value")
        elif row.get("values"):
            out[row["name"]] = row["values"][0].get("value")
    return out


def _breakdown_rows(data):
    """Return [(dimension_label, value), ...] from a breakdown insights call."""
    rows = []
    for row in (data or {}).get("data", []):
        for breakdown in row.get("total_value", {}).get("breakdowns", []):
            for result in breakdown.get("results", []):
                label = " / ".join(result.get("dimension_values", []))
                rows.append((label, result.get("value", 0)))
    return sorted(rows, key=lambda r: -r[1])


def _pct(part, whole):
    return f"{100 * part / whole:.1f}%" if whole else "n/a"


def _fmt_ts(iso):
    dt = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%S%z")
    return f"{dt.strftime('%Y-%m-%d %H:%M')} UTC ({dt.astimezone(HKT).strftime('%a %H:%M')} HKT)"


def _age_hours(iso):
    dt = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%S%z")
    return (datetime.now(UTC) - dt).total_seconds() / 3600


def _print_account(ig_id):
    print("--- ACCOUNT ---")
    data = _get(
        ig_id,
        {"fields": "username,followers_count,follows_count,media_count,website"},
    )
    if not data:
        return 0
    followers = data.get("followers_count", 0)
    print(
        f"  @{data.get('username')} | followers: {followers:,} | "
        f"following: {data.get('follows_count', 0):,} | "
        f"posts: {data.get('media_count', 0):,}"
    )
    print(f"  website: {data.get('website')}")
    print()
    return followers


def _print_stories(ig_id, followers):
    print("--- LIVE STORIES (last 24h) ---")
    data = _get(
        f"{ig_id}/stories",
        {"fields": "id,media_type,timestamp,permalink"},
    )
    stories = (data or {}).get("data", [])
    if not stories:
        print("  No live stories.")
        print()
        return
    for story in sorted(stories, key=lambda s: s["timestamp"]):
        sid = story["id"]
        print(f"\n  {story.get('media_type')} story {sid}")
        print(
            f"    Posted: {_fmt_ts(story['timestamp'])} | "
            f"age: {_age_hours(story['timestamp']):.1f}h"
        )
        print(f"    {story.get('permalink')}")
        metrics = _insight_values(_get(f"{sid}/insights", {"metric": STORY_METRICS}))
        if not metrics:
            continue
        views = metrics.get("views", 0) or 0
        reach = metrics.get("reach", 0) or 0
        print(
            f"    Views: {views} | Reach: {reach} "
            f"({_pct(reach, followers)} of followers) | "
            f"views/reach: {views / reach:.2f}"
            if reach
            else f"    Views: {views} | Reach: {reach}"
        )
        print(
            f"    Replies: {metrics.get('replies', 0)} | "
            f"Shares: {metrics.get('shares', 0)} | "
            f"Interactions: {metrics.get('total_interactions', 0)} | "
            f"Profile visits: {metrics.get('profile_visits', 0)} | "
            f"Follows: {metrics.get('follows', 0)}"
        )
        nav = _get(
            f"{sid}/insights",
            {"metric": "navigation", "breakdown": "story_navigation_action_type"},
        )
        nav_rows = _breakdown_rows(nav)
        if nav_rows:
            total_nav = sum(v for _, v in nav_rows)
            parts = ", ".join(
                f"{label}: {value} ({_pct(value, views)} of views)"
                for label, value in nav_rows
            )
            print(f"    Navigation ({total_nav}): {parts}")
            nav_map = dict(nav_rows)
            exits = nav_map.get("tap_exit", 0) + nav_map.get("swipe_forward", 0)
            print(
                f"    Exit rate (tap_exit + swipe_forward): {_pct(exits, views)} | "
                f"Tap-forward rate: {_pct(nav_map.get('tap_forward', 0), views)}"
            )
    print()


def _print_account_insights(ig_id, followers):
    now = datetime.now(UTC)
    since = int((now - timedelta(days=29)).timestamp())
    until = int(now.timestamp())
    window = {"period": "day", "since": since, "until": until}

    print("--- ACCOUNT INSIGHTS (Last 30 Days) ---")
    totals = _insight_values(
        _get(
            f"{ig_id}/insights",
            {
                "metric": ACCOUNT_TOTAL_METRICS,
                "metric_type": "total_value",
                **window,
            },
        )
    )
    reach_by_type = _breakdown_rows(
        _get(
            f"{ig_id}/insights",
            {
                "metric": "reach",
                "metric_type": "total_value",
                "breakdown": "media_product_type",
                **window,
            },
        )
    )
    reach_by_follow = _breakdown_rows(
        _get(
            f"{ig_id}/insights",
            {
                "metric": "reach",
                "metric_type": "total_value",
                "breakdown": "follow_type",
                **window,
            },
        )
    )
    views_by_type = _breakdown_rows(
        _get(
            f"{ig_id}/insights",
            {
                "metric": "views",
                "metric_type": "total_value",
                "breakdown": "media_product_type",
                **window,
            },
        )
    )
    if totals:
        print(
            f"  Views: {totals.get('views', 0):,} | "
            f"Profile visits: {totals.get('profile_views', 0):,} | "
            f"Website taps: {totals.get('website_clicks', 0):,}"
        )
        print(
            f"  Accounts engaged: {totals.get('accounts_engaged', 0):,} | "
            f"Interactions: {totals.get('total_interactions', 0):,} "
            f"(likes {totals.get('likes', 0)}, comments {totals.get('comments', 0)}, "
            f"shares {totals.get('shares', 0)}, saves {totals.get('saves', 0)}, "
            f"story replies {totals.get('replies', 0)})"
        )
    if reach_by_type:
        total_reach = sum(v for _, v in reach_by_type)
        print(f"  Reach by content type (sum {total_reach:,}; accounts may overlap):")
        for label, value in reach_by_type:
            print(f"    {label:<20} {value:>6,}  {_pct(value, total_reach)}")
    if views_by_type:
        total_views = sum(v for _, v in views_by_type)
        print(f"  Views by content type (sum {total_views:,}):")
        for label, value in views_by_type:
            print(f"    {label:<20} {value:>6,}  {_pct(value, total_views)}")
    if reach_by_follow:
        follow_map = dict(reach_by_follow)
        follower_reach = follow_map.get("FOLLOWER", 0)
        print(
            f"  Reach followers vs non-followers: {follower_reach:,} "
            f"({_pct(follower_reach, followers)} of followers) vs "
            f"{follow_map.get('NON_FOLLOWER', 0):,}"
        )

    daily_reach = _get(f"{ig_id}/insights", {"metric": "reach", **window})
    daily_follow = _get(f"{ig_id}/insights", {"metric": "follower_count", **window})
    reach_values = ((daily_reach or {}).get("data") or [{}])[0].get("values", [])
    follow_values = ((daily_follow or {}).get("data") or [{}])[0].get("values", [])
    if reach_values:
        print("\n  Daily reach / new followers:")
        follow_by_day = {v["end_time"]: v["value"] for v in follow_values}
        for row in reach_values:
            day = row["end_time"][:10]
            print(
                f"    {day} | reach {row['value']:>5,} | "
                f"new followers {follow_by_day.get(row['end_time'], 0)}"
            )
        print(f"  New followers in window: {sum(follow_by_day.values()):,}")
    print()


def _print_demographics(ig_id):
    print("--- FOLLOWER DEMOGRAPHICS ---")
    for breakdown, top in (("country", 5), ("city", 5), ("age,gender", 8)):
        rows = _breakdown_rows(
            _get(
                f"{ig_id}/insights",
                {
                    "metric": "follower_demographics",
                    "period": "lifetime",
                    "metric_type": "total_value",
                    "breakdown": breakdown,
                },
            )
        )
        if not rows:
            continue
        total = sum(v for _, v in rows)
        print(f"  By {breakdown} (n={total:,}):")
        for label, value in rows[:top]:
            print(f"    {label:<28} {value:>5,}  {_pct(value, total)}")
    print()


def _print_recent_media(ig_id, followers, limit):
    print(f"--- RECENT MEDIA (last {limit}) ---")
    data = _get(
        f"{ig_id}/media",
        {
            "fields": "id,caption,media_type,media_product_type,timestamp,permalink",
            "limit": limit,
        },
    )
    for item in (data or {}).get("data", []):
        product = item.get("media_product_type")
        metric_list = REEL_METRICS if product == "REELS" else FEED_METRICS
        insights = _get(f"{item['id']}/insights", {"metric": metric_list})
        if insights is None and product == "REELS":
            # Older reels reject the watch-time metrics; keep the basic row.
            insights = _get(f"{item['id']}/insights", {"metric": REEL_BASE_METRICS})
        metrics = _insight_values(insights)
        caption = (item.get("caption") or "").replace("\n", " ")[:90]
        reach = metrics.get("reach", 0) or 0
        print(
            f"\n  {_fmt_ts(item['timestamp'])} | {product} / {item.get('media_type')}"
        )
        print(f"    {caption}")
        print(f"    {item.get('permalink')}")
        line = (
            f"    Reach: {reach:,} ({_pct(reach, followers)} of followers) | "
            f"Views: {metrics.get('views', 0)} | Likes: {metrics.get('likes', 0)} | "
            f"Comments: {metrics.get('comments', 0)} | Saves: {metrics.get('saved', 0)} | "
            f"Shares: {metrics.get('shares', 0)} | "
            f"Interactions: {metrics.get('total_interactions', 0)}"
        )
        if product == "REELS":
            avg_ms = metrics.get("ig_reels_avg_watch_time") or 0
            line += f" | Avg watch: {avg_ms / 1000:.1f}s"
        else:
            line += (
                f" | Profile visits: {metrics.get('profile_visits', 0)} | "
                f"Follows: {metrics.get('follows', 0)}"
            )
        print(line)
    print()


def main(media_limit):
    ig_id = os.environ.get("EVOLVESPROUTS_META_INSTAGRAM_BUSINESS_ACCOUNT_ID", "")
    if not ig_id:
        sys.exit("EVOLVESPROUTS_META_INSTAGRAM_BUSINESS_ACCOUNT_ID not set")

    now = datetime.now(UTC)
    print(f"Instagram Business Account: {ig_id}")
    print(
        f"Date: {now.strftime('%Y-%m-%d %H:%M')} UTC ({now.astimezone(HKT).strftime('%H:%M')} HKT)\n"
    )

    followers = _print_account(ig_id)
    _print_stories(ig_id, followers)
    _print_account_insights(ig_id, followers)
    _print_demographics(ig_id)
    _print_recent_media(ig_id, followers, media_limit)

    print("--- INSTAGRAM ASSESSMENT COMPLETE ---")


def _parse_args():
    parser = argparse.ArgumentParser(description=__doc__ or "")
    parser.add_argument(
        "--out",
        help="Optional path to tee stdout into (plaintext). Useful for "
        "auto-capturing raw output into marketing/generated-reports/.",
    )
    parser.add_argument(
        "--media-limit",
        type=int,
        default=12,
        help="How many recent feed posts / reels to pull insights for.",
    )
    return parser.parse_args()


def _run_main():
    args = _parse_args()
    if args.out:
        out_dir = os.path.dirname(os.path.abspath(args.out))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            tee = _Tee(sys.stdout, fh)
            with contextlib.redirect_stdout(tee):
                main(args.media_limit)
    else:
        main(args.media_limit)


if __name__ == "__main__":
    _run_main()
