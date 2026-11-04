"""Google Ads — November 2026 restructure (read-write).

Grounded in the 2026-11-04 live pull (see
``reports/ads-performance-assessment-2026-11-04.md``). The broad-match
keyword "montessori consultation" consumed 62% of lifetime spend with 9%
query relevance, and Maximize Clicks kept shifting budget toward it
(83% of October spend) while the Helper Training ad group that produced
71% of soft conversions was starved.

Idempotent: every step re-reads live state and prints "skip (exists)" for
no-ops, so re-runs are safe.

Operations (``--steps`` or ``--all``):

  negatives          Add campaign-level negatives for the search-term leaks
                     (navigational brand/app/school queries, generic how-to
                     parenting questions) and widen ``ymca`` / ``i learner``
                     from EXACT to PHRASE. Applied to every ENABLED search
                     campaign so the new Consultations campaign inherits them.
  consult-campaign   Create "My Best Auntie — Consultations — HK" with its
                     own HK$12/day budget, Maximize Clicks (HK$12 ceiling),
                     Google Search only, Hong Kong presence, English. Ad group
                     "Family Consultations" with PHRASE/EXACT keywords only,
                     a clone of the existing Family Consultations RSA, and the
                     same sitelinks as the original campaign.
  pause-old-consult  Pause the original "Family Consultations" ad group so
                     the broad keywords stop serving. Only runs once the new
                     campaign exists.
  pause-helper-broad Pause BROAD "helper training hong kong" in Helper
                     Training Course (HK$1,087 lifetime, 0 soft conversions;
                     its PHRASE twin produced 5).
  budget             Lower the original campaign budget HK$50 -> HK$30/day.
  primary-conv       Make the real lead signals primary conversions
                     (``whatsapp_click``, ``media_form_submit_success``,
                     ``booking_confirm_pay_click``) and promote the HIDDEN
                     GA4 imports ``booking_submit_success`` (primary) and
                     ``contact_form_submit_success`` (secondary).
  assets             Add callout + structured-snippet assets and a
                     "Book a Free 15-min Call" sitelink to every ENABLED
                     search campaign.
  helper-lp-url      Point the Helper Training Course ads at the dedicated
                     paid landing page. NOT part of ``--all``; run it only
                     after ``/en/helper-training-hong-kong`` is deployed.

Deliberately NOT here (no API surface / needs a human): call asset (business
phone is a build-time placeholder), image assets, Enhanced Conversions,
GA4 Google Signals / audience export.

Required env vars:
    EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID      Manager (MCC) account ID
    EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN
    EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON

Usage:
    python3 scripts/apply/google-ads-apply-nov-restructure.py --dry-run --all
    python3 scripts/apply/google-ads-apply-nov-restructure.py --apply --all
    python3 scripts/apply/google-ads-apply-nov-restructure.py --apply --steps helper-lp-url
"""

import argparse
import os
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from google.ads.googleads.client import GoogleAdsClient
from google.api_core import protobuf_helpers

API_VERSION = "v26"
CLIENT_CUSTOMER_ID = "4991144901"
SEARCH_CAMPAIGN_ID = 23659032602
HELPER_TRAINING_AG_ID = 195059847980
FAMILY_CONSULT_AG_ID = 195398533196
FAMILY_CONSULT_AD_ID = 804820517976

CONSULT_CAMPAIGN_NAME = "My Best Auntie — Consultations — HK"
CONSULT_AG_NAME = "Family Consultations"
CONSULT_BUDGET_MICROS = 12_000_000
CONSULT_CPC_CEILING_MICROS = 12_000_000
CONSULT_AG_CPC_BID_MICROS = 8_000_000
SEARCH_BUDGET_NEW_MICROS = 30_000_000
HK_GEO_TARGET = "geoTargetConstants/2344"
ENGLISH_LANGUAGE = "languageConstants/1000"

SITE_ORIGIN = "https://www.evolvesprouts.com"
HELPER_LP_PATH = "/en/helper-training-hong-kong"
FREE_CALL_PATH = "/en/book-a-free-call"

