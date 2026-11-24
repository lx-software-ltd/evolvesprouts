#!/usr/bin/env bash
# Prepare a CDK diff or deploy. The body is this repository's parameter step.
set -euo pipefail
mode="${1:-}"
case "$mode" in
  diff|deploy) ;;
  *) echo "::error::cdk-prepare.sh requires diff or deploy" >&2; exit 1 ;;
esac
if [ ! -f backend/infrastructure/package.json ]; then
  echo "run=false" >> "${GITHUB_OUTPUT:?}"
  exit 0
fi
if [ -n "${CDK_PARAM_GOOGLE_CLIENT_SECRET:-}" ]; then echo "::add-mask::${CDK_PARAM_GOOGLE_CLIENT_SECRET}"; fi
if [ -n "${CDK_PARAM_COGNITO_CUSTOM_DOMAIN_CERTIFICATE_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_COGNITO_CUSTOM_DOMAIN_CERTIFICATE_ARN}"; fi
if [ -n "${CDK_PARAM_ADMIN_WEB_CERTIFICATE_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_ADMIN_WEB_CERTIFICATE_ARN}"; fi
if [ -n "${CDK_PARAM_PUBLIC_WWW_CERTIFICATE_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_PUBLIC_WWW_CERTIFICATE_ARN}"; fi
if [ -n "${CDK_PARAM_PUBLIC_WWW_STAGING_CERTIFICATE_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_PUBLIC_WWW_STAGING_CERTIFICATE_ARN}"; fi
if [ -n "${CDK_PARAM_TRAINING_CERTIFICATE_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_TRAINING_CERTIFICATE_ARN}"; fi
if [ -n "${CDK_PARAM_API_CUSTOM_DOMAIN_CERTIFICATE_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_API_CUSTOM_DOMAIN_CERTIFICATE_ARN}"; fi
if [ -n "${CDK_PARAM_ASSET_DOWNLOAD_CUSTOM_DOMAIN_CERTIFICATE_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_ASSET_DOWNLOAD_CUSTOM_DOMAIN_CERTIFICATE_ARN}"; fi
if [ -n "${CDK_PARAM_PUBLIC_API_KEY_VALUE:-}" ]; then echo "::add-mask::${CDK_PARAM_PUBLIC_API_KEY_VALUE}"; fi
if [ -n "${CDK_PARAM_TURNSTILE_SECRET_KEY:-}" ]; then echo "::add-mask::${CDK_PARAM_TURNSTILE_SECRET_KEY}"; fi
if [ -n "${CDK_PARAM_STRIPE_SECRET_KEY:-}" ]; then echo "::add-mask::${CDK_PARAM_STRIPE_SECRET_KEY}"; fi
if [ -n "${CDK_PARAM_STAGING_STRIPE_SECRET_KEY:-}" ]; then echo "::add-mask::${CDK_PARAM_STAGING_STRIPE_SECRET_KEY}"; fi
if [ -n "${CDK_PARAM_MAILCHIMP_API_SECRET_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_MAILCHIMP_API_SECRET_ARN}"; fi
if [ -n "${CDK_PARAM_MAILCHIMP_WEBHOOK_SECRET:-}" ]; then echo "::add-mask::${CDK_PARAM_MAILCHIMP_WEBHOOK_SECRET}"; fi
if [ -n "${CDK_PARAM_META_APP_SECRET:-}" ]; then echo "::add-mask::${CDK_PARAM_META_APP_SECRET}"; fi
if [ -n "${CDK_PARAM_WHATSAPP_WEBHOOK_VERIFY_TOKEN:-}" ]; then echo "::add-mask::${CDK_PARAM_WHATSAPP_WEBHOOK_VERIFY_TOKEN}"; fi
if [ -n "${CDK_PARAM_META_PAGE_ACCESS_TOKEN:-}" ]; then echo "::add-mask::${CDK_PARAM_META_PAGE_ACCESS_TOKEN}"; fi
if [ -n "${CDK_PARAM_EVENTBRITE_TOKEN_SECRET_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_EVENTBRITE_TOKEN_SECRET_ARN}"; fi
if [ -n "${CDK_PARAM_OPENROUTER_API_KEY:-}" ]; then echo "::add-mask::${CDK_PARAM_OPENROUTER_API_KEY}"; fi
if [ -n "${CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS:-}" ]; then echo "::add-mask::${CDK_PARAM_INBOUND_INVOICE_ALLOWED_SENDER_PATTERNS}"; fi
if [ -n "${CDK_PARAM_ADMIN_BOOTSTRAP_TEMP_PASSWORD:-}" ]; then echo "::add-mask::${CDK_PARAM_ADMIN_BOOTSTRAP_TEMP_PASSWORD}"; fi
if [ -n "${CDK_PARAM_ASSET_DOWNLOAD_CLOUDFRONT_PUBLIC_KEY_PEM:-}" ]; then echo "::add-mask::${CDK_PARAM_ASSET_DOWNLOAD_CLOUDFRONT_PUBLIC_KEY_PEM}"; fi
if [ -n "${CDK_PARAM_ASSET_DOWNLOAD_CLOUDFRONT_PRIVATE_KEY_SECRET_ARN:-}" ]; then echo "::add-mask::${CDK_PARAM_ASSET_DOWNLOAD_CLOUDFRONT_PRIVATE_KEY_SECRET_ARN}"; fi
if [ -n "${CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY:-}" ]; then echo "::add-mask::${CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY}"; fi
if [ -n "${CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY_PREVIOUS:-}" ]; then echo "::add-mask::${CDK_PARAM_PUBLIC_WWW_EDGE_VERIFY_PREVIOUS}"; fi
if [ -n "${CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY:-}" ]; then echo "::add-mask::${CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY}"; fi
if [ -n "${CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY_PREVIOUS:-}" ]; then echo "::add-mask::${CDK_PARAM_PUBLIC_WWW_STAGING_EDGE_VERIFY_PREVIOUS}"; fi
cd backend/infrastructure
if [ "$mode" = "diff" ]; then
  npm run build --if-present
  : > "${RUNNER_TEMP:?}/cdk-args"
  {
    echo "run=true"
    echo "stacks=${CDK_STACKS:-}"
  } >> "${GITHUB_OUTPUT:?}"
  exit 0
fi
npm run build --if-present

# Labels live in cdk-plan.json. The deploy step sends the label.
# This expansion is only for the timezone check and the edge-verify report.
CDK_STACKS="$(python3 - <<'PY'
import json
import os
from pathlib import Path

plan = json.loads(Path("cdk-plan.json").read_text(encoding="utf-8"))
raw = os.environ.get("CDK_STACKS", "").strip()
aliases = plan.get("aliases") or {}
chosen = aliases[raw] if raw in aliases else raw.split()
print(" ".join(chosen))
PY
)"

PARAM_ARGS=()

resolve_param_file() {
  local path="$1"
  if [ -z "$path" ]; then
    return 1
  fi
  if [ -f "$path" ]; then
    echo "$path"
    return 0
  fi
            if [ -n "${GITHUB_WORKSPACE:-}" ] && [ -f "$GITHUB_WORKSPACE/$path" ]; then
    echo "$GITHUB_WORKSPACE/$path"
    return 0
  fi
  return 1
}

if [ -n "${CDK_PARAM_FILE:-}" ]; then
  RESOLVED_PARAM_FILE=$(resolve_param_file "$CDK_PARAM_FILE" || true)
  if [ -z "$RESOLVED_PARAM_FILE" ]; then
    echo "::error::CDK_PARAM_FILE was not found"
    exit 1
  fi
  PARAM_ARGS_FILE="$(mktemp)"
  PARAM_FILE="$RESOLVED_PARAM_FILE" STACKS="$CDK_STACKS" python3 - <<'PY' > "$PARAM_ARGS_FILE"
import json
import os
import sys
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

with open(os.environ["PARAM_FILE"], "r", encoding="utf-8") as handle:
    params = json.load(handle)

stack_set = set(os.environ.get("STACKS", "").split())
backend_stack = "evolvesprouts"
admin_web_stack = "evolvesprouts-admin-web"
public_stack = "evolvesprouts-public-www"
training_stack = "evolvesprouts-training"
admin_web_params = {"AdminWebDomainName", "AdminWebCertificateArn", "WafWebAclArn"}
public_params = {
    "PublicWwwDomainName",
    "PublicWwwCertificateArn",
    "PublicWwwStagingDomainName",
    "PublicWwwStagingCertificateArn",
    "PublicWwwApiBaseUrl",
    "PublicWwwMediaRequestApiBaseUrl",
    "PublicWwwEdgeVerifySecret",
    "PublicWwwEdgeVerifySecretPrevious",
    "PublicWwwStagingEdgeVerifySecret",
    "PublicWwwStagingEdgeVerifySecretPrevious",
    "WafWebAclArn",
}
# Omitted parameters keep their previous stack value. Edge-verify
# keys are passed even when empty so clearing the GitHub secret
# disables the origin lock. Siutindei omits them, and an empty
# deploy there cannot turn the lock off.
pass_empty_params = {
    "WafWebAclArn",
    "PublicWwwEdgeVerifySecret",
    "PublicWwwEdgeVerifySecretPrevious",
    "PublicWwwStagingEdgeVerifySecret",
    "PublicWwwStagingEdgeVerifySecretPrevious",
}
training_params = {
    "TrainingDomainName",
    "TrainingCertificateArn",
    "TrainingApiBaseUrl",
    "TrainingMediaRequestApiBaseUrl",
    "WafWebAclArn",
}
backend_cors_domain_params = {
    "PublicWwwDomainName",
    "PublicWwwStagingDomainName",
    "AdminWebDomainName",
    "TrainingDomainName",
}

def resolve_value(raw: str) -> str:
    """Replace <FROM_GITHUB_SECRET: X> / <FROM_GITHUB_VAR: X> placeholders."""
    raw = raw.strip()
    if raw.startswith("<FROM_GITHUB_SECRET:") and raw.endswith(">"):
        env_name = raw[len("<FROM_GITHUB_SECRET:") : -1].strip()
        return os.environ.get(env_name, "")
    if raw.startswith("<FROM_GITHUB_VAR:") and raw.endswith(">"):
        env_name = raw[len("<FROM_GITHUB_VAR:") : -1].strip()
        return os.environ.get(env_name, "")
    return raw

iana_timezone_params = {
    "InvoiceDisplayTimezone",
    "EventbriteDefaultTimezone",
    "SalesRecapDisplayTimezone",
}

def is_eventbrite_timezone(zone_id: str) -> bool:
    """Match _is_eventbrite_timezone in eventbrite_sync.py."""
    if zone_id != "UTC" and (
        zone_id.startswith("Etc/") or "/" not in zone_id
    ):
        return False
    try:
        ZoneInfo(zone_id)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True

def require_iana_timezone(key: str, value: str) -> None:
    """Fail a backend deploy when a set timezone is not usable.

    Public website, admin web, and training deploys skip this.
    Those stacks do not receive the timezone parameters, and a
    stale GitHub value must not block them.
    """
    if backend_stack not in stack_set:
        return
    if key not in iana_timezone_params or not value:
        return
    if key == "EventbriteDefaultTimezone":
        if is_eventbrite_timezone(value):
            return
        raise SystemExit(
            f"{key} value {value!r} must be UTC or a Region/City IANA id"
        )
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise SystemExit(
            f"{key} value {value!r} is not a valid IANA timezone"
        ) from exc

for key, value in params.items():
    value_str = ""
    if value is not None:
        value_str = resolve_value(str(value))
    require_iana_timezone(key, value_str)
    if key not in pass_empty_params and not value_str:
        continue

    targets = []
    if key in admin_web_params:
        targets.append(admin_web_stack)
    if key in public_params:
        targets.append(public_stack)
    if key in training_params:
        targets.append(training_stack)
    if key in backend_cors_domain_params:
        targets.append(backend_stack)
    if not targets:
        targets.append(backend_stack)

    for target in targets:
        if target not in stack_set:
            continue
        # Emit NUL-delimited tokens so multiline values (e.g. PEM keys)
        # are preserved as single CLI arguments.
        sys.stdout.buffer.write(b"--parameters\0")
        sys.stdout.buffer.write(
            f"{target}:{key}={value_str}".encode("utf-8") + b"\0"
        )
PY
  rm -f "$PARAM_ARGS_FILE"
fi

echo "stacks=${CDK_STACKS:-}" >> "$GITHUB_OUTPUT"
# The app reads CDK_BOOTSTRAP_QUALIFIER. Diff and deploy both use
# the committed plan. cdk deploy does not take --qualifier.
echo "run=true" >> "${GITHUB_OUTPUT:?}"
