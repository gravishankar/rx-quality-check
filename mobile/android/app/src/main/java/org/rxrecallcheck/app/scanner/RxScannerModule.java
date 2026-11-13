package org.rxrecallcheck.app.scanner;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.MediaStore;

import androidx.core.content.FileProvider;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import org.rxrecallcheck.app.scanner.core.PpOcr;
import org.rxrecallcheck.app.scanner.core.RgbImage;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.security.SecureRandom;
import java.util.EnumSet;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import zxingcpp.BarcodeReader;

/**
 * On-device label scanning (Task 4C). Privacy rules:
 *  - The photo is taken by the phone's camera app (a separate app, outside this app's control; some
 *    camera apps may keep their own copy) into a private, app-only cache file shared through a
 *    FileProvider grant for that one file. The grant is revoked when the camera returns; the file is
 *    read once and deleted (deletion checked; emptied if it cannot be deleted) on success, cancel,
 *    launch failure and analysis failure; leftovers from an interrupted process are removed at start.
 *  - Text recognition (PaddleOCR PP-OCRv4 on ONNX Runtime) and barcode decoding (ZXing-cpp) run on
 *    the phone. This module has no network code; the image and the recognized text never leave it
 *    except as the returned lines/barcodes to the app's JavaScript.
 *  - Nothing is logged.
 */
public final class RxScannerModule extends ReactContextBaseJavaModule {
    public static final String NAME = "RxScanner";
    private static final int REQUEST = 4243;
    // Text is recognized from crops of this image; the detector works on a smaller copy (DET_MAX_SIDE).
    // 1600 (builds 4-5) left a pharmacy vial's small print ~15 px tall in a phone photo; 3200 reads it.
    private static final int MAX_SIDE = 3200;
    private static final int DET_MAX_SIDE = 960;
    private int dictSize = -1;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Promise pending;
    private File pendingFile;
    private Uri pendingUri;
    /** A photo from an earlier, interrupted scan that could not be removed (review round 2, issue 5). */
    private boolean leftoverRemaining;
    private PpOcr ocr;
    private long initMs = -1;

