# Plan: Pass Flutter 3.50 CI

**Status**: Done
**Zone**: yellow

## Goal

Make Lint Dart and Check Flutter lockfiles pass on Flutter stable 3.50.

## Non-goals

- Do not change the placeholder screen.
- Do not add Cupertino widgets.

## Files

- `apps/evolvesprouts_app/pubspec.yaml` and `pubspec.lock`: depend on `material_ui` and refresh transitive pins for the 3.50 SDK.
- `apps/evolvesprouts_app/lib/app.dart`, `lib/main.dart`, and `test/app_test.dart`: import `package:material_ui/material_ui.dart`.

## Invariants this change preserves

- The app still shows the placeholder title "Evolve Sprouts App".
- The widget test still finds one `MaterialApp`.

## Done when

- `flutter analyze` reports no issues.
- `flutter test` passes.
- `flutter pub get` leaves `pubspec.lock` unchanged.

## Rollback

Revert the commit.

## Open questions

None. Flutter 3.50 deprecates `package:flutter/material.dart`. The replacement is `package:material_ui/material_ui.dart`.
