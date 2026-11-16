# Plan: Run the mobile deploy on Java 21

**Status**: Done
**Zone**: red

## Goal

Make Deploy Mobile App finish `bundleRelease` on Flutter 3.50. Run Gradle and Android lint on Java 21. Leave the app's compile target at Java 17.

## Non-goals

- Do not change the Gradle, Android Gradle Plugin, or Kotlin versions.
- Do not change Play upload, signing secrets, or the path filters that start this workflow.
- Do not switch the app to built-in Kotlin.

## Files

- `.github/workflows/deploy-mobile.yml`: select Temurin 21 and point Flutter at that JDK.
- `docs/plans/flutter-3-50-android-toolchain.md`: record that the earlier Java 17 choice failed lint.

## Invariants this change preserves

- `compileOptions` and the Kotlin JVM target stay at 17.
- Signing, Play upload, and the deploy script step stay as they are.
- The workflow still runs on `ubuntu-24.04`.

## Done when

The workflow selects `java-version: "21"` and `flutter config --jdk-dir "$JAVA_HOME"` still follows that JDK. A release bundle already built on Java 21 locally. This merge does not start Deploy Mobile App, because the workflow path filters do not include `.github/workflows/deploy-mobile.yml`.

## Rollback

Revert the commit. The workflow returns to Java 17, and Android lint fails again on `List.removeLast()`.

## Open questions

None.
