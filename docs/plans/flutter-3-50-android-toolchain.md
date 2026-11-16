# Plan: Meet the Flutter 3.50 Android toolchain floor

**Status**: Done
**Zone**: yellow

## Goal

Make Deploy Mobile App able to build a release app bundle on Flutter stable 3.50. Raise the Android Gradle Plugin, Kotlin Gradle Plugin, and Gradle wrapper to the versions Flutter 3.50 generates, and keep the legacy Android DSL and the separate Kotlin plugin so the existing signing script and Flutter plugins still configure.

## Non-goals

- Do not change `.github/workflows/deploy-mobile.yml`. It already selects Java 17, which Gradle 9.5 and Android Gradle Plugin 9.3 accept.
- Do not switch the app to AGP built-in Kotlin or the AGP 9 DSL.
- Do not change the Play Integrity dependency, application id, or signing script behavior.

## Files

- `apps/evolvesprouts_app/android/gradle/wrapper/gradle-wrapper.properties`: Gradle 9.5.0.
- `apps/evolvesprouts_app/android/settings.gradle.kts`: Android Gradle Plugin 9.3.1 and Kotlin Gradle Plugin 2.4.20.
- `apps/evolvesprouts_app/android/gradle.properties`: set `android.newDsl=false` and `android.builtInKotlin=false`.
- `apps/evolvesprouts_app/android/app/build.gradle.kts`: set the Kotlin JVM target through `kotlin.compilerOptions`.
- `apps/evolvesprouts_app/test/android_toolchain_test.dart`: lock those versions.

## Invariants this change preserves

- Release signing still comes from `signing.gradle` and the same environment variables.
- The app module still applies the Kotlin Android plugin and compiles `MainActivity` for Java 17.
- `applicationId` stays `com.evolvesprouts`.

## Done when

- `flutter test test/android_toolchain_test.dart` passes.
- `flutter build appbundle --release` gets past Flutter's Gradle, AGP, and Kotlin version checks.

## Rollback

Revert the commit. The wrapper returns to Gradle 8.14, which Flutter 3.50 rejects.

## Open questions

None. Flutter 3.50's minimums are Gradle 9.3.1, AGP 9.1.1, and Kotlin 2.4.10. The generated template is Gradle 9.5.0, AGP 9.3.1, and Kotlin 2.4.20, which is the last pair those plugins document as compatible.
