package org.rxrecallcheck.app.scanner.core;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.NotFoundException;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.ResultMetadataType;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.multi.GenericMultipleBarcodeReader;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Barcode decoding with ZXing (Apache-2.0, no network code). Pure Java. Returns every symbol found;
 * deciding which ones carry an NDC is done in shared TypeScript (mobile/src/scanner/barcode.ts), so
 * pharmacy Rx-number barcodes are never mistaken for drug codes.
 */
public final class Barcodes {

    public static final class Found {
        public final String format;
        public final String text;
        /** ZXing symbology identifier, e.g. "]d2" for GS1 DataMatrix, "]C1" for GS1-128; may be null. */
        public final String symbology;

        Found(String format, String text, String symbology) {
            this.format = format;
            this.text = text;
            this.symbology = symbology;
        }
    }

    private static final List<BarcodeFormat> FORMATS = Arrays.asList(
            BarcodeFormat.UPC_A, BarcodeFormat.EAN_13, BarcodeFormat.CODE_128, BarcodeFormat.DATA_MATRIX, BarcodeFormat.ITF);

    public static List<Found> decode(RgbImage img) {
        Map<String, Found> out = new LinkedHashMap<>();
        // Full image, then (for small symbols in large photos) a 2x-downscaled copy.
        for (RgbImage candidate : new RgbImage[]{img, img.downscale(Math.max(img.width, img.height) / 2)}) {
            Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
            hints.put(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
            hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
            MultiFormatReader reader = new MultiFormatReader();
            reader.setHints(hints);
            BinaryBitmap bmp = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(candidate.width, candidate.height, candidate.argb)));
            try {
                for (Result r : new GenericMultipleBarcodeReader(reader).decodeMultiple(bmp, hints)) {
                    Object sym = r.getResultMetadata() == null ? null : r.getResultMetadata().get(ResultMetadataType.SYMBOLOGY_IDENTIFIER);
                    String key = r.getBarcodeFormat() + ":" + r.getText();
                    out.putIfAbsent(key, new Found(r.getBarcodeFormat().name(), r.getText(), sym == null ? null : sym.toString()));
                }
            } catch (NotFoundException e) {
                // nothing in this candidate
            }
            if (!out.isEmpty()) break;
        }
        return new ArrayList<>(out.values());
    }

    private Barcodes() {}
}
