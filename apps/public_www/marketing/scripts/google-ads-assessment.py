"""Google Ads performance assessment (read-only).

Queries the Google Ads API via service account through the MCC (manager)
account to pull campaign, ad group, keyword, ad, search-term, and
conversion data.

Sections added in the 2026-11-04 assessment, because they are what exposed
the broad-match waste: monthly spend / soft-conversion trend, spend mix by
ad group, impression share (lost to budget vs rank), conversions by action,
device split, hidden-search-term share, and a relevance split of visible
search terms per keyword.

Required environment variables:
    EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID      Manager (MCC) account ID
    EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN  API developer token
    EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON Service account credentials JSON

Usage:
    python3 google-ads-assessment.py [--out PATH] [--days 90]

`--out` mirrors stdout to the given file (plaintext).
`--days` sets the trailing window for the detailed sections (default 90).
"""

import argparse
import contextlib
import os
import re
import sys
import tempfile
from collections import defaultdict
from datetime import date, timedelta

from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

API_VERSION = "v26"
FALLBACK_CLIENT_ID = "4991144901"
TREND_START = "2026-03-01"

# Relevance buckets for visible search terms. Order matters: first match wins.
RELEVANCE_BUCKETS = [
    (
        "relevant",
        re.compile(
            r"montessori|consult|helper|auntie|nanny|domestic|parent(ing)? coach|"
            r"positive discipline|childcare (course|training)",
            re.IGNORECASE,
        ),
    ),
    (
        "navigational (brand/app/school)",
        re.compile(
            r"solid ?memory|i ?learner|ileaner|starfall|sunshine online|eclass|"
            r"guidepost|kindergarten|playschool|pre.?school|school|academy|centre|"
            r"center|\bapp\b|\.com|www|http|ymca",
            re.IGNORECASE,
        ),
    ),
    (
        "generic how-to question",
        re.compile(
            r"^(how|why|when|what|if|is|can|should|does)\b|tantrum|potty|adhd|"
            r"autism|newborn|baby|toddler|teen",
            re.IGNORECASE,
        ),
    ),
]


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


