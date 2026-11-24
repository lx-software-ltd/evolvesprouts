#!/usr/bin/env bash
# Public website checks. pre-build checks the env contract. post-build checks the calendar.
set -euo pipefail
phase="${1:?pre-build or post-build}"
case "$phase" in
  pre-build)
    npm run assert:build-env-contract --prefix apps/public_www
    ;;
  post-build)
    (cd apps/public_www && node ./scripts/validate-landing-pages-calendar.mjs)
    ;;
  *)
    echo "public-www-checks.sh expects pre-build or post-build" >&2
    exit 1
    ;;
esac
