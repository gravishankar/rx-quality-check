# Device verification — Task 4H build 11 (controlled, synthetic data only)

**Status: device checks NOT RUN.** No Android device is reachable from the cloud environment that
prepared this build (no device or computer is connected to it, and it cannot run an emulator). Every
device check below is **UNTESTED** until someone runs it on the Pixel and fills in the observed result
and evidence. Only the static APK checks in §3 were run.

## 1. Build under test

| | |
|---|---|
| App | MedLuma (DEV), package `org.rxrecallcheck.app.dev`, version 0.1.10, build 11 |
| Source | branch `task-4h/correctness-findings`, commit `2d5939526abfcd91b2c51deb73d68a89953e0a00` (all checks rerun at that commit: 559 core tests, 60 screen tests, 13 recorded scenarios, both type checks, config validation). Local only, not pushed or merged |
| Profile | development: persistence (saved history) **off**, catalog unchanged (no activation), draft configuration allowed, DEV banner |
| Variant | `devRelease` built with `scripts/android_build.sh verify`: **debuggable** (option A, for `adb shell run-as` inspection), signed with the development key (same as builds 9 and 10; installs over them) |
| Phone APK | `medluma-verify-v0.1.10-b11-arm64-v8a.apk` — 36,806,031 bytes, SHA-256 `44c56c120abbd7e46b28e439687044d26768600d885293a3391c4d3697389700` |
| | `medluma-verify-v0.1.10-b11-universal.apk` — 77,784,040 bytes, SHA-256 `af08500cc4d2a3ccd48a4727f410ecbf85790e0515f8b0bbe0ca0a0ecf6fd043` |
| Signing certificate | SHA-256 `d76ad6369817ebc09f08483c4be50334aa691b5c5c1a761349e2224530562af7` |
| Use | the team's own test device only; never for distribution. Uninstall after verification |
| Previous build | build 10 (0.1.9, commit `94c0eac`, not debuggable) — superseded for verification; its static checks are kept in §6 for the record |

Record for every session: device model, Android version and security patch level (Settings → About
phone), camera app name and version, date, tester.

## 2. Test data

Synthetic only: `scan-test-labels-SYNTHETIC.pdf` (pages S1–S7) and typed test records (TEST_ON_COMPUTER.md
§4). No real patient labels, names or medication lists. Isolated databases: the encryption self-test uses
its own test database (`SELF_TEST_DB`), never the app's database; normal medication persistence stays off.

## 3. Static checks on the APK (run in the build environment)

Filled in from `aapt2` and `apksigner` on the built files (results in §6).

## 4. Inspection access (decided: option A, build 11)

This build is **not debuggable**, so the app's private storage (`/data/data/org.rxrecallcheck.app.dev/`:
the photo cache `cache/scans/` and database files) cannot be listed or read on a normal, unrooted Pixel
(`adb shell run-as` is refused). Checks V1–V4 (photo files) and V6b (database file on disk) therefore
cannot be verified *independently* with build 10; only the app's own report is observable.

Options (decision for the team; not implemented):
- **A. Debuggable verification variant** of the development flavor (`run-as` allowed). Lets the tester
  list the photo cache and copy the self-test database file. The development build holds no patient data
  (persistence off). Pilot builds stay non-debuggable (release gate).
- **B. Development-only diagnostics in the app**: show the number of files in the photo cache, and keep
  the self-test database until a button deletes it, so its first bytes can be shown. No adb needed;
  adds code to the reviewed build.
