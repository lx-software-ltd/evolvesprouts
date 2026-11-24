#!/usr/bin/env bash
# Run Flutter tests for every app that has a pubspec.
set -euo pipefail
shopt -s globstar nullglob
for spec in apps/*/pubspec.yaml; do
  dir="$(dirname "$spec")"
  test_files=("$dir"/test/**/*_test.dart)
  if [ "${#test_files[@]}" -eq 0 ]; then
    echo "ERROR: $dir has a pubspec.yaml but no test/**/*_test.dart files"
    exit 1
  fi
  echo "Testing Flutter in $dir"
  (cd "$dir" && flutter pub get && flutter test)
done
