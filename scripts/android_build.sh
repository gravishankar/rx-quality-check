#!/usr/bin/env bash
# Build a standalone Android APK (no Metro needed). See docs/ANDROID_BUILD_AND_INSTALL.md.
#
#   scripts/android_build.sh dev     development APK (labeled DEV, history off, draft config allowed)
#   scripts/android_build.sh pilot   pilot APK — only if `npm run release:gate` passes and the pilot
#                                    signing properties exist OUTSIDE the repository
#
# Signing material lives in ~/.rx-recall-check/ (never in the repository). The development key is
# generated there on first use. The pilot key must be created and kept by the owner on their own
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

case "$MODE" in
  dev)
    mkdir -p "$SIGN_DIR" && chmod 700 "$SIGN_DIR"
    if [ ! -f "$SIGN_DIR/dev-signing.properties" ]; then
      PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
      keytool -genkeypair -v -keystore "$SIGN_DIR/dev-signing.keystore" -storetype PKCS12 -alias rxrc-dev \
        -keyalg RSA -keysize 3072 -validity 3650 -storepass "$PASS" -keypass "$PASS" \
        -dname "CN=Rx Recall Check DEVELOPMENT, O=Development build - not for distribution" >/dev/null 2>&1
      printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=rxrc-dev\nkeyPassword=%s\n' "$SIGN_DIR/dev-signing.keystore" "$PASS" "$PASS" > "$SIGN_DIR/dev-signing.properties"
      chmod 600 "$SIGN_DIR/dev-signing.properties" "$SIGN_DIR/dev-signing.keystore"
      echo "Generated a development signing key in $SIGN_DIR (outside the repository)."
    fi
    write_profile development false
    TASK=assembleDevRelease
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

(cd "$ROOT/mobile/android" && ./gradlew --no-daemon "$TASK")
echo "APK: $OUT"
sha256sum "$OUT"
