#!/usr/bin/env bash
# Print the public website origin-lock outputs after a successful deploy.
# Warn when either lock was enforcing and this deploy left it off.
# Usage: report_public_www_edge_verify.sh BEFORE_STAGING AFTER_STAGING BEFORE_PRODUCTION AFTER_PRODUCTION
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: report_public_www_edge_verify.sh BEFORE_STAGING AFTER_STAGING BEFORE_PRODUCTION AFTER_PRODUCTION" >&2
  exit 2
fi

before_staging="$1"
after_staging="$2"
before_production="$3"
after_production="$4"

echo "PublicWwwStagingEdgeVerifyEnabled ${before_staging} -> ${after_staging}"
echo "PublicWwwEdgeVerifyEnabled ${before_production} -> ${after_production}"

summary="${GITHUB_STEP_SUMMARY:-}"
if [ -n "$summary" ]; then
  cat >> "$summary" <<EOF
## Public website origin lock

| Output | Before | After |
| --- | --- | --- |
| \`PublicWwwStagingEdgeVerifyEnabled\` | ${before_staging} | ${after_staging} |
| \`PublicWwwEdgeVerifyEnabled\` | ${before_production} | ${after_production} |

\`true\` means that distribution's origin lock is enforcing. Both of its secrets empty leaves it off.
EOF
fi

warn_if_lock_turned_off() {
  local title="$1"
  local output_name="$2"
  local before="$3"
  local after="$4"
  local label
  label="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]')"
  if [ "$before" = "true" ] && [ "$after" != "true" ]; then
    echo "::warning title=${title} origin lock turned off::${output_name} went from true to ${after}. The deploy sent empty ${label} edge-verify secrets, or those secrets were cleared."
    if [ -n "$summary" ]; then
      printf '\n**Warning:** the %s origin lock turned off (`%s` -> `%s`).\n' \
        "$label" "$before" "$after" >> "$summary"
    fi
  fi
}

warn_if_lock_turned_off "Staging" "PublicWwwStagingEdgeVerifyEnabled" \
  "$before_staging" "$after_staging"
warn_if_lock_turned_off "Production" "PublicWwwEdgeVerifyEnabled" \
  "$before_production" "$after_production"
