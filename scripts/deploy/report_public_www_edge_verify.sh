#!/usr/bin/env bash
# Print the public website origin-lock outputs after a successful deploy.
# Warn when the staging lock was enforcing and this deploy left it off.
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

Staging \`true\` means the origin lock is enforcing. Production \`true\` means a secret is stored. Production functions do not compare the header.
EOF
fi

if [ "$before_staging" = "true" ] && [ "$after_staging" != "true" ]; then
  echo "::warning title=Staging origin lock turned off::PublicWwwStagingEdgeVerifyEnabled went from true to ${after_staging}. The deploy sent empty staging edge-verify secrets, or those secrets were cleared."
  if [ -n "$summary" ]; then
    printf '\n**Warning:** the staging origin lock turned off (`%s` -> `%s`).\n' \
      "$before_staging" "$after_staging" >> "$summary"
  fi
fi
