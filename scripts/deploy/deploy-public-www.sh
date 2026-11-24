#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$ROOT_DIR/apps/public_www"
BUILD_DIR="$APP_DIR/out"
MAINTENANCE_DIR="$APP_DIR/maintenance"
STACK_NAME="${PUBLIC_WWW_STACK_NAME:-evolvesprouts-public-www}"
SOURCE_STACK_NAME="${PUBLIC_WWW_SOURCE_STACK_NAME:-$STACK_NAME}"
DEPLOY_ENVIRONMENT="${PUBLIC_WWW_ENVIRONMENT:-production}"
RELEASE_ID="${PUBLIC_WWW_RELEASE_ID:-}"
PROMOTE_RELEASE_ID="${PUBLIC_WWW_PROMOTE_RELEASE_ID:-}"
MAINTENANCE_MODE="${PUBLIC_WWW_MAINTENANCE_MODE:-false}"
ASSET_CACHE_CONTROL="public, max-age=31536000, immutable"
DOCUMENT_CACHE_CONTROL="public, max-age=300, must-revalidate"
NO_STORE_CACHE_CONTROL="no-store, max-age=0"

if [ "$MAINTENANCE_MODE" != "true" ] && [ "$MAINTENANCE_MODE" != "false" ]; then
  echo "Unsupported PUBLIC_WWW_MAINTENANCE_MODE: '$MAINTENANCE_MODE'"
  echo "Allowed values: true, false"
  exit 1
fi

if [ -n "$PROMOTE_RELEASE_ID" ] && [ "$MAINTENANCE_MODE" = "true" ]; then
  echo "PUBLIC_WWW_PROMOTE_RELEASE_ID and PUBLIC_WWW_MAINTENANCE_MODE=true are mutually exclusive"
  exit 1
fi

if [ -n "$RELEASE_ID" ] && [ "$MAINTENANCE_MODE" = "true" ]; then
  echo "PUBLIC_WWW_RELEASE_ID cannot be used with PUBLIC_WWW_MAINTENANCE_MODE=true"
  exit 1
fi

function require_stack_output() {
  local stack_name="$1"
  local output_key="$2"
  local query value

  query="Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue"
  value="$(aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "$query" \
    --output text)"

  if [ -z "$value" ] || [ "$value" = "None" ]; then
    echo "Output '$output_key' not found for stack '$stack_name'"
    exit 1
  fi

  echo "$value"
}

function get_environment_outputs() {
  local environment_name="$1"
  if [ "$environment_name" = "production" ]; then
    echo "PublicWwwBucketName PublicWwwDistributionId"
    return
  fi
  if [ "$environment_name" = "staging" ]; then
    echo "PublicWwwStagingBucketName PublicWwwStagingDistributionId"
    return
  fi

  echo "Unsupported PUBLIC_WWW_ENVIRONMENT: '$environment_name'"
  echo "Allowed values: production, staging"
  exit 1
}

