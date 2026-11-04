"""Google Ads — apply Tuesday changes (read-write).

Grounded in the 2026-04-17 live pull. Idempotent where possible: skips
negatives / keywords that already exist on the campaign / ad group, and
skips ad final-URL updates whose UTMs are already present.

Operations (toggled via `--steps` or `--all`):

  negatives     Add campaign-level negative keywords based on the
                search-terms report. Skips any that already exist.
  phrase        Add phrase-match variants of the three winning keywords
                to the Helper Training Course ad group.
  utm           Append our unified UTM convention to each enabled ad's
                final URL.

Required env vars:
    EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID      Manager (MCC) account ID
    EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN
    EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON

Live customer:
    CLIENT_CUSTOMER_ID    = 4991144901  (Evolve Sprouts)
    CAMPAIGN_ID           = 23659032602 (My Best Auntie — Search — HK)
    HELPER_TRAINING_AG_ID = 195059847980
    FAMILY_CONSULT_AG_ID  = 195398533196

Usage:
    python3 scripts/apply/google-ads-apply-tuesday-changes.py --dry-run --all
    python3 scripts/apply/google-ads-apply-tuesday-changes.py --apply --all
    python3 scripts/apply/google-ads-apply-tuesday-changes.py --apply --steps negatives utm
"""

import argparse
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

try:
    from google.ads.googleads.client import GoogleAdsClient
except ModuleNotFoundError as exc:
    from require_deps import exit_missing_google

    exit_missing_google(exc)

API_VERSION = "v26"
CLIENT_CUSTOMER_ID = "4991144901"
CAMPAIGN_ID = 23659032602
HELPER_TRAINING_AG_ID = 195059847980
FAMILY_CONSULT_AG_ID = 195398533196

# Search-terms-grounded seed negatives (campaign-level).
# Existing campaign negatives at time of writing:
#   free, job, visa, immigration, cleaning, placement, agency, salary,
#   maid, "FDH employment"
# The list below is additive; the apply step skips any existing entry.
CAMPAIGN_NEGATIVES = [
    # Competitor brands (EXACT)
    ("helperchoice", "EXACT"),
    ("helperplace", "EXACT"),
    ("geoexpat", "EXACT"),
    ("asiaxpat", "EXACT"),
    ("helper library", "EXACT"),
    ("helpers library", "EXACT"),
    ("ymca", "EXACT"),
    ("pathfinder", "EXACT"),
    ("uplifters", "EXACT"),
    ("guidepost montessori", "EXACT"),
    ("norland college", "EXACT"),
    ("i learner", "EXACT"),
    ("new age caregiver academy", "EXACT"),
    # Country / origin bleed (PHRASE)
    ("philippines", "PHRASE"),
    ("indonesia", "PHRASE"),
    ("ofw", "PHRASE"),
    # Job-seeker intent (PHRASE)
    ("part time helper", "PHRASE"),
    ("stay out helper", "PHRASE"),
    ("domestic helper rules", "PHRASE"),
    ("domestic helper guide", "PHRASE"),
    ("find employer", "PHRASE"),
    ("domestic worker", "PHRASE"),
    # Labour Department / regulation searches (PHRASE)
    ("labour department", "PHRASE"),
    ("labor department", "PHRASE"),
    # Culinary / unrelated skill training (PHRASE)
    ("culinary", "PHRASE"),
    ("easter holiday helper", "PHRASE"),
    # Misc non-ICP
    ("au pair", "PHRASE"),
    ("aupair", "PHRASE"),
    ("playgroup", "PHRASE"),
]

# Phrase variants to add in the Helper Training Course ad group.
# Skips anything already present on the ad group (in any match type).
HELPER_TRAINING_PHRASE_ADDS = [
    "helper training hong kong",
    "childcare helper training",
    "domestic helper course hong kong",
]

# UTM tagging rules: map (ad_id, ad_group_id) -> utm_content value.
# Any ad not in this map defaults to a slugified ad_id.
UTM_BASE = {
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "my-best-auntie-search-hk",
}
UTM_CONTENT_BY_AD_GROUP = {
    HELPER_TRAINING_AG_ID: "helper-training-rsa",
    FAMILY_CONSULT_AG_ID: "family-consultations",
}