def _sa_path():
    sa_json = os.environ.get("EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if not sa_json:
        sys.exit("EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON not set")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        f.write(sa_json)
        return f.name


def _micros(value):
    return value / 1_000_000 if value else 0


def _pct(num, den):
    return num / den if den else 0


def _query(svc, cid, query, label):
    try:
        return list(svc.search(customer_id=cid, query=query))
    except GoogleAdsException as exc:
        msg = exc.failure.errors[0].message if exc.failure.errors else str(exc)
        print(f"  [{label}] API error: {msg}")
        return []
    except Exception as exc:  # noqa: BLE001 - report and keep going
        print(f"  [{label}] error: {exc}")
        return []


def _bucket(term):
    for name, pattern in RELEVANCE_BUCKETS:
        if pattern.search(term):
            return name
    return "other generic"


def _print_campaign_metrics(rows):
    for r in rows:
        m = r.metrics
        print(
            f"  {r.campaign.name} ({r.campaign.status.name}): "
            f"Imp {m.impressions:,} | Clicks {m.clicks:,} | CTR {m.ctr:.2%} | "
            f"CPC HK${_micros(m.average_cpc):.2f} | Cost HK${_micros(m.cost_micros):,.2f} | "
            f"Conv {m.conversions:.1f} | All conv {m.all_conversions:.1f}"
        )
        if m.search_impression_share:
            print(
                f"    IS {m.search_impression_share:.0%} | lost to budget "
                f"{m.search_budget_lost_impression_share:.0%} | lost to rank "
                f"{m.search_rank_lost_impression_share:.0%} | top IS "
                f"{m.search_top_impression_share:.0%}"
            )


CAMPAIGN_METRIC_FIELDS = (
    "campaign.name, campaign.status, metrics.impressions, metrics.clicks, "
    "metrics.ctr, metrics.average_cpc, metrics.cost_micros, metrics.conversions, "
    "metrics.all_conversions, metrics.search_impression_share, "
    "metrics.search_budget_lost_impression_share, "
    "metrics.search_rank_lost_impression_share, metrics.search_top_impression_share"
)


def assess_client(svc, cid, window_start, window_end):
    window = f"segments.date BETWEEN '{window_start}' AND '{window_end}'"
    trend = f"segments.date BETWEEN '{TREND_START}' AND '{window_end}'"

    print(f"\n{'=' * 60}")
    print(f"CLIENT ACCOUNT: {cid}")
    print(f"{'=' * 60}")

    rows = _query(
        svc,
        cid,
        "SELECT customer.id, customer.descriptive_name, customer.currency_code, "
        "customer.time_zone, customer.status, customer.optimization_score FROM customer LIMIT 1",
        "account",
    )
    if not rows:
        return
    c = rows[0].customer
    print(
        f"\nAccount: {c.descriptive_name} | {c.currency_code} | {c.time_zone} | "
        f"{c.status.name} | optimisation score {c.optimization_score:.2f}"
    )

    print("\n--- CAMPAIGNS (settings) ---")
    for r in _query(
        svc,
        cid,
        "SELECT campaign.id, campaign.name, campaign.status, "
        "campaign.advertising_channel_type, campaign.bidding_strategy_type, "
        "campaign.target_spend.cpc_bid_ceiling_micros, campaign_budget.amount_micros, "
        "campaign.network_settings.target_search_network, "
        "campaign.network_settings.target_content_network "
        "FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id",
        "campaigns",
    ):
        camp = r.campaign
        print(
            f"  [{camp.id}] {camp.name} | {camp.status.name} | "
            f"{camp.advertising_channel_type.name} | {camp.bidding_strategy_type.name} "
            f"(CPC ceiling HK${_micros(camp.target_spend.cpc_bid_ceiling_micros):.0f}) | "
            f"HK${_micros(r.campaign_budget.amount_micros):.0f}/day | "
            f"partners={camp.network_settings.target_search_network} "
            f"display={camp.network_settings.target_content_network}"
        )

    print("\n--- CAMPAIGN PERFORMANCE (All Time) ---")
    _print_campaign_metrics(
        _query(
            svc,
            cid,
            f"SELECT {CAMPAIGN_METRIC_FIELDS} FROM campaign ORDER BY metrics.cost_micros DESC",
            "all time",
        )
    )

    for label, clause in [
        ("Last 7 Days", "segments.date DURING LAST_7_DAYS"),
        ("Last 30 Days", "segments.date DURING LAST_30_DAYS"),
        (f"{window_start} to {window_end}", window),
    ]:
        print(f"\n--- CAMPAIGN PERFORMANCE ({label}) ---")
        rows = _query(
            svc,
            cid,
            f"SELECT {CAMPAIGN_METRIC_FIELDS} FROM campaign WHERE {clause} "
            "ORDER BY metrics.cost_micros DESC",
            label,
        )
        _print_campaign_metrics(rows) if rows else print("  No data.")

    print(f"\n--- MONTHLY TREND (since {TREND_START}) ---")
    monthly = defaultdict(lambda: defaultdict(float))
    for r in _query(
        svc,
        cid,
        "SELECT segments.month, metrics.impressions, metrics.clicks, metrics.cost_micros, "
        f"metrics.conversions, metrics.all_conversions FROM campaign WHERE {trend} "
        "ORDER BY segments.month",
        "monthly",
    ):
        d = monthly[r.segments.month]
        d["imp"] += r.metrics.impressions
        d["clicks"] += r.metrics.clicks
        d["cost"] += _micros(r.metrics.cost_micros)
        d["conv"] += r.metrics.conversions
        d["all_conv"] += r.metrics.all_conversions
    for month in sorted(monthly):
        d = monthly[month]
        print(
            f"  {month[:7]}: Cost HK${d['cost']:,.0f} | Imp {int(d['imp']):,} | "
            f"Clicks {int(d['clicks']):,} | CPC HK${_pct(d['cost'], d['clicks']):.2f} | "
            f"Conv {d['conv']:.0f} | All conv {d['all_conv']:.0f}"
        )

    print(f"\n--- MONTHLY SPEND MIX BY AD GROUP (since {TREND_START}) ---")
    mix = defaultdict(dict)
    for r in _query(
        svc,
        cid,
        "SELECT segments.month, campaign.name, ad_group.name, metrics.cost_micros, "
        f"metrics.all_conversions FROM ad_group WHERE {trend} AND campaign.status = 'ENABLED' "
        "ORDER BY segments.month",
        "mix",
    ):
        mix[r.segments.month][f"{r.campaign.name} > {r.ad_group.name}"] = (
            _micros(r.metrics.cost_micros),
            r.metrics.all_conversions,
        )
    for month in sorted(mix):
        total = sum(v[0] for v in mix[month].values())
        parts = [
            f"{name}: HK${cost:,.0f} ({_pct(cost, total):.0%}, {conv:.0f} all conv)"
            for name, (cost, conv) in sorted(mix[month].items())
        ]
        print(f"  {month[:7]}: " + " | ".join(parts))

    print(f"\n--- CONVERSIONS BY ACTION ({window_start} to {window_end}) ---")
    rows = _query(
        svc,
        cid,
        "SELECT segments.conversion_action_name, ad_group.name, metrics.all_conversions "
        f"FROM ad_group WHERE {window} AND metrics.all_conversions > 0 "
        "ORDER BY metrics.all_conversions DESC",
        "conv by action",
    )
    for r in rows:
        print(
            f"  {r.ad_group.name} | {r.segments.conversion_action_name} | "
            f"{r.metrics.all_conversions:.0f}"
        )
    if not rows:
        print("  No conversions of any kind in window.")

    print("\n--- CONVERSION ACTIONS (config) ---")
    for r in _query(
        svc,
        cid,
        "SELECT conversion_action.name, conversion_action.status, conversion_action.type, "
        "conversion_action.category, conversion_action.primary_for_goal "
        "FROM conversion_action ORDER BY conversion_action.status",
        "conversion actions",
    ):
        ca = r.conversion_action
        print(
            f"  {ca.name} | {ca.status.name} | {ca.type.name} | {ca.category.name} | "
            f"{'PRIMARY' if ca.primary_for_goal else 'secondary'}"
        )

    print(f"\n--- AD GROUP PERFORMANCE ({window_start} to {window_end}) ---")
    for r in _query(
        svc,
        cid,
        "SELECT campaign.name, ad_group.name, ad_group.status, metrics.impressions, "
        "metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.cost_micros, "
        f"metrics.conversions, metrics.all_conversions FROM ad_group WHERE {window} "
        "ORDER BY metrics.cost_micros DESC",
        "ad groups",
    ):
        m = r.metrics
        print(
            f"  {r.campaign.name} > {r.ad_group.name} ({r.ad_group.status.name}): "
            f"Imp {m.impressions:,} | Clicks {m.clicks:,} | CTR {m.ctr:.2%} | "
            f"CPC HK${_micros(m.average_cpc):.2f} | Cost HK${_micros(m.cost_micros):,.2f} | "
            f"Conv {m.conversions:.1f} | All conv {m.all_conversions:.1f} | "
            f"Cost/all conv HK${_pct(_micros(m.cost_micros), m.all_conversions):,.0f}"
        )

    print(f"\n--- KEYWORDS WITH IMPRESSIONS ({window_start} to {window_end}) ---")
    for r in _query(
        svc,
        cid,
        "SELECT ad_group.name, ad_group_criterion.keyword.text, "
        "ad_group_criterion.keyword.match_type, ad_group_criterion.status, "
        "ad_group_criterion.quality_info.quality_score, "
        "ad_group_criterion.quality_info.post_click_quality_score, "
        "metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, "
        "metrics.cost_micros, metrics.conversions, metrics.all_conversions "
        f"FROM keyword_view WHERE {window} AND metrics.impressions > 0 "
        "ORDER BY metrics.cost_micros DESC",
        "keywords",
    ):
        kw = r.ad_group_criterion.keyword
        qi = r.ad_group_criterion.quality_info
        m = r.metrics
        print(
            f'  {r.ad_group.name} | "{kw.text}" [{kw.match_type.name}] '
            f"{r.ad_group_criterion.status.name} | QS {qi.quality_score or 'n/a'} "
            f"(LP {qi.post_click_quality_score.name}) | Imp {m.impressions:,} | "
            f"Clicks {m.clicks:,} | CTR {m.ctr:.2%} | CPC HK${_micros(m.average_cpc):.2f} | "
            f"Cost HK${_micros(m.cost_micros):,.2f} | All conv {m.all_conversions:.1f}"
        )

    zero = _query(
        svc,
        cid,
        "SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type "
        f"FROM keyword_view WHERE {window} AND metrics.impressions = 0 "
        "AND ad_group_criterion.status = 'ENABLED'",
        "zero-impression keywords",
    )
    print(f"\n--- ENABLED KEYWORDS WITH ZERO IMPRESSIONS: {len(zero)} ---")

    print(f"\n--- SEARCH TERMS: HIDDEN SHARE ({window_start} to {window_end}) ---")
    camp_cost = camp_clicks = 0.0
    for r in _query(
        svc,
        cid,
        f"SELECT metrics.cost_micros, metrics.clicks FROM campaign WHERE {window}",
        "campaign totals",
    ):
        camp_cost += _micros(r.metrics.cost_micros)
        camp_clicks += r.metrics.clicks
    terms = _query(
        svc,
        cid,
        "SELECT search_term_view.search_term, segments.keyword.info.text, metrics.clicks, "
        f"metrics.cost_micros, metrics.all_conversions FROM search_term_view WHERE {window}",
        "search terms",
    )
    st_cost = sum(_micros(r.metrics.cost_micros) for r in terms)
    st_clicks = sum(r.metrics.clicks for r in terms)
    print(
        f"  Visible terms: {len(terms):,} | HK${st_cost:,.0f} / {st_clicks:.0f} clicks | "
        f"Hidden ('Other search terms'): HK${camp_cost - st_cost:,.0f} "
        f"({_pct(camp_cost - st_cost, camp_cost):.0%} of spend)"
    )

    print(
        f"\n--- SEARCH TERM RELEVANCE BY KEYWORD ({window_start} to {window_end}) ---"
    )
    by_kw = defaultdict(lambda: defaultdict(lambda: [0.0, 0, 0.0]))
    for r in terms:
        slot = by_kw[r.segments.keyword.info.text][
            _bucket(r.search_term_view.search_term)
        ]
        slot[0] += _micros(r.metrics.cost_micros)
        slot[1] += r.metrics.clicks
        slot[2] += r.metrics.all_conversions
    for kw_text, buckets in sorted(
        by_kw.items(), key=lambda kv: -sum(v[0] for v in kv[1].values())
    ):
        total = sum(v[0] for v in buckets.values())
        if total < 50:
            continue
        print(f'  "{kw_text}" HK${total:,.0f}:')
        for name, (cost, clicks, conv) in sorted(
            buckets.items(), key=lambda kv: -kv[1][0]
        ):
            print(
                f"    {name}: HK${cost:,.0f} ({_pct(cost, total):.0%}) | "
                f"{clicks} clicks | {conv:.0f} all conv"
            )

    print(f"\n--- TOP 40 SEARCH TERMS BY COST ({window_start} to {window_end}) ---")
    for r in sorted(terms, key=lambda r: -r.metrics.cost_micros)[:40]:
        m = r.metrics
        print(
            f'  "{r.search_term_view.search_term}" <- "{r.segments.keyword.info.text}" | '
            f"Clicks {m.clicks} | Cost HK${_micros(m.cost_micros):.2f} | "
            f"All conv {m.all_conversions:.0f}"
        )

    print(f"\n--- ADS ({window_start} to {window_end}) ---")
    for r in _query(
        svc,
        cid,
        "SELECT ad_group.name, ad_group_ad.ad.id, ad_group_ad.status, "
        "ad_group_ad.policy_summary.approval_status, ad_group_ad.ad_strength, "
        "ad_group_ad.ad.final_urls, metrics.impressions, metrics.clicks, metrics.ctr, "
        f"metrics.cost_micros FROM ad_group_ad WHERE {window} ORDER BY metrics.cost_micros DESC",
        "ads",
    ):
        ad = r.ad_group_ad
        m = r.metrics
        urls = list(ad.ad.final_urls)
        print(
            f"  {r.ad_group.name} | Ad {ad.ad.id} | {ad.status.name} | "
            f"{ad.policy_summary.approval_status.name} | strength {ad.ad_strength.name} | "
            f"Imp {m.impressions:,} | Clicks {m.clicks:,} | CTR {m.ctr:.2%} | "
            f"Cost HK${_micros(m.cost_micros):,.2f}"
        )
        if urls:
            print(f"    URL: {urls[0]}")

    print(f"\n--- DEVICE ({window_start} to {window_end}) ---")
    for r in _query(
        svc,
        cid,
        "SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros, "
        f"metrics.all_conversions FROM campaign WHERE {window} ORDER BY metrics.cost_micros DESC",
        "device",
    ):
        m = r.metrics
        print(
            f"  {r.segments.device.name}: Imp {m.impressions:,} | Clicks {m.clicks:,} | "
            f"Cost HK${_micros(m.cost_micros):,.2f} | All conv {m.all_conversions:.0f}"
        )

    print("\n--- DAILY PERFORMANCE (Last 14 Days) ---")
    daily = defaultdict(lambda: defaultdict(float))
    for r in _query(
        svc,
        cid,
        "SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, "
        "metrics.all_conversions FROM campaign WHERE segments.date DURING LAST_14_DAYS",
        "daily",
    ):
        d = daily[r.segments.date]
        d["imp"] += r.metrics.impressions
        d["clicks"] += r.metrics.clicks
        d["cost"] += _micros(r.metrics.cost_micros)
        d["all_conv"] += r.metrics.all_conversions
    for day in sorted(daily):
        d = daily[day]
        print(
            f"  {day}: Imp {int(d['imp']):,} | Clicks {int(d['clicks'])} | "
            f"Cost HK${d['cost']:.2f} | All conv {d['all_conv']:.0f}"
        )

    print("\n--- GOOGLE RECOMMENDATIONS ---")
    recs = _query(svc, cid, "SELECT recommendation.type FROM recommendation", "recs")
    print(
        "  " + (", ".join(r.recommendation.type.name for r in recs) if recs else "none")
    )

    print("\n--- CHANGE HISTORY (Last 14 Days) ---")
    changes = _query(
        svc,
        cid,
        "SELECT change_event.change_date_time, change_event.change_resource_type, "
        "change_event.resource_change_operation, change_event.client_type "
        "FROM change_event WHERE change_event.change_date_time DURING LAST_14_DAYS "
        "ORDER BY change_event.change_date_time DESC LIMIT 25",
        "changes",
    )
    for r in changes:
        e = r.change_event
        print(
            f"  {e.change_date_time} | {e.change_resource_type.name} "
            f"{e.resource_change_operation.name} | {e.client_type.name}"
        )
    if not changes:
        print("  No changes in the last 14 days.")


def main(days):
    manager_id = os.environ.get("EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID", "").replace(
        "-", ""
    )
    dev_token = os.environ.get("EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN", "")
    if not manager_id or not dev_token:
        sys.exit("Missing GOOGLE_ADS_CUSTOMER_ID or DEVELOPER_TOKEN")

    client = GoogleAdsClient.load_from_dict(
        {
            "developer_token": dev_token,
            "json_key_file_path": _sa_path(),
            "impersonated_email": "",
            "login_customer_id": manager_id,
            "use_proto_plus": True,
        },
        version=API_VERSION,
    )
    svc = client.get_service("GoogleAdsService")
    window_end = (date.today() - timedelta(days=1)).isoformat()
    window_start = (date.today() - timedelta(days=days)).isoformat()

    print("=" * 60)
    print(f"MANAGER ACCOUNT: {manager_id} (API {API_VERSION})")
    print("=" * 60)

    client_ids = []
    print("\n--- CLIENT ACCOUNTS ---")
    for r in _query(
        svc,
        manager_id,
        "SELECT customer_client.id, customer_client.descriptive_name, "
        "customer_client.status FROM customer_client WHERE customer_client.manager = FALSE",
        "clients",
    ):
        cc = r.customer_client
        print(f"  {cc.descriptive_name} (ID: {cc.id}, {cc.status.name})")
        client_ids.append(str(cc.id))
    if not client_ids:
        client_ids = [FALLBACK_CLIENT_ID]

    for cid in client_ids:
        assess_client(svc, cid, window_start, window_end)

    print(f"\n{'=' * 60}")
    print("GOOGLE ADS ASSESSMENT COMPLETE")
    print(f"{'=' * 60}")


def _parse_args():
    parser = argparse.ArgumentParser(description=__doc__ or "")
    parser.add_argument("--out", help="Optional path to tee stdout into (plaintext).")
    parser.add_argument("--days", type=int, default=90, help="Trailing window in days.")
    return parser.parse_args()


def _run_main():
    args = _parse_args()
    if args.out:
        out_dir = os.path.dirname(os.path.abspath(args.out))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with (
            open(args.out, "w", encoding="utf-8") as fh,
            contextlib.redirect_stdout(_Tee(sys.stdout, fh)),
        ):
            main(args.days)
    else:
        main(args.days)


if __name__ == "__main__":
    _run_main()
