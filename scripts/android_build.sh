#!/usr/bin/env bash
# Build a standalone Android APK (no Metro needed). See docs/ANDROID_BUILD_AND_INSTALL.md.
#
#   scripts/android_build.sh dev     development APK (labeled DEV, history off, draft config allowed)
#   scripts/android_build.sh verify  development APK made debuggable for controlled device verification only
#   scripts/android_build.sh pilot   pilot APK — only if `npm run release:gate` passes and the pilot
#                                    signing properties exist OUTSIDE the repository
#
# Signing material lives in ~/.rx-recall-check/ (never in the repository). The development key is
# generated there on first use. The pilot key must be created and kept by the project team on their own
# machine (not in this cloud environment).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-}"
SIGN_DIR="${HOME}/.rx-recall-check"
PROFILE_FILE="$ROOT/mobile/config/build_profile.json"
MARKER="$ROOT/mobile/build/release-gate-passed"
: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
export ANDROID_HOME

write_profile() {
  cat > "$PROFILE_FILE" <<JSON
{
  "\$comment": "Written by the build scripts (npm run android:dev / android:pilot). Committed value: development. A pilot profile is only written after \`npm run release:gate\` passes.",
  "profile": "$1",
  "encryption_verified_on_device": $2
}
JSON
}
restore_profile() { write_profile development false; rm -f "$MARKER"; }

mkdir -p "$ROOT/mobile/build"
rm -f "$MARKER"
bash "$ROOT/scripts/fetch_ocr_models.sh"

case "$MODE" in
  dev)
    mkdir -p "$SIGN_DIR" && chmod 700 "$SIGN_DIR"
    if [ ! -f "$SIGN_DIR/dev-signing.properties" ]; then
      PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
      keytool -genkeypair -v -keystore "$SIGN_DIR/dev-signing.keystore" -storetype PKCS12 -alias rxrc-dev \
        -keyalg RSA -keysize 3072 -validity 3650 -storepass "$PASS" -keypass "$PASS" \
        -dname "CN=Development build DEVELOPMENT, O=Development build - not for distribution" >/dev/null 2>&1
      printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=rxrc-dev\nkeyPassword=%s\n' "$SIGN_DIR/dev-signing.keystore" "$PASS" "$PASS" > "$SIGN_DIR/dev-signing.properties"
      chmod 600 "$SIGN_DIR/dev-signing.properties" "$SIGN_DIR/dev-signing.keystore"
      echo "Generated a development signing key in $SIGN_DIR (outside the repository)."
    fi
    write_profile development false
    TASK=assembleDevRelease
    EXTRA=""
    OUT="$ROOT/mobile/android/app/build/outputs/apk/dev/release/app-dev-release.apk"
    ;;
  verify)
    # Controlled device verification build (Task 4H): development flavor, debuggable so a tester can
    # inspect the app's private storage. Same development signing key. Never for distribution.
    write_profile development false
    TASK=assembleDevRelease
    EXTRA="-PrxVerificationDebuggable=true"
    OUT="$ROOT/mobile/android/app/build/outputs/apk/dev/release/app-dev-release.apk"
    ;;
  pilot)
    (cd "$ROOT" && npx tsx scripts/release_gate.ts)   # exits non-zero on any blocker
    ENC="$(node -e "console.log(require('$ROOT/config/release_signoffs.json').encryption_verified_on_device === true)")"
    trap restore_profile EXIT
    write_profile pilot "$ENC"
    touch "$MARKER"
    TASK=assemblePilotRelease
    OUT="$ROOT/mobile/android/app/build/outputs/apk/pilot/release/app-pilot-release.apk"
    ;;
  *)
    echo "usage: $0 dev|pilot" >&2
    exit 2
    ;;
esac

# Versioned copies (Task 4A.2): <name>-<flavor>-v<version>-b<build>-<abi>.apk in mobile/build/apk/.
FLAVOR="$MODE"
NAME="$(node -p "require('$ROOT/config/brand.json').product_name.toLowerCase().replace(/[^a-z0-9]+/g,'-')")"
VER="$(node -p "require('$ROOT/config/app_version.json').version")"
BUILD="$(node -p "require('$ROOT/config/app_version.json').build_number")"
DEST="$ROOT/mobile/build/apk"
mkdir -p "$DEST"
# 1) Universal APK (arm64-v8a, armeabi-v7a, x86_64). 2) ARM64-only APK (most phones since ~2017).
(cd "$ROOT/mobile/android" && ./gradlew --no-daemon ${EXTRA:-} "$TASK")
cp "$OUT" "$DEST/$NAME-$FLAVOR-v$VER-b$BUILD-universal.apk"
(cd "$ROOT/mobile/android" && ./gradlew --no-daemon ${EXTRA:-} -PreactNativeArchitectures=arm64-v8a "$TASK")
cp "$OUT" "$DEST/$NAME-$FLAVOR-v$VER-b$BUILD-arm64-v8a.apk"
# Privacy gate (Task 4C): refuse an APK with unexpected permissions or any known telemetry component.
BT="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
for f in "$DEST/$NAME-$FLAVOR-v$VER-b$BUILD-"*.apk; do
  perms="$("$BT/aapt2" dump permissions "$f" | grep uses-permission | sed "s/.*name='\([^']*\)'.*/\1/" | grep -v "DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" | sort | tr '\n' ' ')"
  if [ "$perms" != "android.permission.INTERNET " ]; then echo "PRIVACY GATE: unexpected permissions in $f: $perms" >&2; exit 1; fi
  if "$BT/aapt2" dump xmltree "$f" --file AndroidManifest.xml | grep -qiE "Telemetry|datatransport|firebase|crashlytics|analytics"; then echo "PRIVACY GATE: telemetry component in manifest of $f" >&2; exit 1; fi
  if unzip -p "$f" 'classes*.dex' | strings | grep -qE "ai/onnxruntime/telemetry|com/google/android/datatransport|com/google/firebase/analytics|com/microsoft/applications/events"; then echo "PRIVACY GATE: telemetry classes in $f" >&2; exit 1; fi
done
echo "Privacy gate passed: INTERNET is the only permission; no telemetry components."
echo "APKs (version $VER, build $BUILD):"
(cd "$DEST" && for f in "$NAME-$FLAVOR-v$VER-b$BUILD-"*.apk; do printf "%10s  " "$(stat -c %s "$f")"; sha256sum "$f"; done)
