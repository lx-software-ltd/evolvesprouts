# Plan: Retry Maven Central 429s during the Android build

**Status**: Implemented
**Zone**: yellow

## Goal

The Test workflow on `main` (`45418416636`, commit `9ae6ac5eb`) failed in **Build Android**. Gradle could not download `kotlin-gradle-plugins-bom` because `repo.maven.apache.org` returned HTTP 429, then disabled the plugin portal after its default retries (three attempts, one second apart). Flutter retried the whole build 100ms later and hit the same limit.

Give Gradle five attempts with a 5 second starting backoff (5s, 10s, 20s, 40s) so a short shared-egress rate limit can clear before the debug APK job fails.

## Non-goals

- Re-running the failed `main` workflow. The next green Test run is the pull request.
- Changing deploy workflows. They are red, and they already read this `gradle.properties`.
- Mirroring Maven Central or caching the Gradle home. The failure is the retry window, not a missing artifact.

## Files

- `apps/evolvesprouts_app/android/gradle.properties`
- `apps/evolvesprouts_app/test/android_toolchain_test.dart`

## Invariants this change preserves

- Android Gradle Plugin stays on 9.3.1, Kotlin on 2.4.20, and the wrapper on Gradle 9.5.0.
- `android.newDsl=false` and `android.builtInKotlin=false` stay set.
- The app still compiles for JVM 17.

## Done when

- `flutter test test/android_toolchain_test.dart` in `apps/evolvesprouts_app` passes.

## Rollback

Revert the branch. No schema or seed change.

## Open questions

None.
