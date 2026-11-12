# Test the Development App on a Mac or Windows Laptop (no Android phone needed)

For the owner and invited testers only. You will run a **virtual Android phone** (the Android
Emulator, free from Google) on your computer and install the MedLuma (DEV) app on it.
"MedLuma" is a temporary working name.

> **Before you start:** this is an evaluation prototype for testing only. It is not clinically
> validated, its legal documents are drafts, and it must not be used for real medication decisions.
> Test only with the test medications in `docs/FUNCTIONAL_TEST_PLAN.md` and the synthetic test labels
> in `scan-test-labels-SYNTHETIC.pdf`. Never type or scan your own medication, name or prescription.

> **Status: this setup has NOT yet been tested on a Mac or Windows emulator.** The app has been built
> and tested automatically, and build 6 scanned a label on a real Pixel. The cloud environment that
> builds the app cannot run an emulator. If something in this guide does not match what you see,
> please report it (section 9).

## 1. What you need

| | Mac | Windows laptop |
|---|---|---|
| System | macOS 12 or newer; Apple Silicon (M1–M4) or Intel | Windows 10 or 11, 64-bit |
| Memory | 16 GB recommended (8 GB works, slowly) | 16 GB recommended (8 GB works, slowly) |
| Free disk | About 20 GB | About 20 GB |
| Other | Internet connection | Internet connection; **virtualization turned on** (section 3) |
| Time | About 45 minutes the first time (mostly downloads) | About 45 minutes the first time |

## 2. Which app file to use

Ask the owner for the file (shared privately, e.g. a restricted Google Drive link). Build 7:

| Your computer | Use this file | SHA-256 |
|---|---|---|
| **Mac with Apple Silicon** (Apple menu → About This Mac shows "Chip: Apple M…") | `medluma-dev-v0.1.6-b7-arm64-v8a.apk` (41.4 MB) | `c0b44b6ba2ff3d7b57891faf822f199ff2c82d24034797d286c0b3ece54b6d73` |
| **Mac with Intel** ("Processor: Intel …") or **any Windows laptop** | `medluma-dev-v0.1.6-b7-universal.apk` (79.3 MB) | `6140ea29adb03375576bfd79feea689181167c76736452a1b544739e13abee3c` |

Why: the virtual phone uses the same kind of processor as your computer. The ARM64 file does not
run on an Intel/AMD virtual phone; the universal file contains the Intel/AMD (x86_64) version too
(checked: it has the same 19 native libraries for both).

Check the file is intact before installing:

Mac (Terminal: Applications → Utilities → Terminal):

```bash
shasum -a 256 ~/Downloads/medluma-dev-v0.1.6-b7-arm64-v8a.apk
```

Windows (PowerShell: Start menu → type "PowerShell"):

```powershell
Get-FileHash $HOME\Downloads\medluma-dev-v0.1.6-b7-universal.apk -Algorithm SHA256
```

The long code must match the table exactly (Windows prints it in capital letters; that is fine).
If it does not match, delete the file and download it again.

## 3. Windows only: make sure virtualization is on

1. Press **Ctrl + Shift + Esc** → **Performance** tab → **CPU**. Look for **Virtualization: Enabled**.
2. If it says **Disabled**, it must be turned on in the laptop's BIOS/UEFI settings (usually called
   "Intel VT-x", "Intel Virtualization Technology" or "SVM Mode" for AMD). How to reach these settings
   differs by laptop maker; search "<your laptop model> enable virtualization". If this is a work
   laptop, ask your IT department.
3. Start menu → type **"Turn Windows features on or off"** → tick **Windows Hypervisor Platform** →
   OK → restart when asked.

Macs need nothing extra.

## 4. Install Android Studio (includes the emulator)

1. Go to **https://developer.android.com/studio** and download Android Studio for your system
   (on a Mac, pick **Apple chip** or **Intel chip** to match section 2).
2. Install it:
   - **Mac:** open the `.dmg`, drag **Android Studio** into **Applications**, then open it from
     Applications.
   - **Windows:** run the `.exe` and accept the defaults (keep **Android Virtual Device** ticked).
3. On first launch, the **Setup Wizard** opens: choose **Standard**, accept the licenses, and let it
   download the components (this takes a while). You do not need to create a project or sign in.

## 5. Create a virtual phone

1. On the **Welcome to Android Studio** window, click **More Actions → Virtual Device Manager**
   (in some versions: **Device Manager**).
2. Click **+** (or **Create Virtual Device**).
3. Choose **Phone → Pixel 8** (any recent Pixel is fine) → **Next**.
4. Choose a system image:
   - Pick a recent Android version (API 34, 35 or 36) labeled **Google APIs** or **Google Play**.
   - The **ABI** column must match your computer: **arm64-v8a** on Apple Silicon Macs, **x86_64** on
     Intel Macs and Windows. Click the download icon next to it if needed, then **Next**.
