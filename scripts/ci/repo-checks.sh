#!/usr/bin/env bash
set -euo pipefail
node scripts/check-cdk-admin-api-routes.mjs
node scripts/check-lambda-docs.mjs