function validate_release_id() {
  local release_id="$1"
  if [[ ! "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
    echo "Invalid release ID: '$release_id'"
    echo "Allowed: letters, numbers, dot, dash, underscore (max 128 chars)."
    exit 1
  fi
}

function assert_wildcard_invalidation_limit() {
  local max_wildcard_paths=15
  local wildcard_count=0
  local invalidation_path

  for invalidation_path in "$@"; do
    if [[ "$invalidation_path" == *"*"* ]]; then
      wildcard_count=$((wildcard_count + 1))
    fi
  done

  if [ "$wildcard_count" -gt "$max_wildcard_paths" ]; then
    echo "CloudFront allows at most $max_wildcard_paths wildcard invalidation paths in progress."
    echo "Configured invalidation request has $wildcard_count wildcard paths."
    return 1
  fi
}

function validate_maintenance_contact_settings() {
  if [ -z "${NEXT_PUBLIC_EMAIL:-}" ]; then
    echo "NEXT_PUBLIC_EMAIL is required for maintenance mode deployment."
    exit 1
  fi
  if [ -z "${NEXT_PUBLIC_WHATSAPP_URL:-}" ]; then
    echo "NEXT_PUBLIC_WHATSAPP_URL is required for maintenance mode deployment."
    exit 1
  fi
  if [ -z "${NEXT_PUBLIC_INSTAGRAM_URL:-}" ]; then
    echo "NEXT_PUBLIC_INSTAGRAM_URL is required for maintenance mode deployment."
    exit 1
  fi

  if [[ ! "$NEXT_PUBLIC_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
    echo "NEXT_PUBLIC_EMAIL must be a valid email address."
    exit 1
  fi
  if [[ ! "$NEXT_PUBLIC_WHATSAPP_URL" =~ ^https?:// ]]; then
    echo "NEXT_PUBLIC_WHATSAPP_URL must start with http:// or https://."
    exit 1
  fi
  if [[ ! "$NEXT_PUBLIC_INSTAGRAM_URL" =~ ^https?:// ]]; then
    echo "NEXT_PUBLIC_INSTAGRAM_URL must start with http:// or https://."
    exit 1
  fi
}

function escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'
}

function inject_maintenance_contact_values() {
  local html_path="$1"
  local escaped_email
  local escaped_whatsapp_url
  local escaped_instagram_url

  if [ ! -f "$html_path" ]; then
    echo "Maintenance HTML file not found for contact injection: $html_path"
    exit 1
  fi

  escaped_email="$(escape_sed_replacement "$NEXT_PUBLIC_EMAIL")"
  escaped_whatsapp_url="$(escape_sed_replacement "$NEXT_PUBLIC_WHATSAPP_URL")"
  escaped_instagram_url="$(escape_sed_replacement "$NEXT_PUBLIC_INSTAGRAM_URL")"

  sed -i \
    -e "s|__NEXT_PUBLIC_EMAIL__|$escaped_email|g" \
    -e "s|__NEXT_PUBLIC_WHATSAPP_URL__|$escaped_whatsapp_url|g" \
    -e "s|__NEXT_PUBLIC_INSTAGRAM_URL__|$escaped_instagram_url|g" \
    "$html_path"
}

function invalidate_distribution() {
  local distribution_id="$1"
  local invalidation_scope="${2:-site}"
  if [ -n "$distribution_id" ] && [ "$distribution_id" != "None" ]; then
    local -a invalidation_paths
    if [ "$invalidation_scope" = "full" ]; then
      invalidation_paths=(
        "/*"
      )
    else
      invalidation_paths=(
        "/"
        "/index.html"
        "/404.html"
        "/404/index.html"
        "/_not-found/index.html"
        "/_next/static/*"
        "/en*"
        "/zh-CN*"
        "/zh-HK*"
        "/about*"
        "/book*"
        "/contact*"
        "/events*"
        "/media*"
        "/newsletter*"
        "/privacy*"
        "/resources*"
        "/services*"
        "/training-courses*"
        "/robots.txt"
        "/sitemap.xml"
      )
    fi
    assert_wildcard_invalidation_limit "${invalidation_paths[@]}" || return 1
    local max_attempts=5
    local retry_delay_seconds=20
    local attempt=1

    echo "Invalidating CloudFront distribution $distribution_id"
    while [ "$attempt" -le "$max_attempts" ]; do
      local invalidation_output
      invalidation_output="$(mktemp)"
      if aws cloudfront create-invalidation \
        --distribution-id "$distribution_id" \
        --paths "${invalidation_paths[@]}" \
        >"$invalidation_output" 2>&1; then
        cat "$invalidation_output"
        rm -f "$invalidation_output"
        return
      fi

      local invalidation_error
      invalidation_error="$(<"$invalidation_output")"
      rm -f "$invalidation_output"

      if [[ "$invalidation_error" == *"TooManyInvalidationsInProgress"* ]] && \
        [ "$attempt" -lt "$max_attempts" ]; then
        echo "CloudFront invalidation queue is full (attempt $attempt/$max_attempts)."
        echo "Retrying in ${retry_delay_seconds}s..."
        sleep "$retry_delay_seconds"
        attempt=$((attempt + 1))
        continue
      fi

      echo "$invalidation_error"
      return 1
    done

    echo "CloudFront invalidation failed after $max_attempts attempts."
    return 1
  fi
}

function prepare_maintenance_build_dir() {
  validate_maintenance_contact_settings

  if [ ! -d "$MAINTENANCE_DIR" ]; then
    echo "Maintenance source not found at $MAINTENANCE_DIR"
    exit 1
  fi

  if [ ! -f "$APP_DIR/public/images/evolvesprouts-logo.svg" ]; then
    echo "Logo source not found at $APP_DIR/public/images/evolvesprouts-logo.svg"
    exit 1
  fi

  if [ ! -f "$APP_DIR/public/images/contact-email.svg" ]; then
    echo "Contact email icon source not found at $APP_DIR/public/images/contact-email.svg"
    exit 1
  fi

  if [ ! -f "$APP_DIR/public/favicon.ico" ]; then
    echo "Favicon source not found at $APP_DIR/public/favicon.ico"
    exit 1
  fi

  local maintenance_build_dir
  maintenance_build_dir="$(mktemp -d)"
  cp -a "$MAINTENANCE_DIR/." "$maintenance_build_dir/"
  mkdir -p "$maintenance_build_dir/images"
  cp \
    "$APP_DIR/public/images/evolvesprouts-logo.svg" \
    "$maintenance_build_dir/images/evolvesprouts-logo.svg"
  cp \
    "$APP_DIR/public/images/contact-email.svg" \
    "$maintenance_build_dir/images/contact-email.svg"
  cp \
    "$APP_DIR/public/favicon.ico" \
    "$maintenance_build_dir/favicon.ico"
  inject_maintenance_contact_values "$maintenance_build_dir/index.html"
  cp "$maintenance_build_dir/index.html" "$maintenance_build_dir/404.html"

  echo "$maintenance_build_dir"
}

function optimize_images_for_deploy() {
  local optimize_flag="${PUBLIC_WWW_OPTIMIZE_IMAGES:-true}"
  if [ "$optimize_flag" != "true" ]; then
    echo "Skipping image optimization (PUBLIC_WWW_OPTIMIZE_IMAGES=$optimize_flag)"
    return
  fi

  if [ ! -f "$APP_DIR/package.json" ]; then
    echo "Skipping image optimization (package.json not found at $APP_DIR)"
    return
  fi

  echo "Optimizing images before deployment sync"
  (
    cd "$APP_DIR"
    npm run images:optimize
  )

  if [ -d "$APP_DIR/public" ]; then
    echo "Refreshing exported static assets from public/"
    cp -a "$APP_DIR/public/." "$BUILD_DIR/"
  fi
}

function sync_site_artifacts() {
  local source_dir="$1"
  local destination_uri="$2"

  if [ -d "$source_dir/_next/static" ]; then
    aws s3 sync \
      "$source_dir/_next/static" \
      "$destination_uri/_next/static" \
      --cache-control "$ASSET_CACHE_CONTROL"
  fi

  aws s3 sync \
    "$source_dir" \
    "$destination_uri" \
    --exclude "_next/static/*" \
    --exclude "releases/*" \
    --exclude "landing-pages-manifest.json" \
    --cache-control "$DOCUMENT_CACHE_CONTROL" \
    --delete
}

function sync_release_artifacts() {
  local source_uri="$1"
  local destination_uri="$2"

  if aws s3 ls "$source_uri/_next/static/" >/dev/null 2>&1; then
    aws s3 sync \
      "$source_uri/_next/static" \
      "$destination_uri/_next/static" \
      --cache-control "$ASSET_CACHE_CONTROL"
  fi

  aws s3 sync \
    "$source_uri" \
    "$destination_uri" \
    --exclude "_next/static/*" \
    --exclude "releases/*" \
    --exclude "landing-pages-manifest.json" \
    --cache-control "$DOCUMENT_CACHE_CONTROL" \
    --delete
}

function sync_maintenance_artifacts() {
  local source_dir="$1"
  local destination_uri="$2"

  aws s3 sync \
    "$source_dir" \
    "$destination_uri" \
    --exclude "releases/*" \
    --cache-control "$NO_STORE_CACHE_CONTROL" \
    --delete
}

function enforce_staging_robots_txt() {
  local bucket_name="$1"
  local robots_file

  robots_file="$(mktemp)"
  cat > "$robots_file" <<EOF
User-agent: *
Disallow: /
EOF

  aws s3 cp \
    "$robots_file" \
    "s3://$bucket_name/robots.txt" \
    --content-type "text/plain; charset=utf-8" \
    --cache-control "$NO_STORE_CACHE_CONTROL"

  rm -f "$robots_file"
}

function get_www_allowlist_function_logical_prefix() {
  local environment_name="$1"

  if [ "$environment_name" = "production" ]; then
    echo "PublicWwwWwwProxyAllowlistFunction"
    return
  fi

  if [ "$environment_name" = "staging" ]; then
    echo "PublicWwwStagingWwwProxyAllowlistFunction"
    return
  fi

  echo "Unsupported PUBLIC_WWW_ENVIRONMENT: '$environment_name'"
  echo "Allowed values: production, staging"
  exit 1
}

function resolve_www_allowlist_function_arn() {
  local stack_name="$1"
  local environment_name="$2"
  local logical_prefix function_resource_id function_name

  logical_prefix="$(get_www_allowlist_function_logical_prefix "$environment_name")"
  function_resource_id="$(aws cloudformation list-stack-resources \
    --stack-name "$stack_name" \
    --query "StackResourceSummaries[?ResourceType=='AWS::CloudFront::Function' && starts_with(LogicalResourceId, '$logical_prefix')].PhysicalResourceId | [0]" \
    --output text)"

  if [ -z "$function_resource_id" ] || [ "$function_resource_id" = "None" ]; then
    echo "Could not resolve CloudFront allowlist function for prefix '$logical_prefix'" >&2
    exit 1
  fi

  function_name="$function_resource_id"
  if [[ "$function_name" == arn:aws:cloudfront::*:function/* ]]; then
    function_name="${function_name##*/}"
  fi

  if [[ ! "$function_name" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
    echo "Resolved invalid CloudFront function name: '$function_name'" >&2
    echo "Raw stack resource identifier: '$function_resource_id'" >&2
    exit 1
  fi

  local function_arn
  function_arn="$(aws cloudfront describe-function \
    --name "$function_name" \
    --stage LIVE \
    --query "FunctionSummary.FunctionMetadata.FunctionARN" \
    --output text)"

  if [ -z "$function_arn" ] || [ "$function_arn" = "None" ]; then
    echo "Could not resolve LIVE function ARN for '$function_name'" >&2
    exit 1
  fi

  echo "$function_arn"
}

function ensure_maintenance_block_function_arn() {
  local environment_name="$1"
  local function_name function_code_file function_config etag
  function_name="evolvesprouts-public-www-${environment_name}-maintenance-block"
  function_config="Comment=Block /www proxy during website maintenance,Runtime=cloudfront-js-2.0"
  function_code_file="$(mktemp)"

  cat > "$function_code_file" <<'EOF'
function handler(event) {
  return {
    statusCode: 503,
    statusDescription: 'Service Unavailable',
    headers: {
      'content-type': { value: 'application/json; charset=utf-8' },
      'cache-control': { value: 'no-store' },
      'retry-after': { value: '300' }
    },
    body: '{"message":"Service temporarily unavailable due to maintenance"}'
  };
}
EOF

  if aws cloudfront describe-function \
    --name "$function_name" \
    --stage DEVELOPMENT >/dev/null 2>&1; then
    etag="$(aws cloudfront describe-function \
      --name "$function_name" \
      --stage DEVELOPMENT \
      --query "ETag" \
      --output text)"
    aws cloudfront update-function \
      --name "$function_name" \
      --if-match "$etag" \
      --function-config "$function_config" \
      --function-code "fileb://$function_code_file" >/dev/null
  else
    aws cloudfront create-function \
      --name "$function_name" \
      --function-config "$function_config" \
      --function-code "fileb://$function_code_file" >/dev/null
  fi

  rm -f "$function_code_file"

  etag="$(aws cloudfront describe-function \
    --name "$function_name" \
    --stage DEVELOPMENT \
    --query "ETag" \
    --output text)"

  if ! aws cloudfront publish-function \
    --name "$function_name" \
    --if-match "$etag" >/dev/null 2>&1; then
    if ! aws cloudfront describe-function \
      --name "$function_name" \
      --stage LIVE >/dev/null 2>&1; then
      echo "Failed to publish maintenance block function '$function_name'"
      exit 1
    fi
  fi

  aws cloudfront describe-function \
    --name "$function_name" \
    --stage LIVE \
    --query "FunctionSummary.FunctionMetadata.FunctionARN" \
    --output text
}

function get_current_www_function_arn() {
  local distribution_id="$1"
  aws cloudfront get-distribution-config \
    --id "$distribution_id" \
    --query "DistributionConfig.CacheBehaviors.Items[?PathPattern=='www/*'].FunctionAssociations.Items[?EventType=='viewer-request'].FunctionARN | [0][0]" \
    --output text
}

function update_www_function_association() {
  local distribution_id="$1"
  local target_function_arn="$2"
  local distribution_payload_file distribution_config_file distribution_etag

  distribution_payload_file="$(mktemp)"
  distribution_config_file="$(mktemp)"

  aws cloudfront get-distribution-config \
    --id "$distribution_id" \
    > "$distribution_payload_file"

  distribution_etag="$(python3 - "$distribution_payload_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

print(payload["ETag"])
PY
)"

  python3 - "$distribution_payload_file" "$distribution_config_file" "$target_function_arn" <<'PY'
import json
import sys

payload_path = sys.argv[1]
distribution_config_path = sys.argv[2]
target_function_arn = sys.argv[3]

with open(payload_path, encoding="utf-8") as handle:
    payload = json.load(handle)

config = payload["DistributionConfig"]
cache_behaviors = config.get("CacheBehaviors", {})
items = cache_behaviors.get("Items", [])
target_behavior = None

for behavior in items:
    if behavior.get("PathPattern") == "www/*":
        target_behavior = behavior
        break

if target_behavior is None:
    raise SystemExit("CloudFront behavior 'www/*' not found")

function_associations = target_behavior.setdefault("FunctionAssociations", {})
association_items = function_associations.setdefault("Items", [])
if not isinstance(association_items, list):
    association_items = []
    function_associations["Items"] = association_items

replaced = False
for association in association_items:
    if association.get("EventType") == "viewer-request":
        association["FunctionARN"] = target_function_arn
        replaced = True
        break

if not replaced:
    association_items.append(
        {
            "EventType": "viewer-request",
            "FunctionARN": target_function_arn,
        }
    )

function_associations["Quantity"] = len(association_items)

with open(distribution_config_path, "w", encoding="utf-8") as handle:
    json.dump(config, handle)
PY

  aws cloudfront update-distribution \
    --id "$distribution_id" \
    --if-match "$distribution_etag" \
    --distribution-config "file://$distribution_config_file" >/dev/null

  rm -f "$distribution_payload_file" "$distribution_config_file"
}

function apply_www_proxy_mode() {
  local stack_name="$1"
  local distribution_id="$2"
  local environment_name="$3"
  local mode="$4"
  local target_function_arn current_function_arn

  if [ "$mode" = "maintenance" ]; then
    target_function_arn="$(ensure_maintenance_block_function_arn "$environment_name")"
  else
    target_function_arn="$(resolve_www_allowlist_function_arn "$stack_name" "$environment_name")"
  fi

  current_function_arn="$(get_current_www_function_arn "$distribution_id")"

  if [ "$current_function_arn" = "$target_function_arn" ]; then
    echo "CloudFront /www viewer-request function already set for mode '$mode'"
    return
  fi

  echo "Updating CloudFront /www viewer-request function for mode '$mode'"
  update_www_function_association "$distribution_id" "$target_function_arn"
}

if [ "${PUBLIC_WWW_PHASE:-}" = "optimize" ]; then
  optimize_images_for_deploy
  exit 0
fi

if [ -n "$PROMOTE_RELEASE_ID" ]; then
  validate_release_id "$PROMOTE_RELEASE_ID"

  SOURCE_BUCKET_NAME="$(require_stack_output \
    "$SOURCE_STACK_NAME" \
    "PublicWwwStagingBucketName")"
  TARGET_BUCKET_NAME="$(require_stack_output \
    "$STACK_NAME" \
    "PublicWwwBucketName")"
  TARGET_DISTRIBUTION_ID="$(require_stack_output \
    "$STACK_NAME" \
    "PublicWwwDistributionId")"

  KEY_COUNT="$(aws s3api list-objects-v2 \
    --bucket "$SOURCE_BUCKET_NAME" \
    --prefix "releases/$PROMOTE_RELEASE_ID/" \
    --max-keys 1 \
    --query "KeyCount" \
    --output text)"

  if [ "$KEY_COUNT" = "0" ]; then
    echo "Release '$PROMOTE_RELEASE_ID' not found in source stack"
    echo "Expected prefix: s3://$SOURCE_BUCKET_NAME/releases/$PROMOTE_RELEASE_ID/"
    exit 1
  fi

  if [ -n "${PUBLIC_WWW_PROMOTION_BUILD_DIR:-}" ]; then
    PROMOTION_BUILD_DIR="${PUBLIC_WWW_PROMOTION_BUILD_DIR}"
    if [ ! -d "$PROMOTION_BUILD_DIR" ]; then
      echo "Promotion build directory not found: $PROMOTION_BUILD_DIR"
      exit 1
    fi
    BUILD_DIR="$PROMOTION_BUILD_DIR"
    echo "Promoting release '$PROMOTE_RELEASE_ID' to production using local build output"
    optimize_images_for_deploy
    echo "Syncing Public WWW to s3://$TARGET_BUCKET_NAME"
    sync_site_artifacts "$BUILD_DIR" "s3://$TARGET_BUCKET_NAME"
  else
    echo "Promoting release '$PROMOTE_RELEASE_ID' from staging to production (S3 artifact copy)"
    sync_release_artifacts \
      "s3://$SOURCE_BUCKET_NAME/releases/$PROMOTE_RELEASE_ID" \
      "s3://$TARGET_BUCKET_NAME"
  fi

  apply_www_proxy_mode \
    "$STACK_NAME" \
    "$TARGET_DISTRIBUTION_ID" \
    "production" \
    "normal"
  invalidate_distribution "$TARGET_DISTRIBUTION_ID" "full"
  exit 0
fi

read -r TARGET_BUCKET_OUTPUT_KEY TARGET_DISTRIBUTION_OUTPUT_KEY <<< "$(get_environment_outputs "$DEPLOY_ENVIRONMENT")"
TARGET_BUCKET_NAME="$(require_stack_output \
  "$STACK_NAME" \
  "$TARGET_BUCKET_OUTPUT_KEY")"
TARGET_DISTRIBUTION_ID="$(require_stack_output \
  "$STACK_NAME" \
  "$TARGET_DISTRIBUTION_OUTPUT_KEY")"

if [ "$MAINTENANCE_MODE" = "true" ]; then
  MAINTENANCE_BUILD_DIR="$(prepare_maintenance_build_dir)"
  echo "Syncing maintenance website to s3://$TARGET_BUCKET_NAME"
  sync_maintenance_artifacts "$MAINTENANCE_BUILD_DIR" "s3://$TARGET_BUCKET_NAME"
  rm -rf "$MAINTENANCE_BUILD_DIR"

  apply_www_proxy_mode \
    "$STACK_NAME" \
    "$TARGET_DISTRIBUTION_ID" \
    "$DEPLOY_ENVIRONMENT" \
    "maintenance"

  if [ "$DEPLOY_ENVIRONMENT" = "staging" ]; then
    echo "Applying staging robots.txt deny-all policy"
    enforce_staging_robots_txt "$TARGET_BUCKET_NAME"
  fi

  invalidate_distribution "$TARGET_DISTRIBUTION_ID" "full"
  exit 0
fi

UPLOAD="${PUBLIC_WWW_UPLOAD:-script}"
if [ "$UPLOAD" = "external" ]; then
  if [ "$DEPLOY_ENVIRONMENT" != "staging" ]; then
    echo "PUBLIC_WWW_UPLOAD=external is only supported for staging"
    exit 1
  fi
  echo "S3 upload already completed by s3-cloudfront-deploy"
elif [ "$UPLOAD" = "script" ]; then
  if [ ! -d "$BUILD_DIR" ]; then
    echo "Build output not found at $BUILD_DIR"
    echo "Run: (cd apps/public_www && npm run build)"
    exit 1
  fi

  optimize_images_for_deploy

  echo "Syncing Public WWW to s3://$TARGET_BUCKET_NAME"
  sync_site_artifacts "$BUILD_DIR" "s3://$TARGET_BUCKET_NAME"

  if [ -n "$RELEASE_ID" ]; then
    validate_release_id "$RELEASE_ID"
    echo "Saving immutable release at releases/$RELEASE_ID/"
    sync_site_artifacts "$BUILD_DIR" "s3://$TARGET_BUCKET_NAME/releases/$RELEASE_ID"

    if [ "$DEPLOY_ENVIRONMENT" = "staging" ]; then
      echo "Updating staging latest release marker: $RELEASE_ID"
      MARKER_FILE="$(mktemp)"
      printf "%s\n" "$RELEASE_ID" > "$MARKER_FILE"
      aws s3 cp \
        "$MARKER_FILE" \
        "s3://$TARGET_BUCKET_NAME/releases/latest-release-id.txt"
      rm -f "$MARKER_FILE"
    fi
  fi

  if [ "$DEPLOY_ENVIRONMENT" = "staging" ]; then
    echo "Applying staging robots.txt deny-all policy"
    enforce_staging_robots_txt "$TARGET_BUCKET_NAME"
  fi
else
  echo "Unsupported PUBLIC_WWW_UPLOAD: '$UPLOAD'"
  exit 1
fi

apply_www_proxy_mode \
  "$STACK_NAME" \
  "$TARGET_DISTRIBUTION_ID" \
  "$DEPLOY_ENVIRONMENT" \
  "normal"

invalidate_distribution "$TARGET_DISTRIBUTION_ID"