# Search-term leaks observed Aug 6 - Nov 3 2026 under "montessori consultation".
CAMPAIGN_NEGATIVES = [
    # Navigational: other brands, apps, schools
    ("solid memory", "PHRASE"),
    ("solidmemory", "PHRASE"),
    ("starfall", "PHRASE"),
    ("sunshine online", "PHRASE"),
    ("eclass", "PHRASE"),
    ("i learner", "PHRASE"),
    ("ileaner", "PHRASE"),
    ("ymca", "PHRASE"),
    ("kindergarten", "PHRASE"),
    ("school", "PHRASE"),
    ("schools", "PHRASE"),
    ("playschool", "PHRASE"),
    ("academy", "PHRASE"),
    ("app", "PHRASE"),
    ("apps", "PHRASE"),
    ("toys", "PHRASE"),
    ("pdf", "PHRASE"),
    ("books", "PHRASE"),
    # Generic how-to parenting questions that never convert
    ("tantrum", "PHRASE"),
    ("tantrums", "PHRASE"),
    ("potty", "PHRASE"),
    ("adhd", "PHRASE"),
    ("autism", "PHRASE"),
    ("newborn", "PHRASE"),
    ("teenager", "PHRASE"),
    ("teenagers", "PHRASE"),
    ("milestones", "PHRASE"),
    # Caregiver / elderly-care schools
    ("caregiver", "PHRASE"),
]
# EXACT negatives superseded by the PHRASE versions above.
NEGATIVES_TO_REMOVE = [("ymca", "EXACT"), ("i learner", "EXACT")]

CONSULT_KEYWORDS = [
    ("montessori consultation", "PHRASE"),
    ("montessori consultation", "EXACT"),
    ("montessori consultation hong kong", "EXACT"),
    ("parenting consultation hong kong", "PHRASE"),
    ("parenting consultation hong kong", "EXACT"),
    ("family consultation hong kong", "PHRASE"),
    ("family consultation hong kong", "EXACT"),
    ("child development consultation hong kong", "PHRASE"),
    ("child development consultation hong kong", "EXACT"),
    ("parenting coach hong kong", "PHRASE"),
    ("parenting coach hong kong", "EXACT"),
    ("positive discipline coach hong kong", "PHRASE"),
    ("montessori parenting coach", "PHRASE"),
    ("toddler behaviour consultant hong kong", "PHRASE"),
]

PRIMARY_CONVERSIONS = [
    "Evolve Sprouts Website (web) whatsapp_click",
    "Evolve Sprouts Website (web) media_form_submit_success",
    "Evolve Sprouts Website (web) booking_confirm_pay_click",
    "Evolve Sprouts Website (web) booking_submit_success",
]
SECONDARY_CONVERSIONS = [
    "Evolve Sprouts Website (web) contact_form_submit_success",
]

CALLOUTS = [
    "AMI Montessori-Certified",
    "3 Home Visits Included",
    "9-Week Programme",
    "Small Group Sessions",
    "Free 15-Min Intro Call",
    "WhatsApp Support",
]
# Course-specific callouts stay on the Helper Training (original search) campaign only.
COURSE_ONLY_CALLOUTS = {
    "3 Home Visits Included",
    "9-Week Programme",
    "Small Group Sessions",
}
STRUCTURED_SNIPPET_HEADER = "Services"
STRUCTURED_SNIPPET_VALUES = [
    "Helper Training Course",
    "Family Consultations",
    "Home Assessment",
    "Parent Coaching",
    "Free Intro Call",
]
FREE_CALL_SITELINK = {
    "link_text": "Book a Free 15-min Call",
    "description1": "Talk to Ida about your family",
    "description2": "No commitment, no fee",
    "final_url": f"{SITE_ORIGIN}{FREE_CALL_PATH}",
}

HELPER_LP_UTMS = {
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "my-best-auntie-search-hk",
    "utm_content": "helper-training-lp",
}


