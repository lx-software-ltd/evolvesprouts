#!/usr/bin/env bash
# Write the staging deploy or smoke summary. The first argument is smoke or staging.
set -euo pipefail
kind="${1:-staging}"
{
  if [ "$kind" = "smoke" ]; then
    echo '## Public Website staging smoke test'
    echo ''
    echo "- Target URL: \`${SUMMARY_TARGET_URL:-}\`"
    echo "- Trigger: \`workflow_dispatch\`"
    echo "- Scope: \`${SUMMARY_SCOPE:-}\`"
    if [ -n "${SUMMARY_MAX_PAGES:-}" ]; then
      echo "- Max pages: \`${SUMMARY_MAX_PAGES}\`"
    fi
  else
    echo '## Public Website staging deploy'
    echo ''
    echo "- Stack: \`${PUBLIC_WWW_STACK_NAME:-}\`"
    echo '- Target environment: `staging`'
    echo "- Release ID: \`${GITHUB_SHA:-}\`"
    echo "- Staging URL: \`${STAGING_SITE_ORIGIN:-}\`"
  fi
} >> "${GITHUB_STEP_SUMMARY:?}"
