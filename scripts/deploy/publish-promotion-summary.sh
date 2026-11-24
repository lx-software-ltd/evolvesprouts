#!/usr/bin/env bash
# Write the public website promotion summary. Values come from the step env.
set -euo pipefail
if [ "${PROMOTION_MODE:-}" = "maintenance_on" ]; then
  {
    echo '## Public Website maintenance mode enabled'
    echo ''
    echo '- Operation mode: `maintenance_on`'
    echo '- Target environment: `production`'
    echo '- Stack: `evolvesprouts-public-www`'
    echo "- Production URL: \`${PRODUCTION_SITE_ORIGIN}\`"
    echo '- `/www/*` CloudFront proxy: `blocked`'
  } >> "$GITHUB_STEP_SUMMARY"
else
  {
    echo '## Public Website promotion'
    echo ''
    echo "- Promotion mode: \`${PROMOTION_MODE}\`"
    echo "- Release ID: \`${RELEASE_ID}\`"
    echo '- Source environment: `staging` (release id gates promotion eligibility)'
    echo '- Target environment: `production`'
    echo '- Build: fresh static export with **production** GitHub Environment variables (including live Stripe publishable key)'
    echo '- Stack: `evolvesprouts-public-www`'
    echo "- Production URL: \`${PRODUCTION_SITE_ORIGIN}\`"
  } >> "$GITHUB_STEP_SUMMARY"
fi