def _client():
    sa_json = os.environ.get("EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if not sa_json:
        sys.exit("EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON not set")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        f.write(sa_json)
        sa_path = f.name
    manager_id = os.environ.get("EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID", "").replace(
        "-", ""
    )
    dev_token = os.environ.get("EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN", "")
    if not manager_id or not dev_token:
        sys.exit("Missing GOOGLE_ADS_CUSTOMER_ID or DEVELOPER_TOKEN")
    return GoogleAdsClient.load_from_dict(
        {
            "developer_token": dev_token,
            "json_key_file_path": sa_path,
            "impersonated_email": "",
            "login_customer_id": manager_id,
            "use_proto_plus": True,
        },
        version=API_VERSION,
    )


def _rows(svc, query):
    return list(svc.search(customer_id=CLIENT_CUSTOMER_ID, query=query))


def _update_mask(client, op, message):
    client.copy_from(op.update_mask, protobuf_helpers.field_mask(None, message._pb))


def _enabled_search_campaigns(svc):
    return {
        r.campaign.id: r.campaign.name
        for r in _rows(
            svc,
            "SELECT campaign.id, campaign.name FROM campaign "
            "WHERE campaign.status = 'ENABLED' "
            "AND campaign.advertising_channel_type = 'SEARCH'",
        )
    }


def _consult_campaign_id(svc):
    for r in _rows(
        svc,
        "SELECT campaign.id, campaign.name FROM campaign "
        "WHERE campaign.status != 'REMOVED'",
    ):
        if r.campaign.name == CONSULT_CAMPAIGN_NAME:
            return r.campaign.id
    return None


def _campaign_negatives(svc, campaign_id):
    out = {}
    for r in _rows(
        svc,
        "SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text, "
        "campaign_criterion.keyword.match_type FROM campaign_criterion "
        f"WHERE campaign_criterion.negative = TRUE AND campaign.id = {campaign_id} "
        "AND campaign_criterion.type = 'KEYWORD'",
    ):
        kw = r.campaign_criterion.keyword
        out[(kw.text.lower(), kw.match_type.name)] = r.campaign_criterion.resource_name
    return out


# ---------------------------------------------------------------- negatives
def do_negatives(client, svc, apply_changes):
    print("\n== CAMPAIGN NEGATIVES ==")
    campaigns = _enabled_search_campaigns(svc)
    campaign_svc = client.get_service("CampaignService")
    match_enum = client.enums.KeywordMatchTypeEnum
    ops = []
    for campaign_id, name in campaigns.items():
        existing = _campaign_negatives(svc, campaign_id)
        print(f"  campaign {campaign_id} ({name}):")
        for text, match_type in CAMPAIGN_NEGATIVES:
            if (text, match_type) in existing:
                print(f"    skip (exists): {match_type:6} {text!r}")
                continue
            print(f"    add:  {match_type:6} {text!r}")
            op = client.get_type("CampaignCriterionOperation")
            cc = op.create
            cc.campaign = campaign_svc.campaign_path(CLIENT_CUSTOMER_ID, campaign_id)
            cc.negative = True
            cc.keyword.text = text
            cc.keyword.match_type = match_enum[match_type]
            ops.append(op)
        for text, match_type in NEGATIVES_TO_REMOVE:
            resource = existing.get((text, match_type))
            if not resource:
                print(f"    skip (already removed): {match_type:6} {text!r}")
                continue
            print(f"    remove: {match_type:6} {text!r}")
            op = client.get_type("CampaignCriterionOperation")
            op.remove = resource
            ops.append(op)

    if not ops or not apply_changes:
        return
    resp = client.get_service("CampaignCriterionService").mutate_campaign_criteria(
        customer_id=CLIENT_CUSTOMER_ID, operations=ops
    )
    print(f"  -> {len(resp.results)} campaign criterion operations applied.")


# --------------------------------------------------------- consult campaign
def _fetch_rsa(svc, ad_id):
    rows = _rows(
        svc,
        "SELECT ad_group_ad.ad.id, ad_group_ad.ad.final_urls, "
        "ad_group_ad.ad.responsive_search_ad.headlines, "
        "ad_group_ad.ad.responsive_search_ad.descriptions, "
        "ad_group_ad.ad.responsive_search_ad.path1, "
        "ad_group_ad.ad.responsive_search_ad.path2 "
        f"FROM ad_group_ad WHERE ad_group_ad.ad.id = {ad_id}",
    )
    return rows[0].ad_group_ad.ad if rows else None


def _with_utm(url, overrides):
    s = urlsplit(url)
    pairs = [
        (k, v)
        for k, v in parse_qsl(s.query, keep_blank_values=True)
        if k not in overrides
    ]
    pairs.extend(overrides.items())
    return urlunsplit((s.scheme, s.netloc, s.path, urlencode(pairs), s.fragment))


def _sitelink_assets_for_campaign(svc, campaign_id):
    return [
        r.campaign_asset.asset
        for r in _rows(
            svc,
            "SELECT campaign.id, campaign_asset.asset, campaign.status FROM campaign_asset "
            f"WHERE campaign.id = {campaign_id} AND campaign_asset.field_type = 'SITELINK'",
        )
    ]


def do_consult_campaign(client, svc, apply_changes):
    print("\n== CONSULTATIONS CAMPAIGN ==")
    existing_id = _consult_campaign_id(svc)
    if existing_id:
        print(f"  skip (exists): campaign {existing_id} {CONSULT_CAMPAIGN_NAME!r}")
        return

    source_ad = _fetch_rsa(svc, FAMILY_CONSULT_AD_ID)
    if source_ad is None:
        sys.exit(f"Source RSA {FAMILY_CONSULT_AD_ID} not found; cannot clone.")
    source_negatives = _campaign_negatives(svc, SEARCH_CAMPAIGN_ID)
    sitelinks = _sitelink_assets_for_campaign(svc, SEARCH_CAMPAIGN_ID)

    print(f"  create budget: HK${CONSULT_BUDGET_MICROS / 1e6:.0f}/day (not shared)")
    print(
        f"  create campaign: {CONSULT_CAMPAIGN_NAME!r} | SEARCH | TARGET_SPEND "
        f"ceiling HK${CONSULT_CPC_CEILING_MICROS / 1e6:.0f} | Google Search only | "
        f"geo {HK_GEO_TARGET} (presence) | {ENGLISH_LANGUAGE}"
    )
    print(
        f"  copy {len(source_negatives)} campaign negatives from {SEARCH_CAMPAIGN_ID}"
    )
    print(f"  link {len(sitelinks)} sitelink assets")
    print(
        f"  create ad group: {CONSULT_AG_NAME!r} cpc bid HK${CONSULT_AG_CPC_BID_MICROS / 1e6:.0f}"
    )
    for text, mt in CONSULT_KEYWORDS:
        print(f"    keyword: {mt:6} {text!r}")
    new_url = _with_utm(
        next(iter(source_ad.final_urls)),
        {
            "utm_campaign": "my-best-auntie-consultations-hk",
            "utm_content": "family-consultations-rsa",
        },
    )
    print(f"  clone RSA {FAMILY_CONSULT_AD_ID} -> final URL {new_url}")
    if not apply_changes:
        return

    # 1. budget
    budget_op = client.get_type("CampaignBudgetOperation")
    budget = budget_op.create
    budget.name = CONSULT_CAMPAIGN_NAME
    budget.amount_micros = CONSULT_BUDGET_MICROS
    budget.delivery_method = client.enums.BudgetDeliveryMethodEnum.STANDARD
    budget.explicitly_shared = False
    budget_rn = (
        client.get_service("CampaignBudgetService")
        .mutate_campaign_budgets(customer_id=CLIENT_CUSTOMER_ID, operations=[budget_op])
        .results[0]
        .resource_name
    )

    # 2. campaign
    camp_op = client.get_type("CampaignOperation")
    camp = camp_op.create
    camp.name = CONSULT_CAMPAIGN_NAME
    camp.status = client.enums.CampaignStatusEnum.ENABLED
    camp.advertising_channel_type = client.enums.AdvertisingChannelTypeEnum.SEARCH
    camp.campaign_budget = budget_rn
    camp.target_spend.cpc_bid_ceiling_micros = CONSULT_CPC_CEILING_MICROS
    camp.network_settings.target_google_search = True
    camp.network_settings.target_search_network = False
    camp.network_settings.target_content_network = False
    camp.network_settings.target_partner_search_network = False
    camp.geo_target_type_setting.positive_geo_target_type = (
        client.enums.PositiveGeoTargetTypeEnum.PRESENCE
    )
    camp.geo_target_type_setting.negative_geo_target_type = (
        client.enums.NegativeGeoTargetTypeEnum.PRESENCE
    )
    camp.contains_eu_political_advertising = client.enums.EuPoliticalAdvertisingStatusEnum.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING
    campaign_rn = (
        client.get_service("CampaignService")
        .mutate_campaigns(customer_id=CLIENT_CUSTOMER_ID, operations=[camp_op])
        .results[0]
        .resource_name
    )
    print(f"  -> created campaign {campaign_rn}")

    # 3. campaign criteria: geo, language, negatives
    crit_ops = []
    geo_op = client.get_type("CampaignCriterionOperation")
    geo_op.create.campaign = campaign_rn
    geo_op.create.location.geo_target_constant = HK_GEO_TARGET
    crit_ops.append(geo_op)
    lang_op = client.get_type("CampaignCriterionOperation")
    lang_op.create.campaign = campaign_rn
    lang_op.create.language.language_constant = ENGLISH_LANGUAGE
    crit_ops.append(lang_op)
    match_enum = client.enums.KeywordMatchTypeEnum
    for text, match_type in source_negatives:
        if (text, match_type) in NEGATIVES_TO_REMOVE:
            continue
        op = client.get_type("CampaignCriterionOperation")
        op.create.campaign = campaign_rn
        op.create.negative = True
        op.create.keyword.text = text
        op.create.keyword.match_type = match_enum[match_type]
        crit_ops.append(op)
    resp = client.get_service("CampaignCriterionService").mutate_campaign_criteria(
        customer_id=CLIENT_CUSTOMER_ID, operations=crit_ops
    )
    print(f"  -> {len(resp.results)} campaign criteria (geo, language, negatives).")

    # 4. sitelinks
    if sitelinks:
        asset_ops = []
        for asset_rn in sitelinks:
            op = client.get_type("CampaignAssetOperation")
            op.create.campaign = campaign_rn
            op.create.asset = asset_rn
            op.create.field_type = client.enums.AssetFieldTypeEnum.SITELINK
            asset_ops.append(op)
        resp = client.get_service("CampaignAssetService").mutate_campaign_assets(
            customer_id=CLIENT_CUSTOMER_ID, operations=asset_ops
        )
        print(f"  -> linked {len(resp.results)} sitelinks.")

    # 5. ad group
    ag_op = client.get_type("AdGroupOperation")
    ag = ag_op.create
    ag.name = CONSULT_AG_NAME
    ag.campaign = campaign_rn
    ag.status = client.enums.AdGroupStatusEnum.ENABLED
    ag.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD
    ag.cpc_bid_micros = CONSULT_AG_CPC_BID_MICROS
    ag_rn = (
        client.get_service("AdGroupService")
        .mutate_ad_groups(customer_id=CLIENT_CUSTOMER_ID, operations=[ag_op])
        .results[0]
        .resource_name
    )

    # 6. keywords
    kw_ops = []
    for text, match_type in CONSULT_KEYWORDS:
        op = client.get_type("AdGroupCriterionOperation")
        op.create.ad_group = ag_rn
        op.create.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
        op.create.keyword.text = text
        op.create.keyword.match_type = match_enum[match_type]
        kw_ops.append(op)
    resp = client.get_service("AdGroupCriterionService").mutate_ad_group_criteria(
        customer_id=CLIENT_CUSTOMER_ID, operations=kw_ops
    )
    print(f"  -> {len(resp.results)} keywords.")

    # 7. RSA clone
    ad_op = client.get_type("AdGroupAdOperation")
    aga = ad_op.create
    aga.ad_group = ag_rn
    aga.status = client.enums.AdGroupAdStatusEnum.ENABLED
    aga.ad.final_urls.append(new_url)
    rsa = aga.ad.responsive_search_ad
    src = source_ad.responsive_search_ad
    for h in src.headlines:
        asset = client.get_type("AdTextAsset")
        asset.text = h.text
        if h.pinned_field:
            asset.pinned_field = h.pinned_field
        rsa.headlines.append(asset)
    for d in src.descriptions:
        asset = client.get_type("AdTextAsset")
        asset.text = d.text
        if d.pinned_field:
            asset.pinned_field = d.pinned_field
        rsa.descriptions.append(asset)
    if src.path1:
        rsa.path1 = src.path1
    if src.path2:
        rsa.path2 = src.path2
    resp = client.get_service("AdGroupAdService").mutate_ad_group_ads(
        customer_id=CLIENT_CUSTOMER_ID, operations=[ad_op]
    )
    print(f"  -> created RSA {resp.results[0].resource_name}")


# ------------------------------------------------------------- pause steps
def _set_ad_group_status(client, ag_id, status_name, apply_changes, label):
    svc = client.get_service("GoogleAdsService")
    rows = _rows(
        svc,
        f"SELECT ad_group.resource_name, ad_group.status FROM ad_group WHERE ad_group.id = {ag_id}",
    )
    if not rows:
        print(f"  missing: ad group {ag_id}")
        return
    ag = rows[0].ad_group
    if ag.status.name == status_name:
        print(f"  skip (already {status_name}): {label}")
        return
    print(f"  {ag.status.name} -> {status_name}: {label}")
    if not apply_changes:
        return
    op = client.get_type("AdGroupOperation")
    op.update.resource_name = ag.resource_name
    op.update.status = client.enums.AdGroupStatusEnum[status_name]
    _update_mask(client, op, op.update)
    client.get_service("AdGroupService").mutate_ad_groups(
        customer_id=CLIENT_CUSTOMER_ID, operations=[op]
    )
    print("  -> updated.")


def do_pause_old_consult(client, svc, apply_changes):
    print("\n== PAUSE ORIGINAL FAMILY CONSULTATIONS AD GROUP ==")
    if not _consult_campaign_id(svc) and apply_changes:
        print(
            "  skip: new Consultations campaign does not exist yet; run consult-campaign first."
        )
        return
    _set_ad_group_status(
        client,
        FAMILY_CONSULT_AG_ID,
        "PAUSED",
        apply_changes,
        f"Family Consultations ({FAMILY_CONSULT_AG_ID})",
    )


def do_pause_helper_broad(client, svc, apply_changes):
    print("\n== PAUSE BROAD 'helper training hong kong' ==")
    rows = _rows(
        svc,
        "SELECT ad_group_criterion.resource_name, ad_group_criterion.status, "
        "ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type "
        f"FROM ad_group_criterion WHERE ad_group.id = {HELPER_TRAINING_AG_ID} "
        "AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE "
        "AND ad_group_criterion.keyword.match_type = 'BROAD'",
    )
    target = [
        r
        for r in rows
        if r.ad_group_criterion.keyword.text.lower() == "helper training hong kong"
    ]
    if not target:
        print("  missing: broad keyword not found")
        return
    crit = target[0].ad_group_criterion
    if crit.status.name == "PAUSED":
        print("  skip (already PAUSED)")
        return
    print(f"  {crit.status.name} -> PAUSED: {crit.keyword.text!r} [BROAD]")
    if not apply_changes:
        return
    op = client.get_type("AdGroupCriterionOperation")
    op.update.resource_name = crit.resource_name
    op.update.status = client.enums.AdGroupCriterionStatusEnum.PAUSED
    _update_mask(client, op, op.update)
    client.get_service("AdGroupCriterionService").mutate_ad_group_criteria(
        customer_id=CLIENT_CUSTOMER_ID, operations=[op]
    )
    print("  -> updated.")


# ------------------------------------------------------------------ budget
def do_budget(client, svc, apply_changes):
    print("\n== ORIGINAL CAMPAIGN BUDGET ==")
    rows = _rows(
        svc,
        "SELECT campaign_budget.resource_name, campaign_budget.amount_micros, "
        "campaign_budget.explicitly_shared FROM campaign "
        f"WHERE campaign.id = {SEARCH_CAMPAIGN_ID}",
    )
    if not rows:
        print("  missing campaign")
        return
    b = rows[0].campaign_budget
    if b.explicitly_shared:
        print("  skip: budget is shared; adjust manually.")
        return
    if b.amount_micros == SEARCH_BUDGET_NEW_MICROS:
        print(f"  skip (already HK${SEARCH_BUDGET_NEW_MICROS / 1e6:.0f}/day)")
        return
    print(
        f"  HK${b.amount_micros / 1e6:.0f}/day -> HK${SEARCH_BUDGET_NEW_MICROS / 1e6:.0f}/day"
    )
    if not apply_changes:
        return
    op = client.get_type("CampaignBudgetOperation")
    op.update.resource_name = b.resource_name
    op.update.amount_micros = SEARCH_BUDGET_NEW_MICROS
    _update_mask(client, op, op.update)
    client.get_service("CampaignBudgetService").mutate_campaign_budgets(
        customer_id=CLIENT_CUSTOMER_ID, operations=[op]
    )
    print("  -> updated.")


# --------------------------------------------------------- primary conversions
def do_primary_conversions(client, svc, apply_changes):
    print("\n== CONVERSION GOALS ==")
    by_name = {
        r.conversion_action.name: r.conversion_action
        for r in _rows(
            svc,
            "SELECT conversion_action.resource_name, conversion_action.name, "
            "conversion_action.status, conversion_action.primary_for_goal "
            "FROM conversion_action",
        )
    }
    ops = []
    for name, primary in [(n, True) for n in PRIMARY_CONVERSIONS] + [
        (n, False) for n in SECONDARY_CONVERSIONS
    ]:
        ca = by_name.get(name)
        if not ca:
            print(f"  missing in ledger: {name}")
            continue
        wants_status = "ENABLED"
        if ca.status.name == wants_status and ca.primary_for_goal == primary:
            print(
                f"  skip (already {'primary' if primary else 'secondary'}, ENABLED): {name}"
            )
            continue
        print(
            f"  {ca.status.name}/{'primary' if ca.primary_for_goal else 'secondary'} -> "
            f"ENABLED/{'primary' if primary else 'secondary'}: {name}"
        )
        op = client.get_type("ConversionActionOperation")
        upd = op.update
        upd.resource_name = ca.resource_name
        upd.status = client.enums.ConversionActionStatusEnum.ENABLED
        upd.primary_for_goal = primary
        _update_mask(client, op, upd)
        ops.append(op)
    if not ops or not apply_changes:
        return
    resp = client.get_service("ConversionActionService").mutate_conversion_actions(
        customer_id=CLIENT_CUSTOMER_ID, operations=ops
    )
    print(f"  -> updated {len(resp.results)} conversion actions.")


# ------------------------------------------------------------------ assets
def _existing_text_assets(svc):
    callouts, snippets, sitelinks = {}, {}, {}
    for r in _rows(
        svc,
        "SELECT asset.resource_name, asset.type, asset.callout_asset.callout_text, "
        "asset.structured_snippet_asset.header, asset.sitelink_asset.link_text FROM asset "
        "WHERE asset.type IN ('CALLOUT', 'STRUCTURED_SNIPPET', 'SITELINK')",
    ):
        a = r.asset
        if a.type.name == "CALLOUT":
            callouts[a.callout_asset.callout_text] = a.resource_name
        elif a.type.name == "STRUCTURED_SNIPPET":
            snippets[a.structured_snippet_asset.header] = a.resource_name
        elif a.type.name == "SITELINK":
            sitelinks[a.sitelink_asset.link_text] = a.resource_name
    return callouts, snippets, sitelinks


def _campaign_asset_links(svc):
    links = set()
    for r in _rows(
        svc,
        "SELECT campaign.id, campaign.status, campaign_asset.asset, campaign_asset.field_type "
        "FROM campaign_asset WHERE campaign.status = 'ENABLED'",
    ):
        links.add(
            (r.campaign.id, r.campaign_asset.asset, r.campaign_asset.field_type.name)
        )
    return links


def do_assets(client, svc, apply_changes):
    print("\n== CALLOUT / SNIPPET / SITELINK ASSETS ==")
    callouts, snippets, sitelinks = _existing_text_assets(svc)
    asset_svc = client.get_service("AssetService")
    create_ops = []
    pending = []  # (kind, key) created in this run

    for text in CALLOUTS:
        if text in callouts:
            print(f"  skip (asset exists): callout {text!r}")
            continue
        print(f"  create asset: callout {text!r}")
        op = client.get_type("AssetOperation")
        op.create.callout_asset.callout_text = text
        create_ops.append(op)
        pending.append(("callout", text))
    if STRUCTURED_SNIPPET_HEADER in snippets:
        print(f"  skip (asset exists): snippet {STRUCTURED_SNIPPET_HEADER!r}")
    else:
        print(
            f"  create asset: snippet {STRUCTURED_SNIPPET_HEADER!r} {STRUCTURED_SNIPPET_VALUES}"
        )
        op = client.get_type("AssetOperation")
        op.create.structured_snippet_asset.header = STRUCTURED_SNIPPET_HEADER
        op.create.structured_snippet_asset.values.extend(STRUCTURED_SNIPPET_VALUES)
        create_ops.append(op)
        pending.append(("snippet", STRUCTURED_SNIPPET_HEADER))
    if FREE_CALL_SITELINK["link_text"] in sitelinks:
        print(f"  skip (asset exists): sitelink {FREE_CALL_SITELINK['link_text']!r}")
    else:
        print(
            f"  create asset: sitelink {FREE_CALL_SITELINK['link_text']!r} -> {FREE_CALL_SITELINK['final_url']}"
        )
        op = client.get_type("AssetOperation")
        sl = op.create.sitelink_asset
        sl.link_text = FREE_CALL_SITELINK["link_text"]
        sl.description1 = FREE_CALL_SITELINK["description1"]
        sl.description2 = FREE_CALL_SITELINK["description2"]
        op.create.final_urls.append(FREE_CALL_SITELINK["final_url"])
        create_ops.append(op)
        pending.append(("sitelink", FREE_CALL_SITELINK["link_text"]))

    if apply_changes and create_ops:
        resp = asset_svc.mutate_assets(
            customer_id=CLIENT_CUSTOMER_ID, operations=create_ops
        )
        for (kind, key), result in zip(pending, resp.results):
            {"callout": callouts, "snippet": snippets, "sitelink": sitelinks}[kind][
                key
            ] = result.resource_name
        print(f"  -> created {len(resp.results)} assets.")

    campaigns = _enabled_search_campaigns(svc)
    links = _campaign_asset_links(svc)
    field_enum = client.enums.AssetFieldTypeEnum
    wanted = (
        [(callouts.get(t), "CALLOUT", t) for t in CALLOUTS]
        + [
            (
                snippets.get(STRUCTURED_SNIPPET_HEADER),
                "STRUCTURED_SNIPPET",
                STRUCTURED_SNIPPET_HEADER,
            )
        ]
        + [
            (
                sitelinks.get(FREE_CALL_SITELINK["link_text"]),
                "SITELINK",
                FREE_CALL_SITELINK["link_text"],
            )
        ]
    )
    link_ops = []
    for campaign_id, name in campaigns.items():
        for asset_rn, field_type, label in wanted:
            if label in COURSE_ONLY_CALLOUTS and campaign_id != SEARCH_CAMPAIGN_ID:
                continue
            if asset_rn and (campaign_id, asset_rn, field_type) in links:
                print(f"  skip (linked): {field_type} {label!r} on {name}")
                continue
            print(f"  link: {field_type} {label!r} -> {name}")
            if not asset_rn:
                continue  # dry-run: asset not created yet
            op = client.get_type("CampaignAssetOperation")
            op.create.campaign = client.get_service("CampaignService").campaign_path(
                CLIENT_CUSTOMER_ID, campaign_id
            )
            op.create.asset = asset_rn
            op.create.field_type = field_enum[field_type]
            link_ops.append(op)
    if not link_ops or not apply_changes:
        return
    resp = client.get_service("CampaignAssetService").mutate_campaign_assets(
        customer_id=CLIENT_CUSTOMER_ID, operations=link_ops
    )
    print(f"  -> linked {len(resp.results)} campaign assets.")


# ------------------------------------------------------------ helper LP url
def _landing_page_is_live(url):
    """Refuse to repoint ads at a page that is not deployed yet (non-200)."""
    req = Request(url, method="HEAD", headers={"User-Agent": "evolvesprouts-ads-apply"})
    try:
        with urlopen(req, timeout=15) as resp:
            return resp.status == 200
    except HTTPError as exc:
        print(f"  landing page returned HTTP {exc.code}: {url}")
    except URLError as exc:
        print(f"  landing page unreachable ({exc.reason}): {url}")
    return False


def do_helper_lp_url(client, svc, apply_changes):
    print("\n== HELPER TRAINING ADS -> PAID LANDING PAGE ==")
    plain_url = f"{SITE_ORIGIN}{HELPER_LP_PATH}"
    if not _landing_page_is_live(plain_url):
        print("  ABORT: deploy the landing page first, then re-run this step.")
        return
    target = _with_utm(plain_url, HELPER_LP_UTMS)
    rows = _rows(
        svc,
        "SELECT ad_group_ad.ad.resource_name, ad_group_ad.ad.id, ad_group_ad.ad.final_urls "
        f"FROM ad_group_ad WHERE ad_group.id = {HELPER_TRAINING_AG_ID} "
        "AND ad_group_ad.status = 'ENABLED'",
    )
    ops = []
    for r in rows:
        ad = r.ad_group_ad.ad
        urls = list(ad.final_urls)
        if urls == [target]:
            print(f"  skip (already LP): ad {ad.id}")
            continue
        print(f"  ad {ad.id}: {urls[0] if urls else '(none)'}\n    -> {target}")
        op = client.get_type("AdOperation")
        op.update.resource_name = ad.resource_name
        del op.update.final_urls[:]
        op.update.final_urls.append(target)
        _update_mask(client, op, op.update)
        ops.append(op)
    if not ops or not apply_changes:
        return
    resp = client.get_service("AdService").mutate_ads(
        customer_id=CLIENT_CUSTOMER_ID, operations=ops
    )
    print(f"  -> updated {len(resp.results)} ads.")


STEPS = {
    "negatives": do_negatives,
    "consult-campaign": do_consult_campaign,
    "pause-old-consult": do_pause_old_consult,
    "pause-helper-broad": do_pause_helper_broad,
    "budget": do_budget,
    "primary-conv": do_primary_conversions,
    "assets": do_assets,
    "helper-lp-url": do_helper_lp_url,
}
ALL_STEPS = [s for s in STEPS if s != "helper-lp-url"]


def main():
    parser = argparse.ArgumentParser(
        description=__doc__ or "", formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument(
        "--all", action="store_true", help="every step except helper-lp-url"
    )
    parser.add_argument("--steps", nargs="+", choices=list(STEPS.keys()))
    args = parser.parse_args()
    steps = args.steps or ALL_STEPS
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
