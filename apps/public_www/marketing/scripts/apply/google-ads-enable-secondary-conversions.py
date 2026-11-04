"""Google Ads — import additional GA4 events as Secondary conversions.

Toggles HIDDEN GA4-synced conversion actions to ENABLED + "Secondary"
(include_in_conversions_metric = False, primary_for_goal = False).

Only operates on actions whose name matches one of TARGET_NAMES.
Idempotent: skips anything already ENABLED.

Limitations documented in the dry-run output:
  * `whatsapp_click` and `booking_confirm_pay_click` are NOT in the
    Google Ads ledger today because GA4 has not marked them as Key
    Events — those events don't auto-sync until the GA4 Admin toggle
    is flipped. Once marked in GA4, re-run this script after 24h.
  * Enhanced Conversions for Web is NOT exposed via the Google Ads
    API; it must be toggled in the UI. See
    `apps/public_www/marketing/reports/google-ads-manual-setup-steps.md` §1.

Required env vars:
    EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID
    EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN
    EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON

Live customer:
    CLIENT_CUSTOMER_ID    = 4991144901

Usage:
    python3 scripts/apply/google-ads-enable-secondary-conversions.py --dry-run
    python3 scripts/apply/google-ads-enable-secondary-conversions.py --apply
"""

import argparse
import os
import sys
import tempfile

from google.ads.googleads.client import GoogleAdsClient
from google.api_core import protobuf_helpers

API_VERSION = "v26"
CLIENT_CUSTOMER_ID = "4991144901"

TARGET_NAMES = [
    "Evolve Sprouts Website (web) media_form_submit_success",
    "Evolve Sprouts Website (web) community_signup_submit_success",
    "Evolve Sprouts Website (web) booking_confirm_pay_click",
    "Evolve Sprouts Website (web) whatsapp_click",
]


def _client():
    sa_json = os.environ.get("EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if not sa_json:
        sys.exit("EVOLVESPROUTS_GOOGLE_SERVICE_ACCOUNT_JSON not set")
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    f.write(sa_json)
    f.close()
    manager_id = os.environ.get("EVOLVESPROUTS_GOOGLE_ADS_CUSTOMER_ID", "").replace("-", "")
    dev_token = os.environ.get("EVOLVESPROUTS_GOOGLE_ADS_DEVELOPER_TOKEN", "")
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


def main():
    parser = argparse.ArgumentParser(description=__doc__ or "")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true", default=True)
    args = parser.parse_args()
    apply_changes = args.apply

    client = _client()
    svc = client.get_service("GoogleAdsService")
    actions_by_name = {}
    for r in svc.search(
        customer_id=CLIENT_CUSTOMER_ID,
        query=(
            "SELECT conversion_action.resource_name, conversion_action.id, "
            "conversion_action.name, conversion_action.status, "
            "conversion_action.type, conversion_action.include_in_conversions_metric "
            "FROM conversion_action"
        ),
    ):
        actions_by_name[r.conversion_action.name] = r.conversion_action

    print(f"Mode: {'APPLY' if apply_changes else 'DRY-RUN'}\n")
    print("Planned updates:")
    planned = []
    for name in TARGET_NAMES:
        ca = actions_by_name.get(name)
        if not ca:
            print(f"  missing in ledger: {name}")
            continue
        if ca.status.name == "ENABLED":
            print(f"  skip (already ENABLED): {name}")
            continue
        print(f"  promote HIDDEN -> ENABLED (Secondary): {name}  (id={ca.id})")
        planned.append(ca)

    if not planned or not apply_changes:
        print("\nDry-run only. Re-run with --apply to promote.")
        return

    print()
    ca_svc = client.get_service("ConversionActionService")
    ops = []
    for ca in planned:
        op = client.get_type("ConversionActionOperation")
        new = op.update
        new.resource_name = ca.resource_name
        new.status = client.enums.ConversionActionStatusEnum.ENABLED
        # Secondary = counted but NOT included in conversions metric
        new.include_in_conversions_metric = False
        new.primary_for_goal = False
        client.copy_from(
            op.update_mask,
            protobuf_helpers.field_mask(None, new._pb),
        )
        ops.append(op)

    resp = ca_svc.mutate_conversion_actions(
        customer_id=CLIENT_CUSTOMER_ID,
        operations=ops,
    )
    print(f"  -> updated {len(resp.results)} conversion actions.")


if __name__ == "__main__":
    main()
