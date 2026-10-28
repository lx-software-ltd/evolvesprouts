# Marketing Assessment Scripts

Read-only scripts for querying ad platform and analytics APIs to assess
Evolve Sprouts marketing performance.

## Folder structure

```
marketing/
├── scripts/
│   ├── google-ads-assessment.py   # Google Ads API (campaigns, keywords, ads)
│   ├── meta-ads-assessment.py     # Meta Marketing API (campaigns, ad sets, ads)
│   ├── instagram-assessment.py    # Instagram Graph API (live stories, organic reach, posts)
│   ├── ga4-assessment.py          # GA4 Data API (traffic, funnel, events)
│   ├── ga4-create-audiences.py    # GA4 Admin API (create remarketing audiences)
│   └── requirements.txt           # Python dependencies
├── reports/
│   ├── ads-performance-assessment-YYYY-MM-DD.md   # narrative snapshots
│   ├── instagram-organic-assessment-YYYY-MM-DD.md # organic / stories snapshots
│   ├── ga4-manual-setup-steps.md                  # GA4 UI checklist
│   ├── google-ads-manual-setup-steps.md           # Google Ads UI checklist
│   └── meta-ads-manual-setup-steps.md             # Meta UI checklist
└── generated-reports/              # git-ignored, raw script output (--out)
```

## Prerequisites

Install Python dependencies:

```bash
pip install -r scripts/requirements.txt
```

## Required environment variables

All scripts use Cursor Cloud Agent secrets (injected as env vars):

| Variable | Script | Purpose |
|---|---|---|
| `EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN` | google-ads | API developer token |
| `EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID` | google-ads | MCC (manager) account ID |
| `EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON` | google-ads, ga4 | GCP service account credentials |
| `EVOLVESPROUTS_GA4_PROPERTY_ID` | ga4 | GA4 property ID |
| `EVOLVESPROUTS_META_SYSTEM_USER_ACCESS_TOKEN` | meta-ads, instagram | System user access token |
| `EVOLVESPROUTS_META_AD_ACCOUNT_ID` | meta-ads | Ad account ID (`act_...`) |
| `EVOLVESPROUTS_META_INSTAGRAM_BUSINESS_ACCOUNT_ID` | instagram | Instagram business account ID |
| `EVOLVESPROUTS_GOOGLE_CLIENT_EMAIL` | ga4-create-audiences | Service account email |

## Usage

Run from the `marketing/` directory:

```bash
python3 scripts/google-ads-assessment.py
python3 scripts/meta-ads-assessment.py
python3 scripts/instagram-assessment.py
python3 scripts/ga4-assessment.py
```

`instagram-assessment.py` reports the stories that are live at run time.
Story insights are only available for 24 hours, so run it within a day of
posting a story set, not only on the Monday pull.

### Capturing raw output (`--out`)

Each assessment script accepts an optional `--out <path>` flag that tees
stdout into a plaintext file. The recommended location is
`marketing/generated-reports/` (git-ignored), dated to match the narrative
markdown report you will author alongside it:

```bash
DATE=$(date -u +%F)
python3 scripts/google-ads-assessment.py --out "generated-reports/$DATE-google-ads.txt"
python3 scripts/meta-ads-assessment.py   --out "generated-reports/$DATE-meta-ads.txt"
python3 scripts/instagram-assessment.py  --out "generated-reports/$DATE-instagram.txt"
python3 scripts/ga4-assessment.py        --out "generated-reports/$DATE-ga4.txt"
```

## Weekly cadence

Run the three assessments every **Monday morning (HKT)**:

| Day | Focus |
|---|---|
| Mon | Pull data (`--out`). Author the week's narrative report under `reports/`. |
| Tue | Ship **one** Google Ads change from `reports/google-ads-manual-setup-steps.md`. |
| Wed | Ship **one** GA4 change from `reports/ga4-manual-setup-steps.md`. |
| Thu | Ship **one** Meta change from `reports/meta-ads-manual-setup-steps.md`. |
| Fri | Observe + screenshot impact; note it in next Monday's report. |

## Unified UTM convention (mandatory for all paid / tagged links)

All outbound paid or tagged links should follow a single convention so GA4
traffic source reports and per-platform campaign reports stay aligned:

```
?utm_source={platform}
 &utm_medium={channel}
 &utm_campaign={campaign}
 &utm_content={ad_or_asset}
 &utm_term={keyword_or_audience}
```

Concrete values we use:

| Field | Examples |
|---|---|
| `utm_source` | `google`, `meta`, `instagram`, `mailchimp`, `whatsapp` |
| `utm_medium` | `cpc`, `paid_social`, `email`, `chat`, `bio`, `referral` |
| `utm_campaign` | `my-best-auntie-search-hk`, `easter-workshop-2026`, `free-guide-apr-2026` |
| `utm_content` | `rsa-helper-training`, `family-consultations`, `reel-easter-v1`, `carousel-guide-v1` |
| `utm_term` | `helper-training-hong-kong`, `montessori-consultation`, `lookalike-1pct-hk` |

Kebab-case only; no spaces, no URL-encoded commas. Google Ads auto-tagging
(`gclid`) stays on; the UTM layer is additive and makes `sessionCampaignName`
populated even for platforms Google Ads doesn't auto-tag (Meta, Mailchimp,
WhatsApp, Instagram bio).

### GA4 audience creation (requires temporary Editor access)

The `ga4-create-audiences.py` script creates three remarketing audiences.
It requires temporary Editor access on the GA4 property:

1. Go to GA4 Admin > Property Access Management
2. Find `ga4-reader@evolve-sprouts.iam.gserviceaccount.com`
3. Change role from Viewer to Editor
4. Run: `python3 scripts/ga4-create-audiences.py`
5. Revoke back to Viewer after done

The assessment scripts are read-only and make no changes to any platform.

## Reports

Assessment reports are stored in `reports/` with the naming convention
`ads-performance-assessment-YYYY-MM-DD.md`. Each report captures a
point-in-time snapshot of ad performance data and includes analysis and
recommendations.
