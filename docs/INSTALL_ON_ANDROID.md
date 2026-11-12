# Install the Development App on Your Android Phone

For the owner only. This is a **development build** (name on the phone: "MedLuma (DEV)" — the name
is a temporary placeholder). It is an evaluation prototype, not clinically validated, and must not be
shared with anyone else. You do **not** need to build anything.

## Which file to install

Every build has a version and a build number. The build number goes up with every APK; a higher
build installs over a lower one.

| Build | Version shown in the app | File | Size | SHA-256 | Status |
|---|---|---|---|---|---|
| **4 (current, scanner)** | 0.1.3-dev (build 4) | `medluma-dev-v0.1.3-b4-arm64-v8a.apk` — **use this one first** | 38.9 MB | `629a7035a63044f0611362ef764f283529084deffb9af8b62f03186c77d4d958` | Recommended; test with `docs/task4c/PIXEL_SCAN_TEST_GUIDE.md` |
| 4 (current, scanner) | 0.1.3-dev (build 4) | `medluma-dev-v0.1.3-b4-universal.apk` | 76.7 MB | `a081b282dac61643c5d75d0ea65cec9042efd25b9b33d14e433cdeec3cb31d5f` | Fallback |
| 3 | 0.1.2-dev (build 3) | `medluma-dev-v0.1.2-b3-arm64-v8a.apk` | 15.2 MB | `31023c94b47ac50326411c5462a9838ab5b3ead5845d0f06ac00cc618d2cbb7e` | Superseded (no scanner) |
| 3 | 0.1.2-dev (build 3) | `medluma-dev-v0.1.2-b3-universal.apk` | 29.6 MB | `8dedb5e7226d41de3dba326f5bb7fa2f8ca800ec6e83292863784eca297481de` | Superseded |
| 2 (already sent) | 0.1.0 (no build number shown) | `medluma-dev-0.1.0-task4a1.apk` | 63.5 MB | `0718180fb5a107c0fb99bf6cc2ffde256c1b9a81a35b9380f44fe97bec2b3907` | Superseded; see "Installing the already-available build" |
| 1 | 0.1.0 | `app-dev-release.apk` ("Rx Recall Check (DEV)") | 63.5 MB | `648e9c07b4598ea570d22cefd11c5b9ff983bc56392cfb16f6ad9748fa00de11` | Superseded |

The ARM64 file works on almost every Android phone made since about 2017. The universal file works on
older 32-bit phones too; it is larger but otherwise identical.

## Option A — easiest: download directly on the phone

1. On the phone, open the **Claude app** (or claude.ai in Chrome) and open this conversation.
2. Tap the file card **`medluma-dev-v0.1.2-b3-arm64-v8a.apk`** and download it.
3. Continue at **"Install"** below.

Checking the checksum on the phone needs an extra app, so if you want to verify it, use Option B.

## Option B — with your MacBook Pro (lets you verify the checksum)

### 1. Download on the Mac
Open this conversation on claude.ai in a browser on the Mac and download the file card. It goes to
your **Downloads** folder.

### 2. Verify the checksum
Open **Terminal** (Applications → Utilities → Terminal) and run:

```bash
shasum -a 256 ~/Downloads/medluma-dev-v0.1.2-b3-arm64-v8a.apk
```

The long code printed must be exactly the SHA-256 in the table above. If it is different, delete the
file and download it again; do not install a file whose checksum does not match.

### 3. Move it to the phone (pick one)
- **Google Drive:** drag the file into drive.google.com on the Mac, then open the Drive app on the
  phone and download it. (The APK contains no personal data.)
- **USB cable with adb** (most reliable, also used for diagnostics):
  1. Install Homebrew if you do not have it (https://brew.sh), then install Android's tools:

     ```bash
     brew install --cask android-platform-tools
     ```

  2. On the phone: **Settings → About phone →** tap **Build number** seven times (it says "You are now
     a developer"). Then **Settings → System → Developer options →** turn on **USB debugging**.
     (On Samsung: Settings → About phone → Software information → Build number.)
  3. Connect the phone to the Mac with a USB cable. On the phone, tap **Allow** on "Allow USB
     debugging?". Check the Mac sees it:

     ```bash
     adb devices
     ```

     It should list one device ending in `device` (not `unauthorized`).
  4. Install directly (skip the "Install" section below):

     ```bash
     adb install -r ~/Downloads/medluma-dev-v0.1.2-b3-arm64-v8a.apk
     ```

     `Success` means it is installed.

## Install (Options A and Google Drive)

1. Open the **Files** app (or **My Files** on Samsung) → **Downloads** → tap the APK.
2. Android asks to allow installs from this source: tap **Settings**, turn on **Allow from this
   source**, then go back.
3. Tap **Install**. Google Play Protect may warn that the app is from an unknown developer — this is
   expected for an unpublished development build. Choose **Install anyway** (only because you got it
   from this conversation and, ideally, verified the checksum).
4. Afterwards, turn **Allow from this source** back off for that app.

**If it says "App not installed"** or `INSTALL_FAILED_NO_MATCHING_ABIS`: your phone needs the
universal file — install `medluma-dev-v0.1.2-b3-universal.apk` instead.
**If it says `INSTALL_FAILED_UPDATE_INCOMPATIBLE`** or "package conflicts with an existing package":
an older copy signed differently is installed. Uninstall "MedLuma (DEV)" / "Rx Recall Check (DEV)"
first, then install again.

## Launch and check the version

1. Open **MedLuma (DEV)** from the app drawer. No computer or other setup is needed; the phone needs
   internet for lookups.
2. A purple banner says **DEVELOPMENT BUILD — evaluation prototype…** on every screen.
3. Read "Before you start" and tap **I understand** (it appears at every launch in this build, because
   the development build saves nothing).
4. Tap **About and privacy**: it should say **version 0.1.2 (build 3)**. If it does not show a build
   number, you are running an older build.

Then follow the test plan: `docs/FUNCTIONAL_TEST_PLAN.md` (use only the test medications listed there,
never your own medication details).

## Installing the already-available build (build 2)

Build 2 (`medluma-dev-0.1.0-task4a1.apk`, sent earlier) installs the same way: use Option A or B
above with that file name and its checksum
`0718180fb5a107c0fb99bf6cc2ffde256c1b9a81a35b9380f44fe97bec2b3907`. Its About screen shows
"version 0.1.0" without a build number. Build 3 can be installed over it directly (it keeps nothing
anyway); build 2 cannot be installed over build 3 — uninstall first. Build 3 is recommended because it
fixes the problems listed in `docs/UX_REVIEW_4A2.md`.

## If something goes wrong: report it without personal data

Only report from sessions where you used the test medications in `docs/FUNCTIONAL_TEST_PLAN.md`.

1. **Write down** the test number (e.g. F-07), what you did and what the screen said.
2. **Screenshot** the screen (Power + Volume down). Screenshots of test medications are fine.
3. **App version:** About and privacy → the version line.
4. **Phone model and Android version:** Settings → About phone.
5. **If the app closed by itself (crash)** and you have the Mac + adb set up:

   ```bash
   adb logcat -b crash -d > ~/Desktop/medluma-crash.txt
   ```

   This saves only crash reports (the app does not log medication details). Check the file before
   sending it.

Do **not** send: a full `adb logcat` without `-b crash`, an Android "bug report" (contains personal
device data), or screenshots showing your real medications.

## Uninstall

Long-press the app icon → **Uninstall**, or:

```bash
adb uninstall org.rxrecallcheck.app.dev
```

This removes the app and everything it stored.
