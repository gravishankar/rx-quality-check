# Android Build and Install — v0.1.0 (working name MedLuma)

The app is a React Native 0.88.1 project in `mobile/` (Android first; iOS in `docs/IOS_BUILD.md`).
Shared logic is in `mobile/src/` (platform-independent TypeScript, tested by the root `npm test`);
screens in `mobile/app/`; Android project in `mobile/android/`.

## Variants

| Variant | Gradle task | App name / ID | Configuration | History | Signing | May be distributed? |
|---|---|---|---|---|---|---|
| Development | `assembleDevRelease` | "MedLuma (DEV)" / `org.rxrecallcheck.app.dev` | Draft allowed (OD-18) | Off (memory only) | Local development key generated in `~/.rx-recall-check/` | **No** — internal testing only |
| Pilot | `assemblePilotRelease` | "MedLuma" / `org.rxrecallcheck.app` | APPROVED only (fail closed) | On only if encryption verified on device | Pilot key kept by the project team outside the repo and cloud | Only after `docs/RELEASE_READINESS_CHECKLIST.md` |

App names and `versionName` come from `config/brand.json` (Task 4A.1); application IDs and signing
do not, and stay unchanged until the project team approves a final name. Both variants bundle the JavaScript (Hermes bytecode) into the APK, so no Metro server or computer is
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

## Versions and APK files (Task 4A.2)

`config/app_version.json` holds `version` and `build_number` (Android `versionName`/`versionCode`,
iOS `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`, the About screen). Increase `build_number` for every
APK, then `npm run version:bundle`. `npm run android:dev` builds two APKs and writes versioned copies
to `mobile/build/apk/`:

| File | CPU types | Size (build 3) |
|---|---|---|
| `<name>-dev-v<version>-b<build>-arm64-v8a.apk` | arm64 (almost all phones since ~2017) | 15.2 MB |
| `<name>-dev-v<version>-b<build>-universal.apk` | arm64, armeabi-v7a, x86_64 | 29.6 MB |

Size changes (build 2 → 3), with no code or library removed: native libraries stored compressed in the
APK (`useLegacyPackaging true`; unpacked at install) and an ARM64-only APK built with
`-PreactNativeArchitectures=arm64-v8a`. An explicit CPU filter keeps React Native's 32-bit x86
libraries out (op-sqlite/SQLCipher is not built for x86). R8 code shrinking stays off until it can be
verified on a device.

## Scanner (Task 4C)

- `scripts/android_build.sh` first runs `scripts/fetch_ocr_models.sh`, which downloads the PaddleOCR
  PP-OCRv4 mobile ONNX models (Apache-2.0; builds 4–5 used PP-OCRv3) from the pinned RapidOCR 1.4.4 wheel on PyPI,
  then shrinks them with `scripts/optimize_ocr_models.py` (build 8: 105-character recognizer, 8-bit
  weights; needs Python 3 and installs pinned `onnx`/`numpy` from PyPI into a temporary environment), verifies SHA-256 of
  the wheel and each model, and places them in `mobile/android/app/src/main/assets/ocr/` (not committed).
- Dependencies: `onnxruntime-android:1.28.0` (pinned below the version that adds telemetry),
  `io.github.zxing-cpp:android:3.1.1`.
- **Privacy gate:** after building, the script fails if an APK has any permission other than INTERNET or
  contains known telemetry classes/components (ONNX Runtime telemetry, Google data transport, Firebase,
  Microsoft 1DS).

## Builds produced so far

