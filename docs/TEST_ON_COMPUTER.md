# Try MedLuma (DEV) on a Mac or Windows Laptop

No Android phone needed. You'll run a free "virtual Android phone" in a window on your computer.
It takes about 30–45 minutes the first time, mostly waiting for downloads.

Use only the test medications listed below. Never enter your own medication or personal details.
This is a test version (not clinically validated). The owner has used this setup on a laptop: typing the
details worked as expected. Please tell us if something looks different.

## 1. Get the app file

Download the file the owner shared with you:

- **Mac with an Apple chip (M1, M2, M3, M4):** `medluma-dev-v0.1.6-b7-arm64-v8a.apk`
- **Any other Mac, or a Windows laptop:** `medluma-dev-v0.1.6-b7-universal.apk`

Not sure which Mac you have? Apple menu → **About This Mac** → "Chip: Apple M…" means an Apple chip.

## 2. Install Android Studio

1. Go to **developer.android.com/studio** and click **Download**.
2. Install it like any other app, then open it.
3. When it asks, choose **Standard** and click **Next / Accept / Finish** until it's done downloading.
   No account or sign-in needed.

## 3. Start a virtual phone

1. On the welcome window, click **More Actions → Virtual Device Manager**.
2. Click **+**, choose **Pixel 8**, click **Next**, keep the suggested Android version (click the
   download arrow if shown), click **Next**, then **Finish**.
3. Click **▶** next to the phone. A phone appears on your screen (the first start takes a few minutes).

## 4. Install the app

Drag the app file from your **Downloads** folder onto the virtual phone. After about 30 seconds,
swipe up on the phone's home screen and open **MedLuma (DEV)**.

## 5. Try it

1. Tap **I understand**.
2. Tap **Type the details instead** and enter:

   | Field | Type |
   |---|---|
   | NDC | `62756-142-02` |
   | Drug name | `METFORMIN HCL ER` |
   | Strength | `500 MG` |
   | Form | `TABLET` |

3. Tap **Find this medication**, switch on each item, then tap **Yes, these details match my label**.
4. You should see **Possible recall match**, a one-line summary of the records checked, and
   **Important limits of this result**.

More to try:

| Enter | You should see |
|---|---|
| Same as above, plus Lot number `JKU4639A` | **Recall match found** |
| NDC `82009-018-10`, `ROSUVASTATIN CALCIUM`, `10 MG`, `TABLET` | **No matching recall found in the FDA records checked** |
| NDC `67046-2072-3`, `WARFARIN SODIUM`, `1 MG`, `TABLET` | **We don't check this medication** |

On each result, try **Show these … records** and **Official FDA record**.

Scanning with your laptop's camera usually can't read small labels. Typing the details is the way to
test on a computer.

## 6. Tell us what happened

Take a screenshot (Mac: **Cmd + Shift + 4**; Windows: **Win + Shift + S**) and note:

- what you entered and what the screen said
- Mac or Windows

## If something goes wrong

- **The virtual phone won't start (Windows):** your laptop may need a setting called
  "virtualization" turned on. Send a screenshot of the message and we'll help.
- **"App not installed":** you probably have the wrong file. Use the **universal** file.
- **"We couldn't reach FDA's data":** check your internet connection and try again.

When you're done, you can uninstall Android Studio like any other app.