- **C. Rooted test phone** (not the team's everyday Pixel).

**Chosen: A** (team direction 2026-11-14). Build 11 is debuggable, so V1–V4 and V6b can be inspected
with `adb shell run-as org.rxrecallcheck.app.dev …`. Gradle refuses the debuggable mode for any pilot or
non-development build (checked). Because the build is debuggable, V0's expected flags now include
DEBUGGABLE; V10 (logs) should also be repeated on a non-debuggable build before any pilot.

## 5. Checks

Tools: the Pixel, a Mac with Android platform-tools (`adb`) and a USB cable, USB debugging on. Commands
use `PKG=org.rxrecallcheck.app.dev`. Keep every screenshot and command output as evidence, named by check ID.

| ID | Check | Procedure | Expected | Access | Observed | Evidence | Status |
|---|---|---|---|---|---|---|---|
| V0 | Build identity | Install the ARM64 APK (`adb install -r <apk>`). About screen: version and build. `adb shell dumpsys package $PKG \| grep -E "versionName\|versionCode\|flags="` | 0.1.10, build 11; flags include DEBUGGABLE (verification build) and not ALLOW_BACKUP | adb | | | UNTESTED |
| V1 | Photo cleanup after a successful scan | Scan page S6. `adb shell run-as $PKG ls -la cache/scans` | Directory empty; no cleanup warning on screen | adb (`run-as`, build 11) | | | UNTESTED |
| V2 | …after cancel | Scan, then back out of the camera without taking a photo. Same listing | Empty; "No photo was taken." and no cleanup warning | adb (`run-as`, build 11) | | | UNTESTED |
| V3 | …after errors | (a) scan a blank page (nothing readable); (b) disable the camera app (Settings → Apps → Camera → Disable) and tap Scan → "No camera app"; re-enable after | Empty after each; app shows the problem, never a result | adb (`run-as`, build 11) | | | UNTESTED |
| V4 | …after process termination and restart | Tap Scan, take the photo, and **before accepting** run `adb shell am kill $PKG` (or swipe the app away). Then list `cache/scans` (a leftover may exist), start the app, tap Scan, list again | After restart the leftover is removed at the next scan start; if it cannot be removed, the warning "Label photo still on this phone" appears on every screen | adb (`run-as`, build 11) | | | UNTESTED |
| V5 | External camera behavior | Scan with the default camera (Pixel Camera). Afterwards open Google Photos and Files → Images → Camera | No label photo in Photos/DCIM. Record the camera app and version; repeat with any other installed camera app | device only | | | UNTESTED |
| V6a | SQLCipher present; right key reads | About → Encryption self-test (development builds) | Steps "SQLCipher compiled in" (cipher version shown), "Read back with the right key", "Test database deleted" all pass | device only | | | UNTESTED |
| V6b | Database file encrypted on disk | During the self-test, copy the test database file and read its first 16 bytes | Not `SQLite format 3` | adb (`run-as`, build 11) | | | UNTESTED |
| V7 | Wrong-key rejection | Same self-test, step "Unreadable with a different key" | Pass (refused or no data) | device only | | | UNTESTED |
| V8 | Deletion and key-reset recovery | About → Delete all data → confirm; then scan S6 and check again; then the self-test again | Delete reports success (or a visible failure); the first-launch notice returns; the next check works; the self-test passes afterwards. Real-database delete/retry is **not exercisable** while persistence is off; the lifecycle is covered by tests against a file-backed SQLite database (not SQLCipher on a device) | device only | | | UNTESTED |
| V9 | Backup exclusion | `adb shell dumpsys package $PKG \| grep flags=` (no ALLOW_BACKUP). `adb shell bmgr backupnow $PKG` | Backup refused or zero app data; no ALLOW_BACKUP flag | adb | | | UNTESTED |
| V10 | Release logs | `adb logcat -c`; run S1, S3, S6 and a typed check; `adb logcat -d > v10.txt`; search it for the NDCs, drug names and lot numbers used (e.g. `grep -iE "62756\|JKU4639A\|metformin\|warfarin" v10.txt`) | No label text, NDC, lot or medication name from the app process | adb | | | UNTESTED |
| V11 | Native networking | Mac proxy (e.g. mitmproxy, no CA installed on the phone) set as the Wi-Fi proxy; scan S6 and check. Record the CONNECT hosts. Then turn the proxy off | Only `api.fda.gov`, `rxnav.nlm.nih.gov`, `dailymed.nlm.nih.gov` contacted; nothing during OCR (photo → "Is this your medication?") before confirmation lookups; with the proxy's own CA the app refuses the connection (user CAs not trusted) and shows "We couldn't reach FDA's data". Cookie and redirect handling cannot be observed without decrypting traffic: **UNTESTED by design** unless the team approves a debug-only trust configuration | proxy | | | UNTESTED |
| V12 | Recents-screen exposure | Show a result for S1, press Overview (recents) | Recorded as observed. FLAG_SECURE is not set (OD-21 open), so the result is expected to be **visible** in the thumbnail — a known gap, not a pass | device only | | | UNTESTED |

## 6. Results

### Static APK checks — build 11 (ARM64 APK)

| Check | Result |
|---|---|
| Package and version | `org.rxrecallcheck.app.dev`, versionCode 11, versionName 0.1.10-dev — **PASS** |
| Debuggable (verification build) | `android:debuggable=true` — **as intended** for option A; never for pilot (Gradle refusal checked) |
| Permissions | only `INTERNET` (+ library-generated app-private permission) — **PASS** |
| Backup and network (declared) | `allowBackup=false`, `usesCleartextTraffic=false` — **PASS** as declared |
| Telemetry | build privacy gate and dex scan: none — **PASS** |
| Signing | development certificate `d76ad636…562af7`, same as builds 9–10 — **PASS** |

### Static APK checks — build 10 (ARM64 APK; kept for the record; these do not replace the device checks)

| Check | Method | Result |
|---|---|---|
| Package and version | `aapt2 dump badging` | `org.rxrecallcheck.app.dev`, versionCode 10, versionName 0.1.9-dev, target SDK 36 — **PASS** |
| Permissions | `aapt2 dump permissions` | Only `INTERNET` (plus the library-generated, app-private `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`); no CAMERA, storage or network-state permission — **PASS** |
| Not debuggable | manifest | no `android:debuggable` — **PASS** (this is also why V1–V4 and V6b need option A, B or C) |
| Backup exclusion (declared) | manifest | `allowBackup=false`, `fullBackupContent=false`, `dataExtractionRules` set — **PASS** as declared; device behavior is V9 |
| Network policy (declared) | manifest | `usesCleartextTraffic=false`, network security config: system CAs only, no cleartext — **PASS** as declared; device behavior is V11 |
| Exported components | manifest | the launcher activity, and `androidx.profileinstaller.ProfileInstallReceiver` guarded by `android.permission.DUMP` (system/shell only); the photo FileProvider is not exported — **PASS** |
| Telemetry | build privacy gate (manifest and dex scan) | none found — **PASS** |
| Signing | `apksigner verify --print-certs` | development certificate, identical to build 9 — **PASS** |

### Device checks

| Passed | Failed | Untested |
|---|---|---|
| — | — | V0–V12 (no device available to the preparing session) |

Any failure is reported to the team before further activation is proposed.
