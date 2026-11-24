#!/usr/bin/env bash
# Resolve the release id for a public website promotion.
set -euo pipefail
RESOLVED_PROMOTION_MODE="${PROMOTION_MODE:-latest_staging}"

if [ "$RESOLVED_PROMOTION_MODE" = "maintenance_on" ]; then
  echo "release_id=" >> "$GITHUB_OUTPUT"
  echo "maintenance_mode=true" >> "$GITHUB_OUTPUT"
  echo "promotion_mode=$RESOLVED_PROMOTION_MODE" >> "$GITHUB_OUTPUT"
  echo "deploy=false" >> "$GITHUB_OUTPUT"
  echo "skip=false" >> "$GITHUB_OUTPUT"
  echo "build_sha=" >> "$GITHUB_OUTPUT"
  exit 0
elif [ "$RESOLVED_PROMOTION_MODE" = "release_id" ]; then
  if [ -z "${INPUT_RELEASE_ID:-}" ]; then
    echo 'release_id is required when promotion_mode=release_id'
    exit 1
  fi
  SELECTED_RELEASE_ID="$INPUT_RELEASE_ID"
elif [ "$RESOLVED_PROMOTION_MODE" = "latest_staging" ]; then
  STAGING_BUCKET="$(
    STACK_JSON="${STACK_JSON:-}" python3 -c 'import json,os; print(json.loads(os.environ["STACK_JSON"])["PublicWwwStagingBucketName"])'
  )"
  if [ -z "$STAGING_BUCKET" ]; then
    echo 'Staging bucket output not found on Public Website stack'
    exit 1
  fi

  MARKER_FILE="$(mktemp)"
  aws s3 cp \
    "s3://$STAGING_BUCKET/releases/latest-release-id.txt" \
    "$MARKER_FILE"
  SELECTED_RELEASE_ID="$(tr -d '\r\n' < "$MARKER_FILE")"
  rm -f "$MARKER_FILE"

  if [ -z "$SELECTED_RELEASE_ID" ]; then
    echo 'Latest staging release marker is empty'
    exit 1
  fi
else
  echo "Unsupported promotion_mode: $RESOLVED_PROMOTION_MODE"
  exit 1
fi

echo "release_id=$SELECTED_RELEASE_ID" >> "$GITHUB_OUTPUT"
echo "maintenance_mode=false" >> "$GITHUB_OUTPUT"
echo "promotion_mode=$RESOLVED_PROMOTION_MODE" >> "$GITHUB_OUTPUT"
echo "deploy=true" >> "$GITHUB_OUTPUT"
echo "skip=false" >> "$GITHUB_OUTPUT"
echo "build_sha=" >> "$GITHUB_OUTPUT"
