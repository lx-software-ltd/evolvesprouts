import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Android toolchain matches the Flutter 3.50 template', () {
    final wrapper = _readAndroidFile(
      'gradle/wrapper/gradle-wrapper.properties',
    );
    expect(wrapper, contains('gradle-9.5.0-all.zip'));

    final settings = _readAndroidFile('settings.gradle.kts');
    expect(
      settings,
      contains('id("com.android.application") version "9.3.1" apply false'),
    );
    expect(
      settings,
      contains(
        'id("org.jetbrains.kotlin.android") version "2.4.20" apply false',
      ),
    );

    final properties = _readAndroidFile('gradle.properties');
    expect(properties, contains('android.newDsl=false'));
    expect(properties, contains('android.builtInKotlin=false'));
    expect(
      properties,
      contains('systemProp.org.gradle.internal.repository.max.tentatives=5'),
    );
    expect(
      properties,
      contains(
        'systemProp.org.gradle.internal.repository.initial.backoff=5000',
      ),
    );

    final appBuild = _readAndroidFile('app/build.gradle.kts');
    expect(
      appBuild,
      contains('jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17'),
    );
    expect(appBuild, isNot(contains('kotlinOptions')));
  });
}

String _readAndroidFile(String relativePath) {
  final candidates = [
    File('android/$relativePath'),
    File('apps/evolvesprouts_app/android/$relativePath'),
  ];
  for (final candidate in candidates) {
    if (candidate.existsSync()) {
      return candidate.readAsStringSync();
    }
  }
  fail('Missing android/$relativePath from ${Directory.current.path}');
}
