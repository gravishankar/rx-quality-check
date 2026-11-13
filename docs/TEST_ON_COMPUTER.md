# Try MedLuma (DEV) on a Mac — virtual Pixel 8

No Android phone needed. You'll run a free virtual Pixel 8 in a window on your Mac, install the app,
then type in or scan test labels. About 30–45 minutes the first time, mostly downloads.

Use only the test medications and test labels below. Never enter your own medication or personal
details. This is a test version (not clinically validated).

**What you need:** a Mac (2020 or newer works best), about 20 GB free disk space, internet, and
these two files from the owner:

- **The app:** `medluma-dev-v0.1.7-b8-arm64-v8a.apk` if your Mac has an Apple chip (Apple menu →
  About This Mac → "Chip: Apple M…"); otherwise `medluma-dev-v0.1.7-b8-universal.apk`.
- **The test labels:** `scan-test-labels-SYNTHETIC.pdf` (7 made-up labels, one per page, each with
  its expected result).

## 1. Install Android Studio

1. Go to **developer.android.com/studio** and click **Download Android Studio**. Pick **Mac with
   Apple chip** or **Mac with Intel chip** to match your Mac.
2. Open the downloaded file and drag **Android Studio** into **Applications**.
3. Open **Android Studio** from Applications. If macOS asks whether to open it, click **Open**.
4. In the setup window choose **Standard**, then click **Next**, accept the licenses, and click
   **Finish**. Wait for the downloads to complete. No account or sign-in needed.

## 2. Create the virtual Pixel 8 (with your Mac's camera)

1. On the **Welcome to Android Studio** window, click **More Actions → Virtual Device Manager**.
2. Click **+** (Create Virtual Device), choose **Pixel 8**, click **Next**.
3. Keep the suggested Android version. If it shows a download arrow, click it and wait. Click **Next**.
4. **Set the camera** (needed for scanning):
   - Click **Show Advanced Settings** (in newer versions: the **Additional settings** tab).
   - Find **Camera** and set **Back** to **Webcam0**. That's your Mac's built-in camera.
5. Click **Finish**.
6. Click **▶** next to **Pixel 8**. A phone appears on your screen. The first start takes a few
   minutes.

If macOS asks to let **qemu** or **Android Studio** use the camera, click **Allow**.

## 3. Install the app

Drag the app file from **Downloads** onto the virtual phone. Wait about 30 seconds, then swipe up on
the phone's home screen and open **MedLuma (DEV)**. Tap **I understand**.

## 4. Try it by typing

Tap **Type the details instead** and enter:

| Field | Type |
| --- | --- |
| NDC | `62756-142-02` |
| Drug name | `METFORMIN HCL ER` |
| Strength | `500 MG` |
| Form | `TABLET` |

Tap **Find this medication**, switch on each item, then tap **Yes, these details match my label**.
You should see **Possible recall match**, a one-line summary of the records checked, and **Important
limits of this result**.

| Also try | You should see |
| --- | --- |
| Same as above, plus Lot number `JKU4639A` | **Recall match found** |
| NDC `82009-018-10`, `ROSUVASTATIN CALCIUM`, `10 MG`, `TABLET` | **No matching recall found in the FDA records checked** |
| NDC `67046-2072-3`, `WARFARIN SODIUM`, `1 MG`, `TABLET` | **We don't check this medication** |

## 5. Scan a test label

**Yes — you hold the label up to your Mac's camera** (the small lens at the top centre of the
screen). The virtual phone uses it as its back camera, so it only works if you set **Back: Webcam0**
in step 2.

1. **Get a label ready.** Either print a page of `scan-test-labels-SYNTHETIC.pdf`, or open the PDF on
   your phone or tablet, zoom until the label fills the screen, and turn the brightness up.
   **Start with page S6 or S7**: their barcodes are the easiest for a laptop camera.
2. In the app, tap **Scan medication label**. The virtual phone's camera opens and shows what your
   Mac's camera sees.
3. **Hold the label 15–25 cm (6–10 inches) in front of the Mac's camera**, flat and facing it,
   steady, so the label fills most of the picture. Avoid glare from lamps or windows.
4. Click the round **shutter** button on the virtual phone, then the **✓** (accept) button.
5. The app shows "Reading your label on this phone…", then *Is this your medication?*. Check the
   details, switch each item on, and tap **Yes, these details match my label**.

| Page | Expected result |
| --- | --- |
| S6 (bottle with barcode and lot) | Product matched; switch on the lot → **Recall match found** |
| S7 (carton with square 2-D barcode) | Product, lot and expiry from the barcode → **Recall match found** |
| S1 (pharmacy label) | **Possible recall match** |
| S2 (pharmacy label) | **No matching recall found in the FDA records checked** |
| S3 (warfarin) | **We don't check this medication** |

**If it says "We couldn't read your label":** move the label a little closer or farther, hold it
steadier, add light, or try S7. Laptop cameras can't focus up close and have low resolution, so
small printed text often won't read on a Mac even though it reads on a real phone. That's expected;
note it and use typing instead.

**If the camera shows a 3-D room instead of your Mac's camera:** the camera setting didn't apply.
Close the virtual phone, then in **Virtual Device Manager** click the **pencil** next to Pixel 8,
set **Camera → Back: Webcam0** again, click **Finish**, and start it with **▶**.

**If the picture is black:** open **System Settings → Privacy & Security → Camera**, turn on
**Android Studio** (or **qemu**), then restart the virtual phone.

## 6. Tell us what happened

Take a screenshot (**Cmd + Shift + 4**, then drag) and note what you entered or scanned and what the
screen said.

## Other problems

- **"App not installed":** use the **universal** app file.
- **"We couldn't reach FDA's data":** check your internet connection and try again.
- **Windows laptop:** the same steps work. Use the universal file. If the virtual phone won't start,
  the laptop may need "virtualization" turned on — send a screenshot of the message.

When you're done, you can delete Android Studio from Applications like any other app.