    public RxScannerModule(ReactApplicationContext ctx) {
        super(ctx);
        ctx.addActivityEventListener(new BaseActivityEventListener() {
            @Override
            public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
                if (requestCode != REQUEST || pending == null) return;
                final Promise p = pending;
                final File f = pendingFile;
                final Uri u = pendingUri;
                pending = null;
                pendingFile = null;
                pendingUri = null;
                // The camera app's write access ends as soon as it returns (review item 8).
                revokeGrant(activity, u);
                if (resultCode != Activity.RESULT_OK) {
                    // Cancelled: the app offers manual entry. A photo that could not be removed is reported.
                    if (deletePhoto(f) && !leftoverRemaining) {
                        p.resolve(null);
                    } else {
                        WritableMap c = Arguments.createMap();
                        c.putBoolean("cancelled", true);
                        c.putBoolean("photoDeleted", false);
                        p.resolve(c);
                    }
                    return;
                }
                worker.execute(() -> analyze(f, p));
            }
        });
        leftoverRemaining = !clearScanCache();
    }

    @Override
    public String getName() {
        return NAME;
    }

    /** Take a photo with the phone's camera app and read it. Resolves null if the user cancels. */
    @ReactMethod
    public void scanLabel(Promise promise) {
        Activity activity = getReactApplicationContext().getCurrentActivity();
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Scanning is not available right now.");
            return;
        }
        if (pending != null) {
            promise.reject("BUSY", "A scan is already in progress.");
            return;
        }
        // No scan is pending here, so leftovers from an interrupted scan can be retried safely.
        leftoverRemaining = !clearScanCache();
        try {
            File dir = new File(getReactApplicationContext().getCacheDir(), "scans");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cache");
            byte[] r = new byte[8];
            new SecureRandom().nextBytes(r);
            StringBuilder name = new StringBuilder("scan-");
            for (byte b : r) name.append(String.format("%02x", b));
            File f = new File(dir, name + ".jpg");
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".scanprovider", f);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, uri);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            pending = promise;
            pendingFile = f;
            pendingUri = uri;
            activity.startActivityForResult(i, REQUEST);
        } catch (ActivityNotFoundException e) {
            rejectWithPhoto(promise, "NO_CAMERA_APP", "No camera app is available on this phone.", cleanUpFailedLaunch(activity) && !leftoverRemaining);
        } catch (Exception e) {
            rejectWithPhoto(promise, "SCAN_FAILED", "The camera could not be opened.", cleanUpFailedLaunch(activity) && !leftoverRemaining);
        }
    }

    private void analyze(File f, Promise p) {
        long t0 = System.nanoTime();
        try {
            RgbImage img = load(f);
            // The pixels are in memory now; the file is removed and the outcome reported to the app.
            final boolean gone = deletePhoto(f) && !leftoverRemaining;
            if (img == null) {
                rejectWithPhoto(p, "UNREADABLE", "The photo could not be read.", gone);
                return;
            }
            // Text and barcodes are read independently: a failure in one never discards the other.
            WritableArray warnings = Arguments.createArray();
            long tOcr0 = System.nanoTime();
            WritableArray lines = Arguments.createArray();
            int lineCount = 0;
            WritableMap ocrStats = Arguments.createMap();
            try {
                PpOcr.Result r = engine().recognize(img);
                // Counts only (no text): lets a development build show why nothing was read.
                ocrStats.putInt("regions", r.regions);
                ocrStats.putInt("droppedEmpty", r.droppedEmpty);
                ocrStats.putInt("droppedLowScore", r.droppedLowScore);
                ocrStats.putInt("dictionary", dictSize);
                for (PpOcr.Line l : r.lines) {
                    WritableMap m = Arguments.createMap();
                    m.putString("text", l.text);
                    m.putDouble("score", l.score);
                    lines.pushMap(m);
                    lineCount++;
                }
            } catch (Throwable e) {
                warnings.pushString("TEXT_FAILED: " + describe(e));
            }
            long tOcr1 = System.nanoTime();
            WritableArray codes = Arguments.createArray();
            int codeCount = 0;
            try {
                Bitmap bmp = Bitmap.createBitmap(img.argb, img.width, img.height, Bitmap.Config.ARGB_8888);
                BarcodeReader.Options opts = new BarcodeReader.Options();
                opts.setFormats(EnumSet.of(BarcodeReader.Format.UPC_A, BarcodeReader.Format.EAN_13, BarcodeReader.Format.CODE_128, BarcodeReader.Format.DATA_MATRIX));
                opts.setTryHarder(true);
                opts.setTryRotate(true);
                opts.setTryDownscale(true);
                // The Kotlin API requires a non-null crop rectangle (a null one throws): use the whole image.
                List<BarcodeReader.Result> found = new BarcodeReader(opts).read(bmp, new Rect(0, 0, img.width, img.height), 0);
                bmp.recycle();
                for (BarcodeReader.Result b : found) {
                    if (b.getText() == null) continue;
                    WritableMap m = Arguments.createMap();
                    m.putString("format", b.getFormat().name());
                    m.putString("text", b.getText());
                    m.putString("symbology", b.getSymbologyIdentifier());
                    codes.pushMap(m);
                    codeCount++;
                }
            } catch (Throwable e) {
                warnings.pushString("BARCODE_FAILED: " + describe(e));
            }
            if (lineCount == 0 && codeCount == 0 && warnings.size() > 0) {
                rejectWithPhoto(p, "SCAN_FAILED", warnings.getString(0), gone);
                return;
            }
            long t1 = System.nanoTime();
            WritableMap out = Arguments.createMap();
            out.putArray("lines", lines);
            out.putArray("barcodes", codes);
            WritableMap timings = Arguments.createMap();
            timings.putDouble("ocrMs", (tOcr1 - tOcr0) / 1e6);
            timings.putDouble("barcodeMs", (t1 - tOcr1) / 1e6);
            timings.putDouble("totalMs", (t1 - t0) / 1e6);
            timings.putDouble("modelLoadMs", initMs);
            out.putMap("timings", timings);
            WritableMap size = Arguments.createMap();
            size.putInt("width", img.width);
            size.putInt("height", img.height);
            out.putMap("image", size);
            out.putArray("warnings", warnings);
            out.putMap("ocrStats", ocrStats);
            out.putBoolean("photoDeleted", gone);
            p.resolve(out);
        } catch (Throwable e) {
            rejectWithPhoto(p, "SCAN_FAILED", describe(e), deletePhoto(f) && !leftoverRemaining);
        }
    }

    /**
     * Reject, telling the app whether the label photo storage is clean (review rounds 2 and 3): the
     * current photo removed AND no leftover from an earlier, interrupted scan remaining.
     */
    private static void rejectWithPhoto(Promise p, String code, String message, boolean photoDeleted) {
        WritableMap info = Arguments.createMap();
        info.putBoolean("photoDeleted", photoDeleted);
        p.reject(code, message, info);
    }

    /**
     * Technical description of a failure for development diagnostics: exception type, message and
     * the first stack frame. Contains no label content (the engines' messages do not echo input text).
     */
    private static String describe(Throwable e) {
        StackTraceElement[] st = e.getStackTrace();
        String where = st.length > 0 ? " at " + st[0].getClassName() + "." + st[0].getMethodName() + ":" + st[0].getLineNumber() : "";
        String msg = e.getMessage() == null ? "" : e.getMessage();
        if (msg.length() > 160) msg = msg.substring(0, 160);
        return e.getClass().getSimpleName() + (msg.isEmpty() ? "" : ": " + msg) + where;
    }

    private synchronized PpOcr engine() throws Exception {
        if (ocr == null) {
            long t0 = System.nanoTime();
            byte[] det = asset("ocr/ppocrv4_det_w8.onnx");
            byte[] rec = asset("ocr/ppocrv4_rec_latin.onnx");
            java.util.List<String> dict = PpOcr.dictionaryFromModelBytes(rec);
            dictSize = dict.size();
            ocr = new PpOcr(det, rec, dict, DET_MAX_SIDE);
            initMs = (System.nanoTime() - t0) / 1_000_000;
        }
        return ocr;
    }

    private byte[] asset(String path) throws Exception {
        try (InputStream in = getReactApplicationContext().getAssets().open(path); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    /** Decode with subsampling, apply EXIF rotation, downscale to MAX_SIDE. */
    private static RgbImage load(File f) throws Exception {
        if (f == null || !f.exists() || f.length() == 0) return null;
        BitmapFactory.Options b = new BitmapFactory.Options();
        b.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(f.getPath(), b);
        int sample = 1;
        while (Math.max(b.outWidth, b.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2;
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = sample;
        Bitmap bmp = BitmapFactory.decodeFile(f.getPath(), o);
        if (bmp == null) return null;
        int rotation;
        switch (new ExifInterface(f.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            case ExifInterface.ORIENTATION_ROTATE_90: rotation = 90; break;
            case ExifInterface.ORIENTATION_ROTATE_180: rotation = 180; break;
            case ExifInterface.ORIENTATION_ROTATE_270: rotation = 270; break;
            default: rotation = 0;
        }
        if (rotation != 0) {
            Matrix m = new Matrix();
            m.postRotate(rotation);
            Bitmap r = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
            bmp.recycle();
            bmp = r;
        }
        // Scale in the Bitmap first so only one full-size pixel array is ever held.
        int longSide = Math.max(bmp.getWidth(), bmp.getHeight());
        if (longSide > MAX_SIDE) {
            float s = (float) MAX_SIDE / longSide;
            Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(bmp.getWidth() * s)), Math.max(1, Math.round(bmp.getHeight() * s)), true);
            if (scaled != bmp) bmp.recycle();
            bmp = scaled;
        }
        int w = bmp.getWidth(), h = bmp.getHeight();
        int[] px = new int[w * h];
        bmp.getPixels(px, 0, w, 0, 0, w, h);
        bmp.recycle();
        return new RgbImage(w, h, px).downscale(MAX_SIDE);
    }

    /** Remove leftover photos; returns whether none remain. */
    private boolean clearScanCache() {
        File dir = new File(getReactApplicationContext().getCacheDir(), "scans");
        File[] files = dir.listFiles();
        boolean ok = true;
        if (files != null) for (File f : files) ok &= deletePhoto(f);
        return ok;
    }

    /** Launch failed: nothing was taken, but remove any file and grant that may exist. Returns whether the photo file is gone. */
    private boolean cleanUpFailedLaunch(Activity activity) {
        File f = pendingFile;
        Uri u = pendingUri;
        pending = null;
        pendingFile = null;
        pendingUri = null;
        revokeGrant(activity, u);
        return deletePhoto(f);
    }

    private static void revokeGrant(Activity activity, Uri u) {
        if (activity == null || u == null) return;
        try {
            activity.revokeUriPermission(u, Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (RuntimeException ignored) {
            // nothing granted, or already revoked
        }
    }

    /**
     * Delete a label photo and check that it is gone (review item 8). If deletion fails, the file is
     * emptied so no image remains, and it is removed again at the next start (clearScanCache).
     * Returns whether the photo is gone.
     */
    private static boolean deletePhoto(File f) {
        if (f == null || !f.exists()) return true;
        if (f.delete() || !f.exists()) return true;
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(f, false)) {
            out.getChannel().truncate(0);
        } catch (java.io.IOException ignored) {
            // could not empty it either; the next start tries again
        }
        f.deleteOnExit();
        return !f.exists() || f.length() == 0;
    }
}
