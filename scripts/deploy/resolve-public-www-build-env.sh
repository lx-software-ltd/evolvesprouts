#!/usr/bin/env bash
# Writes public website origins to GITHUB_OUTPUT from CDK params.
# A maintenance promotion does not need the asset-share domain.
set -euo pipefail

CDK_PARAMS_FILE="${1:-backend/infrastructure/params/production.json}"

if [ -z "${GITHUB_OUTPUT:-}" ]; then
  echo 'GITHUB_OUTPUT is not set'
  exit 1
fi

python3 - "$CDK_PARAMS_FILE" <<'PY'
import os
import json
import sys
from pathlib import Path

params = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))

def value(key: str) -> str:
    return str(params.get(key, "")).strip()

production = value("PublicWwwDomainName")
staging = value("PublicWwwStagingDomainName")
asset = value("AssetDownloadCustomDomainName")
training = value("TrainingDomainName")
missing = [
    key
    for key, found in (
        ("PublicWwwDomainName", production),
        ("PublicWwwStagingDomainName", staging),
    )
    if not found
]
mode = os.environ.get("PROMOTION_MODE", "")
require_asset = os.environ.get("REQUIRE_ASSET", "true") != "false" and mode != "maintenance_on"
if require_asset and not asset:
    missing.append("AssetDownloadCustomDomainName")
if os.environ.get("REQUIRE_TRAINING") == "true" and not training:
    missing.append("TrainingDomainName")
if missing:
    raise SystemExit(
        ", ".join(missing) + f" are required in {sys.argv[1]}"
    )

lines = [
    f"production_site_origin=https://{production}",
    f"staging_site_origin=https://{staging}",
]
if asset:
    lines.append(f"asset_share_base_url=https://{asset}")
if training:
    lines.append(f"training_site_origin=https://{training}")
with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
PY
