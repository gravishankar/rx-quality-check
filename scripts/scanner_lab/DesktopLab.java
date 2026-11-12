import org.rxrecallcheck.app.scanner.core.PpOcr;
import org.rxrecallcheck.app.scanner.core.RgbImage;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.file.Files;
import java.util.List;

/**
 * Desktop harness for the app's Java OCR core (same source files as the APK). Runs the PP-OCR
 * pipeline on each image and prints one JSON object per image (JSON Lines). Barcodes are evaluated
 * with ZXing-cpp in bakeoff.py (the same C++ engine as the app's Android library).
 *   java -cp <onnxruntime.jar>:<classes> DesktopLab <models_dir> <images_dir> [detMaxSide]
 */
public class DesktopLab {
    public static void main(String[] a) throws Exception {
        File models = new File(a[0]);
        byte[] det = Files.readAllBytes(new File(models, "ch_PP-OCRv3_det_infer.onnx").toPath());
        byte[] rec = Files.readAllBytes(new File(models, "ch_PP-OCRv3_rec_infer.onnx").toPath());
        int detMax = a.length > 2 ? Integer.parseInt(a[2]) : 960;
        List<String> dict = PpOcr.dictionaryFromMetadata(rec);
        try (PpOcr ocr = new PpOcr(det, rec, dict, detMax)) {
            File[] files = new File(a[1]).listFiles((d, n) -> n.endsWith(".jpg"));
            java.util.Arrays.sort(files);
            boolean warm = false;
            for (File f : files) {
                BufferedImage bi = ImageIO.read(f);
                int w = bi.getWidth(), h = bi.getHeight();
                RgbImage img = new RgbImage(w, h, bi.getRGB(0, 0, w, h, null, 0, w)).downscale(1600);
                if (!warm) {
                    ocr.recognize(img);
                    warm = true;
                }
                long t0 = System.nanoTime();
                PpOcr.Result r = ocr.recognize(img);
                long t1 = System.nanoTime();
                StringBuilder sb = new StringBuilder();
                sb.append("{\"file\":").append(q(f.getName())).append(",\"ocr_ms\":").append((t1 - t0) / 1_000_000)
                        .append(",\"det_ms\":").append(r.detMs).append(",\"rec_ms\":").append(r.recMs).append(",\"lines\":[");
                for (int i = 0; i < r.lines.size(); i++) {
                    PpOcr.Line l = r.lines.get(i);
                    if (i > 0) sb.append(',');
                    sb.append("{\"text\":").append(q(l.text)).append(",\"score\":").append(l.score).append(",\"box\":[");
                    for (int k = 0; k < 8; k++) {
                        if (k > 0) sb.append(',');
                        sb.append(Math.round(l.box[k]));
                    }
                    sb.append("]}");
                }
                sb.append("]}");
                System.out.println(sb);
            }
        }
    }

    static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20 || c > 0x7e) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