| Build | Commit | App label | SHA-256 | Where |
|---|---|---|---|---|
| Task 4A development APK | `5d50dfa` | Rx Recall Check (DEV) | `648e9c07b4598ea570d22cefd11c5b9ff983bc56392cfb16f6ad9748fa00de11` | Sent in the Task 4A session; archived in the build environment (`~/.rx-recall-check/apk-archive/`) |
| Task 4A.1 development APK (build 2) | `df0d120` | MedLuma (DEV) | `0718180fb5a107c0fb99bf6cc2ffde256c1b9a81a35b9380f44fe97bec2b3907` | Sent in the Task 4A.1 session; archived likewise |
| Task 4A.2 build 3, ARM64 (0.1.2-dev, versionCode 3) | `task-4a2/functional-validation` | MedLuma (DEV) | `31023c94b47ac50326411c5462a9838ab5b3ead5845d0f06ac00cc618d2cbb7e` | Sent in the Task 4A.2 session; archived |
| Task 4A.2 build 3, universal | same | MedLuma (DEV) | `8dedb5e7226d41de3dba326f5bb7fa2f8ca800ec6e83292863784eca297481de` | Sent in the Task 4A.2 session; archived |
| Task 4C build 4, ARM64 (0.1.3-dev, versionCode 4, scanner) | `task-4c/scanner` | MedLuma (DEV) | `629a7035a63044f0611362ef764f283529084deffb9af8b62f03186c77d4d958` | Sent in the Task 4C session; archived |
| Task 4C build 4, universal | same | MedLuma (DEV) | `a081b282dac61643c5d75d0ea65cec9042efd25b9b33d14e433cdeec3cb31d5f` | Sent in the Task 4C session; archived |
| Task 4C build 5, ARM64 (0.1.4-dev, barcode fix) | same | MedLuma (DEV) | `9972d0368bae90832c23048ef897818a96d78d6bb37a319ea886bb133b49835f` | Sent; archived |
| Task 4C build 5, universal | same | MedLuma (DEV) | `b827210c0415b4cefaffb1e77a63cefb324b4c2a709257bb9f3e7b4591a4fdf8` | Sent; archived |
| Task 4C build 6, ARM64 (0.1.5-dev, OCR dictionary fix, PP-OCRv4) | same | MedLuma (DEV) | `4873b40d497dc10f30ec0ddf51b99778f0a872961da8c4dd9cacccc65fff82a6` | Sent; archived |
| Task 4C build 6, universal | same | MedLuma (DEV) | `bc9e74ead9ff10b78859c7ff50ecef7073201b9b7cb40748e010f1346baca92f` | Sent; archived |
| Task 4C build 7, ARM64 (0.1.6-dev, summary-first result) | same | MedLuma (DEV) | `c0b44b6ba2ff3d7b57891faf822f199ff2c82d24034797d286c0b3ece54b6d73` | Sent; archived |
| Task 4C build 7, universal | same | MedLuma (DEV) | `6140ea29adb03375576bfd79feea689181167c76736452a1b544739e13abee3c` | Sent; archived |
| Task 4C build 8, ARM64 (0.1.7-dev, smaller OCR models) | same | MedLuma (DEV) | `9bbf1f6c59c1b8ed2cdbfa74effbc83f31eb54ecbb62d4d48d894c0016e5ab0b` | Sent; archived |
| Task 4C build 8, universal | same | MedLuma (DEV) | `d3fd7596dced8fb6b797e97f67538717a888bc8747a35c4a1f7f966cb280331a` | Sent; archived |
| Task 4C build 9, ARM64 (0.1.8-dev, banner wording) | same | MedLuma (DEV) | `be575247ac8b3e90f6893e04b1c3431e86fda6a94e22e3fb3389cb398883241a` | Sent; archived |
| Task 4C build 9, universal | same | MedLuma (DEV) | `d2481cc0a01064ee1f4236363b45df06fb84030c4f06a40b0f38bc6f5dc1d3fc` | Sent; archived |

Both are signed with the same development certificate (SHA-256
`d76ad6369817ebc09f08483c4be50334aa691b5c5c1a761349e2224530562af7`, DN still names the earlier
working name — signing identity intentionally unchanged). APKs are never committed to the repository.
Rebuilding the same commit with the same toolchain and key produces a functionally equivalent APK;
byte-identical output is not guaranteed (timestamps in native libraries), so checksums are per build.
