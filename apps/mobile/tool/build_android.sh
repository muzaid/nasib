#!/usr/bin/env bash
#
# Build an installable debug APK.
#
#   ./tool/build_android.sh              # demo build, no backend needed
#   ./tool/build_android.sh --release    # unsigned release build
#
# Requires the Flutter SDK and an Android SDK. Everything else — the
# `android/` directory, the Gradle files, the wrapper — is generated here
# rather than checked in, so it always matches the SDK you are building
# with. See tool/patch_android.py for what this project changes in it.
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="debug"
[[ "${1:-}" == "--release" ]] && MODE="release"

command -v flutter >/dev/null || {
  echo "flutter not found. Install the SDK: https://docs.flutter.dev/get-started/install" >&2
  exit 1
}

echo "==> flutter version"
flutter --version

# pubspec.yaml is ours; `flutter create` on an existing project leaves it
# alone, but a backup costs nothing and a clobbered dependency list costs
# half an hour of confusion.
cp pubspec.yaml /tmp/nasib-pubspec.yaml.bak

echo "==> generating the android project"
flutter create --platforms=android --org app --project-name nasib . >/dev/null

cp /tmp/nasib-pubspec.yaml.bak pubspec.yaml

echo "==> applying this project's changes"
python3 tool/patch_android.py

echo "==> resolving packages"
flutter pub get

# Analysis is reported, never fatal: a lint should not stand between you
# and an APK you are trying to install on a phone.
echo "==> analyze (informational)"
flutter analyze --no-fatal-infos --no-fatal-warnings || true

echo "==> building $MODE apk"
flutter build apk "--$MODE"

APK="build/app/outputs/flutter-apk/app-$MODE.apk"
echo
echo "APK: $(cd "$(dirname "$APK")" && pwd)/$(basename "$APK")"
echo "Install it with:  adb install -r $APK"
