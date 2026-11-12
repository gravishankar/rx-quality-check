# Android Build and Install — v0.1.0 (working name MedLuma)

The app is a React Native 0.88.1 project in `mobile/` (Android first; iOS in `docs/IOS_BUILD.md`).
Shared logic is in `mobile/src/` (platform-independent TypeScript, tested by the root `npm test`);
screens in `mobile/app/`; Android project in `mobile/android/`.

## Variants

| Variant | Gradle task | App name / ID | Configuration | History | Signing | May be distributed? |
|---|---|---|---|---|---|---|
| Development | `assembleDevRelease` | "MedLuma (DEV)" / `org.rxrecallcheck.app.dev` | Draft allowed (OD-18) | Off (memory only) | Local development key generated in `~/.rx-recall-check/` | **No** — owner testing only |
| Pilot | `assemblePilotRelease` | "MedLuma" / `org.rxrecallcheck.app` | APPROVED only (fail closed) | On only if encryption verified on device | Pilot key kept by the owner outside the repo and cloud | Only after `docs/RELEASE_READINESS_CHECKLIST.md` |

App names and `versionName` come from `config/brand.json` (Task 4A.1); application IDs and signing
do not, and stay unchanged until the owner approves a final name. Both variants bundle the JavaScript (Hermes bytecode) into the APK, so no Metro server or computer is
needed to run them. Version: `versionName 0.1.0` (`0.1.0-dev` for development), `versionCode 1`.
ABIs: arm64-v8a, armeabi-v7a, x86_64.

The variant must match `mobile/config/build_profile.json`; the build scripts write it, and Gradle
refuses a mismatch. The committed value is `development`.

## Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Node.js | ≥ 22.11 | |
| JDK | 17 (Gradle toolchain) and 21 (Gradle runtime) | Install JDK 17 if Gradle reports a missing toolchain |
| Android SDK | platform `android-37.0`, build-tools 37.0.0, NDK 27.1.12297006, CMake 3.22.1 | `ANDROID_HOME` must point to the SDK |
| Gradle | wrapper 9.4.1 (downloaded by `gradlew`) | |

## Build the development APK

```bash
npm ci
```

```bash
(cd mobile && npm ci)
```

```bash
ANDROID_HOME=$HOME/android-sdk npm run android:dev
```

The script generates a development signing key in `~/.rx-recall-check/` on first use (never in the
repository), builds `assembleDevRelease`, and prints the APK path and SHA-256:
`mobile/android/app/build/outputs/apk/dev/release/app-dev-release.apk`.

## Build the pilot APK (blocked today)

```bash
npm run release:gate
```

```bash
ANDROID_HOME=$HOME/android-sdk npm run android:pilot
```

`android:pilot` runs the release gate first and stops on any blocker. It also needs
`~/.rx-recall-check/pilot-signing.properties` (or `-PrxrcPilotSigning=/path`) with `storeFile`,
`storePassword`, `keyAlias`, `keyPassword`. Create the pilot key on your own machine, back it up
securely, and **never** copy it into the repository or a cloud session:

```bash
keytool -genkeypair -v -keystore ~/.rx-recall-check/pilot-signing.keystore -storetype PKCS12 -alias rxrc-pilot -keyalg RSA -keysize 3072 -validity 10000
```

## Install on a phone

1. On the phone: Settings → About phone → tap Build number 7 times → Developer options → USB debugging on.
2. Connect by USB and accept the computer's key.
3. Check the checksum matches the one printed by the build:

```bash
sha256sum app-dev-release.apk
```

```bash
adb install -r app-dev-release.apk
```

Without a computer: copy the APK to the phone and open it; Android asks to allow installs from that
app ("Install unknown apps"). Android's developer-verification requirements may affect sideloading
on some devices from 2026 onward (`docs/LEGAL_REGULATORY_REVIEW.md` §12).

Uninstall (removes all app data and the key):

```bash
adb uninstall org.rxrecallcheck.app.dev
```

## Verify an APK

```bash
$ANDROID_HOME/build-tools/37.0.0/aapt2 dump badging app-dev-release.apk | head -5
```

```bash
$ANDROID_HOME/build-tools/37.0.0/aapt2 dump permissions app-dev-release.apk
```

```bash
$ANDROID_HOME/build-tools/37.0.0/apksigner verify --print-certs app-dev-release.apk
```

## Reproducibility

Exact versions are pinned in `mobile/package.json` and `mobile/package-lock.json`; Gradle plugin and
library versions come from React Native 0.88.1. The same commit, toolchain versions and signing key
produce an equivalent APK; byte-for-byte reproducibility is not yet verified (Task 6).

## Troubleshooting

- *Cannot find a Java installation matching languageVersion=17*: install JDK 17.
- *429 Too Many Requests from repo.maven.apache.org*: retry; optionally add
  `systemProp.org.gradle.internal.repository.max.retries=10` to `~/.gradle/gradle.properties`.
- *build_profile.json says 'pilot' but this is a development variant*: run the npm scripts, which
  write the profile, instead of calling Gradle directly.

## Builds produced so far

| Build | Commit | App label | SHA-256 | Where |
|---|---|---|---|---|
| Task 4A development APK | `5d50dfa` | Rx Recall Check (DEV) | `648e9c07b4598ea570d22cefd11c5b9ff983bc56392cfb16f6ad9748fa00de11` | Sent in the Task 4A session; archived in the build environment (`~/.rx-recall-check/apk-archive/`) |
| Task 4A.1 development APK | `task-4a1/medluma-brand` | MedLuma (DEV) | `0718180fb5a107c0fb99bf6cc2ffde256c1b9a81a35b9380f44fe97bec2b3907` | Sent in the Task 4A.1 session; archived likewise |

Both are signed with the same development certificate (SHA-256
`d76ad6369817ebc09f08483c4be50334aa691b5c5c1a761349e2224530562af7`, DN still names the earlier
working name — signing identity intentionally unchanged). APKs are never committed to the repository.
Rebuilding the same commit with the same toolchain and key produces a functionally equivalent APK;
byte-identical output is not guaranteed (timestamps in native libraries), so checksums are per build.
