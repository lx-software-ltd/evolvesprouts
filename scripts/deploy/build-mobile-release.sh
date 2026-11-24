#!/usr/bin/env bash
# Build a mobile release. The Amplify defines file is optional.
set -euo pipefail
kind="${1:?ipa or appbundle}"
cd "${APP_DIRECTORY:?}"
defines=()
if [ -f build/amplify-defines.json ]; then
  defines+=(--dart-define-from-file=build/amplify-defines.json)
fi
common=(
  --dart-define="AMPLIFY_API_KEY=${AMPLIFY_API_KEY:-}"
  --dart-define="FIREBASE_API_KEY=${FIREBASE_API_KEY:-}"
  --dart-define="FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-}"
  --dart-define="FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID:-}"
  --dart-define="FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET:-}"
  --dart-define="FIREBASE_APP_CHECK_DEBUG=${FIREBASE_APP_CHECK_DEBUG:-}"
)
case "$kind" in
  ipa)
    flutter build ipa --release --export-options-plist=ios/ExportOptions.plist \
      "${defines[@]}" "${common[@]}" \
      --dart-define="FIREBASE_IOS_APP_ID=${FIREBASE_IOS_APP_ID:-}" \
      --dart-define="FIREBASE_IOS_BUNDLE_ID=${FIREBASE_IOS_BUNDLE_ID:-}"
    ;;
  appbundle)
    flutter build appbundle --release \
      "${defines[@]}" "${common[@]}" \
      --dart-define="FIREBASE_ANDROID_APP_ID=${FIREBASE_ANDROID_APP_ID:-}"
    ;;
  *)
    echo "build-mobile-release.sh expects ipa or appbundle" >&2
    exit 1
    ;;
esac