def _client():
    sa_json = os.environ.get("EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if not sa_json:
        sys.exit("EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON not set")
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    f.write(sa_json)
    f.close()
    manager_id = os.environ.get("EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID", "").replace(
        "-", ""
    )
    dev_token = os.environ.get("EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN", "")
    if not manager_id or not dev_token:
        sys.exit("Missing GOOGLE_ADS_CUSTOMER_ID or DEVELOPER_TOKEN")
    return GoogleAdsClient.load_from_dict(
        {
            "developer_token": dev_token,
            "json_key_file_path": f.name,
            "impersonated_email": "",
            "login_customer_id": manager_id,
            "use_proto_plus": True,
        },
        version=API_VERSION,
    )


def _existing_campaign_negatives(client, svc):
    out = {}
    for r in svc.search(
        customer_id=CLIENT_CUSTOMER_ID,
        query=(
            "SELECT campaign_criterion.criterion_id, "
            "campaign_criterion.keyword.text, "
            "campaign_criterion.keyword.match_type "
            "FROM campaign_criterion "
            "WHERE campaign_criterion.negative = TRUE "
            f"AND campaign.id = {CAMPAIGN_ID}"
        ),
    ):
        kw = r.campaign_criterion.keyword
        out[(kw.text.lower(), kw.match_type.name)] = r.campaign_criterion.criterion_id
    return out


def _existing_ag_keywords(svc, ag_id):
    out = {}
    for r in svc.search(
        customer_id=CLIENT_CUSTOMER_ID,
        query=(
            "SELECT ad_group_criterion.criterion_id, "
            "ad_group_criterion.keyword.text, "
            "ad_group_criterion.keyword.match_type "
            "FROM ad_group_criterion "
            f"WHERE ad_group.id = {ag_id} "
            "AND ad_group_criterion.type = 'KEYWORD'"
        ),
    ):
        kw = r.ad_group_criterion.keyword
        out[(kw.text.lower(), kw.match_type.name)] = r.ad_group_criterion.criterion_id
    return out


def _existing_ag_keyword_texts(svc, ag_id):
    return {kw_text for (kw_text, _mt) in _existing_ag_keywords(svc, ag_id)}


def do_negatives(client, svc, apply_changes):
    print("\n== CAMPAIGN NEGATIVES ==")
    existing = _existing_campaign_negatives(client, svc)
    to_add = []
    for text, match_type in CAMPAIGN_NEGATIVES:
        key = (text.lower(), match_type)
        if key in existing:
            print(f"  skip (exists): {match_type:6} {text!r}")
            continue
        to_add.append((text, match_type))
        print(f"  add:  {match_type:6} {text!r}")

    if not to_add or not apply_changes:
        return

    op_client = client.get_type("CampaignCriterionOperation")
    ops = []
    match_type_enum = client.enums.KeywordMatchTypeEnum
    campaign_service = client.get_service("CampaignService")
    campaign_resource = campaign_service.campaign_path(CLIENT_CUSTOMER_ID, CAMPAIGN_ID)

    for text, match_type in to_add:
        op = client.get_type("CampaignCriterionOperation")
        cc = op.create
        cc.campaign = campaign_resource
        cc.negative = True
        cc.keyword.text = text
        cc.keyword.match_type = match_type_enum[match_type]
        ops.append(op)

    svc_cc = client.get_service("CampaignCriterionService")
    resp = svc_cc.mutate_campaign_criteria(
        customer_id=CLIENT_CUSTOMER_ID,
        operations=ops,
    )
    print(f"  -> created {len(resp.results)} negative criteria.")


def do_phrase_variants(client, svc, apply_changes):
    print("\n== PHRASE VARIANTS ON HELPER TRAINING AD GROUP ==")
    existing = _existing_ag_keywords(svc, HELPER_TRAINING_AG_ID)
    existing_texts = {text for (text, _mt) in existing.keys()}
    to_add = []
    for text in HELPER_TRAINING_PHRASE_ADDS:
        if (text.lower(), "PHRASE") in existing:
            print(f"  skip (phrase exists): {text!r}")
            continue
        if text.lower() in existing_texts:
            print(f"  add (other match types exist but phrase does not): {text!r}")
        else:
            print(f"  add: {text!r}")
        to_add.append(text)

    if not to_add or not apply_changes:
        return

    ag_service = client.get_service("AdGroupService")
    ag_resource = ag_service.ad_group_path(CLIENT_CUSTOMER_ID, HELPER_TRAINING_AG_ID)
    match_type_enum = client.enums.KeywordMatchTypeEnum

    ops = []
    for text in to_add:
        op = client.get_type("AdGroupCriterionOperation")
        agc = op.create
        agc.ad_group = ag_resource
        agc.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
        agc.keyword.text = text
        agc.keyword.match_type = match_type_enum.PHRASE
        ops.append(op)

    svc_agc = client.get_service("AdGroupCriterionService")
    resp = svc_agc.mutate_ad_group_criteria(
        customer_id=CLIENT_CUSTOMER_ID,
        operations=ops,
    )
    print(f"  -> created {len(resp.results)} phrase-match keywords.")


def _merge_utms(url, ad_group_id):
    utm_content = UTM_CONTENT_BY_AD_GROUP.get(ad_group_id, "rsa")
    target = {**UTM_BASE, "utm_content": utm_content}
    s = urlsplit(url)
    query_pairs = parse_qsl(s.query, keep_blank_values=True)
    existing_keys = {k for k, _ in query_pairs}
    updated = list(query_pairs)
    for k, v in target.items():
        if k not in existing_keys:
            updated.append((k, v))
    new_query = urlencode(updated, doseq=True)
    return urlunsplit((s.scheme, s.netloc, s.path, new_query, s.fragment))


def do_utm_tagging(client, svc, apply_changes):
    print("\n== UTM TAGGING ON ENABLED ADS ==")
    rows = list(
        svc.search(
            customer_id=CLIENT_CUSTOMER_ID,
            query=(
                "SELECT ad_group_ad.ad.id, ad_group_ad.ad.final_urls, "
                "ad_group.id, ad_group.name, ad_group_ad.resource_name "
                "FROM ad_group_ad "
                "WHERE ad_group_ad.status = 'ENABLED' "
                f"AND campaign.id = {CAMPAIGN_ID}"
            ),
        )
    )
    planned_updates = []
    for r in rows:
        ad = r.ad_group_ad.ad
        urls = list(ad.final_urls) if ad.final_urls else []
        if not urls:
            continue
        new_urls = [_merge_utms(u, r.ad_group.id) for u in urls]
        if new_urls == urls:
            print(f"  skip (utms present): ad {ad.id} in {r.ad_group.name}")
            continue
        print(f"  update: ad {ad.id} in {r.ad_group.name}")
        for old, new in zip(urls, new_urls):
            print(f"      {old}")
            print(f"   -> {new}")
        planned_updates.append((r.ad_group_ad.resource_name, new_urls))

    if not planned_updates or not apply_changes:
        return

    ad_updates = []
    for r in rows:
        ad = r.ad_group_ad.ad
        urls = list(ad.final_urls) if ad.final_urls else []
        if not urls:
            continue
        new_urls = [_merge_utms(u, r.ad_group.id) for u in urls]
        if new_urls == urls:
            continue
        ad_updates.append((ad.resource_name, new_urls))

    from google.api_core import protobuf_helpers

    ad_svc = client.get_service("AdService")
    ad_ops = []
    for ad_resource_name, new_urls in ad_updates:
        op = client.get_type("AdOperation")
        ad = op.update
        ad.resource_name = ad_resource_name
        del ad.final_urls[:]
        ad.final_urls.extend(new_urls)
        client.copy_from(
            op.update_mask,
            protobuf_helpers.field_mask(None, ad._pb),
        )
        ad_ops.append(op)

    resp = ad_svc.mutate_ads(customer_id=CLIENT_CUSTOMER_ID, operations=ad_ops)
    print(f"  -> updated {len(resp.results)} ads.")


STEPS = {
    "negatives": do_negatives,
    "phrase": do_phrase_variants,
    "utm": do_utm_tagging,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__ or "")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--steps", nargs="+", choices=list(STEPS.keys()))
    args = parser.parse_args()
    if args.all:
        steps = list(STEPS.keys())
    elif args.steps:
        steps = args.steps
    else:
        steps = list(STEPS.keys())
    apply_changes = args.apply
    print(f"Mode: {'APPLY' if apply_changes else 'DRY-RUN'}")
    print(f"Steps: {', '.join(steps)}")

    client = _client()
    svc = client.get_service("GoogleAdsService")

    for step in steps:
        STEPS[step](client, svc, apply_changes)

    print("\nDone.")


if __name__ == "__main__":
    main()