5. **Camera (needed only for scanning, section 8):** click **Show Advanced Settings** (or the
   **Advanced** tab) → **Camera → Back:** choose **Webcam0** (your laptop's camera). Leave Front as is.
6. Click **Finish**, then the **▶ (play)** button next to the new phone. A phone window opens and
   boots in a minute or two (the first start is slow).

## 6. Install the app on the virtual phone

**Easiest:** drag the `.apk` file from Finder (Mac) or File Explorer (Windows) **onto the virtual
phone's window**. Wait about 30 seconds; the app appears in the phone's app list (swipe up on the
home screen) as **MedLuma (DEV)**.

**If dragging does not work**, use the command line:

Mac:

```bash
~/Library/Android/sdk/platform-tools/adb install -r ~/Downloads/medluma-dev-v0.1.6-b7-arm64-v8a.apk
```

Windows (PowerShell):

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r "$HOME\Downloads\medluma-dev-v0.1.6-b7-universal.apk"
```

`Success` means it is installed. `INSTALL_FAILED_NO_MATCHING_ABIS` means the wrong file for this
virtual phone — use the other file from section 2.

## 7. Open the app and check the version

1. Open **MedLuma (DEV)**. A purple **DEVELOPMENT BUILD** banner appears on every screen.
2. Read **Before you start** and tap **I understand** (this shows at every launch in this build).
3. Tap **About and privacy**: it must say **version 0.1.6 (build 7)**.

The app needs internet for its lookups; the virtual phone uses your computer's connection.

## 8. What to test

### A. Typing the details (works fully on a computer — start here)

On the scan screen tap **Type the details instead**, then follow `docs/FUNCTIONAL_TEST_PLAN.md` with
its test medications D1–D8, and the result-screen checks **R1–R10** in
`docs/task4c/PIXEL_SCAN_TEST_GUIDE.md` (section 4a). Use your computer keyboard to type.

Quick example (D2 — possible recall match):

| Field | Type |
|---|---|
| NDC from the label | `62756-142-02` |
| Drug name as printed | `METFORMIN HCL ER` |
| Strength as printed | `500 MG` |
| Form | `TABLET` |
| Lot number | *(leave empty)* |

Tap **Find this medication**, switch on each item, tap **Yes, these details match my label**. Expected:
**Possible recall match**, a one-sentence count of the records checked, then **Important limits of this
result**.

### B. Scanning (optional; not tested on an emulator)

Scanning uses the virtual phone's camera app, which shows what your laptop's webcam sees (if you set
**Back camera: Webcam0** in section 5).

1. Open `scan-test-labels-SYNTHETIC.pdf` on a phone or tablet, or print it.
2. In the app tap **Scan medication label**; the camera app opens.
3. Hold one test label 15–30 cm from the webcam, steady and well lit, then press the shutter and ✓.

Laptop webcams usually have low resolution and fixed focus, so small print often cannot be read. A
"We couldn't read your label" message on a computer does **not** mean scanning fails on phones —
please note it and use typing instead. If the camera shows a 3-D room instead of your webcam, the
camera setting in section 5 was not applied: Device Manager → ✎ (edit) the phone → Advanced →
Camera → Back: Webcam0.

Optional extra: in the emulator's side toolbar, **⋯ (Extended controls) → Camera**, some emulator
versions let you place a picture into the virtual room ("virtual scene"). If yours offers this, you can
place an image of a test label there and point the virtual camera at it. This depends on the emulator
version and is not documented by us in detail.

## 9. Report results (no personal data)

For each test write: test number (e.g. F-07, R4), what you did, what the screen said, PASS/FAIL.
Include: **Mac or Windows**, computer model, **virtual phone** (e.g. Pixel 8, API 35, x86_64), and
which APK file. Screenshots of the emulator window are fine (**Cmd + Shift + 4** on Mac, **Win + Shift + S**
on Windows) because they only show test medications.

If the app closes by itself, run this and send the file (it contains only crash reports):

Mac:

```bash
~/Library/Android/sdk/platform-tools/adb logcat -b crash -d > ~/Desktop/medluma-crash.txt
```

Windows (PowerShell):

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -b crash -d > "$HOME\Desktop\medluma-crash.txt"
```

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| Virtual phone does not start; message about "HAXM", "hypervisor" or "virtualization" (Windows) | Section 3: turn on virtualization and Windows Hypervisor Platform, restart |
| Virtual phone is very slow | Close other apps; in Device Manager → ✎ edit → Advanced, set RAM to 2048 MB or more; give it a few minutes on first boot |
| `INSTALL_FAILED_NO_MATCHING_ABIS` | Wrong file for this virtual phone; use the universal file (Intel Mac / Windows) |
| "App not installed" / `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | An older copy signed differently is installed: long-press the app → Uninstall, then install again |
| "We couldn't reach FDA's data" | The computer is offline or a firewall/VPN blocks api.fda.gov, rxnav.nlm.nih.gov or dailymed.nlm.nih.gov; try another network |
| Camera shows a 3-D room | Section 8B: set Back camera to Webcam0 |
| macOS asks to allow camera access for "qemu" or Android Studio | Allow it (System Settings → Privacy & Security → Camera), then restart the virtual phone |

## 11. Remove everything afterwards

- Uninstall the app: long-press **MedLuma (DEV)** on the virtual phone → **Uninstall**.
- Delete the virtual phone: Device Manager → **⋮** next to it → **Delete**.
- Uninstall Android Studio as you would any other application (Mac: drag it to the Bin; also delete
  `~/Library/Android` to free the space. Windows: Settings → Apps → Android Studio → Uninstall; also
  delete `%LOCALAPPDATA%\Android`).

## No iPhone version yet

The app's shared code also runs on iOS, but scanning is Android-only so far and no iPhone build has
been produced. Testing on an iPhone, or on a Mac using the iOS Simulator, would need separate work
(Xcode, an Apple Developer account for TestFlight) and is not available today.
