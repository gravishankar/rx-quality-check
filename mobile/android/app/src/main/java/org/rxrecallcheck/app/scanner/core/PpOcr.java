package org.rxrecallcheck.app.scanner.core;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * On-device text recognition with PaddleOCR PP-OCRv3 models (Apache-2.0) on ONNX Runtime (MIT).
 *
 * Pure Java (no Android classes) so the identical code runs in the app and in the desktop
 * evaluation harness (scripts/scanner_lab). Pipeline:
 *   1. Text detection (DB model): probability map -> connected components -> minimum-area
 *      rotated rectangles -> unclip.
 *   2. Each rectangle is cropped with a perspective-free rotated sampler and recognized
 *      (CRNN/SVTR model) with greedy CTC decoding.
 * No network access; models and dictionary are supplied by the caller (app assets).
 */
public final class PpOcr implements AutoCloseable {

    public static final class Line {
        public final String text;
        public final float score;
        /** Corner points (x0,y0,x1,y1,x2,y2,x3,y3) in input-image pixels, clockwise from top-left. */
        public final float[] box;

        Line(String text, float score, float[] box) {
            this.text = text;
            this.score = score;
            this.box = box;
        }
    }

    public static final class Result {
        public final List<Line> lines;
        public final long detMs;
        public final long recMs;

        Result(List<Line> lines, long detMs, long recMs) {
            this.lines = lines;
            this.detMs = detMs;
            this.recMs = recMs;
        }
    }

    // Parameters as published for PP-OCRv3 (RapidOCR defaults), except the detector input size,
    // which is limited on the long side for phone speed.
    private static final float[] DET_MEAN = {0.485f, 0.456f, 0.406f};
    private static final float[] DET_STD = {0.229f, 0.224f, 0.225f};
    private static final float BIN_THRESH = 0.3f;
    private static final float BOX_THRESH = 0.5f;
    private static final float UNCLIP_RATIO = 1.6f;
    private static final int REC_H = 48;
    private static final int REC_MAX_W = 960;
    private static final float TEXT_SCORE = 0.5f;

    private final OrtEnvironment env;
    private final OrtSession det;
    private final OrtSession rec;
    private final String[] dict; // index i -> character for class i+1; last class is space
    private final int detMaxSide;

    public PpOcr(byte[] detModel, byte[] recModel, List<String> dictionary, int detMaxSide) throws OrtException {
        this.env = OrtEnvironment.getEnvironment();
        OrtSession.SessionOptions o = new OrtSession.SessionOptions();
        o.setIntraOpNumThreads(Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors())));
        this.det = env.createSession(detModel, o);
        this.rec = env.createSession(recModel, o);
        List<String> d = new ArrayList<>(dictionary);
        d.add(" ");
        this.dict = d.toArray(new String[0]);
        this.detMaxSide = detMaxSide;
    }

    public Result recognize(RgbImage img) throws OrtException {
        long t0 = System.nanoTime();
        List<float[]> boxes = detect(img);
        long t1 = System.nanoTime();
        List<Line> lines = new ArrayList<>();
        for (float[] b : boxes) {
            RgbImage crop = cropRotated(img, b);
            if (crop == null) continue;
            String[] out = new String[1];
            float score = recognizeCrop(crop, out);
            if (score >= TEXT_SCORE && !out[0].trim().isEmpty()) lines.add(new Line(out[0], score, b));
        }
        long t2 = System.nanoTime();
        sortReadingOrder(lines);
        return new Result(lines, (t1 - t0) / 1_000_000, (t2 - t1) / 1_000_000);
    }

    // ------------------------------------------------------------------ detection

    private List<float[]> detect(RgbImage img) throws OrtException {
        float scale = Math.min(1f, (float) detMaxSide / Math.max(img.width, img.height));
        int w = Math.max(32, Math.round(img.width * scale / 32f) * 32);
        int h = Math.max(32, Math.round(img.height * scale / 32f) * 32);
        float sx = (float) img.width / w;
        float sy = (float) img.height / h;
        float[] input = new float[3 * w * h];
        int plane = w * h;
        for (int y = 0; y < h; y++) {
            int syy = Math.min(img.height - 1, (int) (y * sy));
            for (int x = 0; x < w; x++) {
                int p = img.argb[syy * img.width + Math.min(img.width - 1, (int) (x * sx))];
                float r = ((p >> 16) & 255) / 255f, g = ((p >> 8) & 255) / 255f, bl = (p & 255) / 255f;
                int i = y * w + x;
                // BGR channel order, as the models were trained with OpenCV-loaded images.
                input[i] = (bl - DET_MEAN[0]) / DET_STD[0];
                input[plane + i] = (g - DET_MEAN[1]) / DET_STD[1];
                input[2 * plane + i] = (r - DET_MEAN[2]) / DET_STD[2];
            }
        }
        float[] prob;
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(input), new long[]{1, 3, h, w});
             OrtSession.Result r = det.run(Collections.singletonMap(det.getInputNames().iterator().next(), t))) {
            float[][][][] out = (float[][][][]) r.get(0).getValue();
            prob = new float[w * h];
            for (int y = 0; y < h; y++) System.arraycopy(out[0][0][y], 0, prob, y * w, w);
        }
        // Binarize + 2x2 dilation.
        boolean[] bin = new boolean[w * h];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) {
                boolean on = false;
                for (int dy = 0; dy <= 1 && !on; dy++)
                    for (int dx = 0; dx <= 1 && !on; dx++) {
                        int yy = y - dy, xx = x - dx;
                        if (yy >= 0 && xx >= 0 && prob[yy * w + xx] > BIN_THRESH) on = true;
                    }
                bin[y * w + x] = on;
            }
        List<float[]> boxes = new ArrayList<>();
        int[] label = new int[w * h];
        int[] stack = new int[w * h];
        int next = 0;
        for (int start = 0; start < w * h; start++) {
            if (!bin[start] || label[start] != 0) continue;
            next++;
            int sp = 0;
            stack[sp++] = start;
            label[start] = next;
            List<int[]> pts = new ArrayList<>();
            double sum = 0;
            while (sp > 0) {
                int i = stack[--sp];
                int x = i % w, y = i / w;
                pts.add(new int[]{x, y});
                sum += prob[i];
                for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++) {
                        int xx = x + dx, yy = y + dy;
                        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                        int j = yy * w + xx;
                        if (bin[j] && label[j] == 0) {
                            label[j] = next;
                            stack[sp++] = j;
                        }
                    }
            }
            if (pts.size() < 10) continue;
            if (sum / pts.size() < BOX_THRESH) continue;
            float[] rect = minAreaRect(convexHull(pts));
            if (rect == null) continue;
            float[] un = unclip(rect);
            if (Math.min(side(un, 0, 1), side(un, 1, 2)) < 3) continue;
            for (int k = 0; k < 4; k++) {
                un[2 * k] = Math.max(0, Math.min(img.width - 1, un[2 * k] * sx));
                un[2 * k + 1] = Math.max(0, Math.min(img.height - 1, un[2 * k + 1] * sy));
            }
            boxes.add(un);
        }
        return boxes;
    }

    private static List<int[]> convexHull(List<int[]> pts) {
        // Monotone chain on pixel corners (each pixel contributes its 4 corners for tight boxes).
        List<int[]> p = new ArrayList<>(pts.size() * 2);
        for (int[] q : pts) {
            p.add(new int[]{q[0], q[1]});
            p.add(new int[]{q[0] + 1, q[1] + 1});
            p.add(new int[]{q[0] + 1, q[1]});
            p.add(new int[]{q[0], q[1] + 1});
        }
        p.sort((a, b) -> a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));
        int n = p.size();
        int[][] h = new int[2 * n][];
        int k = 0;
        for (int i = 0; i < n; i++) {
            while (k >= 2 && cross(h[k - 2], h[k - 1], p.get(i)) <= 0) k--;
            h[k++] = p.get(i);
        }
        for (int i = n - 2, t = k + 1; i >= 0; i--) {
            while (k >= t && cross(h[k - 2], h[k - 1], p.get(i)) <= 0) k--;
            h[k++] = p.get(i);
        }
        List<int[]> out = new ArrayList<>();
        for (int i = 0; i < k - 1; i++) out.add(h[i]);
        return out;
    }

    private static long cross(int[] o, int[] a, int[] b) {
        return (long) (a[0] - o[0]) * (b[1] - o[1]) - (long) (a[1] - o[1]) * (b[0] - o[0]);
    }

    /** Minimum-area enclosing rectangle by rotating calipers; returns 4 corners. */
    private static float[] minAreaRect(List<int[]> hull) {
        int n = hull.size();
        if (n < 3) return null;
        double best = Double.MAX_VALUE;
        float[] bestRect = null;
        for (int i = 0; i < n; i++) {
            int[] a = hull.get(i), b = hull.get((i + 1) % n);
            double ex = b[0] - a[0], ey = b[1] - a[1];
            double len = Math.hypot(ex, ey);
            if (len == 0) continue;
            ex /= len;
            ey /= len;
            double minU = Double.MAX_VALUE, maxU = -Double.MAX_VALUE, minV = Double.MAX_VALUE, maxV = -Double.MAX_VALUE;
            for (int[] q : hull) {
                double u = q[0] * ex + q[1] * ey, v = -q[0] * ey + q[1] * ex;
                minU = Math.min(minU, u);
                maxU = Math.max(maxU, u);
                minV = Math.min(minV, v);
                maxV = Math.max(maxV, v);
            }
            double area = (maxU - minU) * (maxV - minV);
            if (area < best) {
                best = area;
                double[][] c = {{minU, minV}, {maxU, minV}, {maxU, maxV}, {minU, maxV}};
                bestRect = new float[8];
                for (int j = 0; j < 4; j++) {
                    bestRect[2 * j] = (float) (c[j][0] * ex - c[j][1] * ey);
                    bestRect[2 * j + 1] = (float) (c[j][0] * ey + c[j][1] * ex);
                }
            }
        }
        return orderClockwise(bestRect);
    }

    /** Order corners: top-left, top-right, bottom-right, bottom-left, with the long side horizontal when possible. */
    private static float[] orderClockwise(float[] r) {
        if (r == null) return null;
        float cx = 0, cy = 0;
        for (int i = 0; i < 4; i++) {
            cx += r[2 * i] / 4;
            cy += r[2 * i + 1] / 4;
        }
        Integer[] idx = {0, 1, 2, 3};
        final float fcx = cx, fcy = cy;
        java.util.Arrays.sort(idx, (a, b) -> Double.compare(Math.atan2(r[2 * a + 1] - fcy, r[2 * a] - fcx), Math.atan2(r[2 * b + 1] - fcy, r[2 * b] - fcx)));
        // atan2 order runs clockwise in image coordinates starting from the left-top quadrant.
        int start = 0;
        double bestSum = Double.MAX_VALUE;
        for (int i = 0; i < 4; i++) {
            double s = r[2 * idx[i]] + r[2 * idx[i] + 1];
            if (s < bestSum) {
                bestSum = s;
                start = i;
            }
        }
        float[] o = new float[8];
        for (int i = 0; i < 4; i++) {
            int j = idx[(start + i) % 4];
            o[2 * i] = r[2 * j];
            o[2 * i + 1] = r[2 * j + 1];
        }
        return o;
    }

    private static float side(float[] r, int a, int b) {
        return (float) Math.hypot(r[2 * a] - r[2 * b], r[2 * a + 1] - r[2 * b + 1]);
    }

    private static float[] unclip(float[] r) {
        float w = side(r, 0, 1), h = side(r, 1, 2);
        float d = w * h * UNCLIP_RATIO / (2 * (w + h));
        float cx = 0, cy = 0;
        for (int i = 0; i < 4; i++) {
            cx += r[2 * i] / 4;
            cy += r[2 * i + 1] / 4;
        }
        // Expand along the rectangle's own axes.
        float ux = (r[2] - r[0]) / Math.max(w, 1e-3f), uy = (r[3] - r[1]) / Math.max(w, 1e-3f);
        float vx = (r[6] - r[0]) / Math.max(h, 1e-3f), vy = (r[7] - r[1]) / Math.max(h, 1e-3f);
        float hw = w / 2 + d, hh = h / 2 + d;
        return new float[]{
                cx - ux * hw - vx * hh, cy - uy * hw - vy * hh,
                cx + ux * hw - vx * hh, cy + uy * hw - vy * hh,
                cx + ux * hw + vx * hh, cy + uy * hw + vy * hh,
                cx - ux * hw + vx * hh, cy - uy * hw + vy * hh};
    }

    // ------------------------------------------------------------------ recognition

    private static RgbImage cropRotated(RgbImage img, float[] b) {
        float w = side(b, 0, 1), h = side(b, 1, 2);
        if (w < 2 || h < 2) return null;
        boolean vertical = h > w * 1.5f;
        float[] q = b;
        if (vertical) { // rotate so the text runs horizontally
            q = new float[]{b[6], b[7], b[0], b[1], b[2], b[3], b[4], b[5]};
            float t = w;
            w = h;
            h = t;
        }
        int outW = Math.max(1, Math.round(w)), outH = Math.max(1, Math.round(h));
        int[] px = new int[outW * outH];
        for (int y = 0; y < outH; y++) {
            float v = (y + 0.5f) / outH;
            for (int x = 0; x < outW; x++) {
                float u = (x + 0.5f) / outW;
                // Bilinear interpolation of the quad corners -> source position.
                float sxp = (1 - u) * (1 - v) * q[0] + u * (1 - v) * q[2] + u * v * q[4] + (1 - u) * v * q[6];
                float syp = (1 - u) * (1 - v) * q[1] + u * (1 - v) * q[3] + u * v * q[5] + (1 - u) * v * q[7];
                px[y * outW + x] = img.sample(sxp, syp);
            }
        }
        return new RgbImage(outW, outH, px);
    }

    private float recognizeCrop(RgbImage crop, String[] out) throws OrtException {
        int w = Math.max(REC_H / 4, Math.min(REC_MAX_W, Math.round(crop.width * (float) REC_H / crop.height)));
        float sx = (float) crop.width / w, sy = (float) crop.height / REC_H;
        float[] input = new float[3 * REC_H * w];
        int plane = REC_H * w;
        for (int y = 0; y < REC_H; y++)
            for (int x = 0; x < w; x++) {
                int p = crop.sample(x * sx + sx / 2, y * sy + sy / 2);
                float r = ((p >> 16) & 255) / 255f, g = ((p >> 8) & 255) / 255f, bl = (p & 255) / 255f;
                int i = y * w + x;
                input[i] = (bl - 0.5f) / 0.5f;
                input[plane + i] = (g - 0.5f) / 0.5f;
                input[2 * plane + i] = (r - 0.5f) / 0.5f;
            }
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(input), new long[]{1, 3, REC_H, w});
             OrtSession.Result r = rec.run(Collections.singletonMap(rec.getInputNames().iterator().next(), t))) {
            float[][][] o = (float[][][]) r.get(0).getValue();
            StringBuilder sb = new StringBuilder();
            int prev = -1;
            double sum = 0;
            int n = 0;
            for (float[] step : o[0]) {
                int best = 0;
                for (int c = 1; c < step.length; c++) if (step[c] > step[best]) best = c;
                if (best != 0 && best != prev && best - 1 < dict.length) {
                    sb.append(dict[best - 1]);
                    sum += step[best];
                    n++;
                }
                prev = best;
            }
            out[0] = sb.toString();
            return n == 0 ? 0f : (float) (sum / n);
        }
    }

    // ------------------------------------------------------------------ ordering

    private static void sortReadingOrder(List<Line> lines) {
        lines.sort((a, b) -> {
            float ay = (a.box[1] + a.box[7]) / 2, by = (b.box[1] + b.box[7]) / 2;
            float ah = Math.abs(a.box[7] - a.box[1]);
            if (Math.abs(ay - by) > ah * 0.5f) return Float.compare(ay, by);
            return Float.compare(a.box[0], b.box[0]);
        });
    }

    /** Model metadata helper: PP-OCR ONNX recognition models embed their character list. */
    public static List<String> dictionaryFromMetadata(byte[] recModel) throws OrtException {
        OrtEnvironment e = OrtEnvironment.getEnvironment();
        try (OrtSession s = e.createSession(recModel, new OrtSession.SessionOptions())) {
            Map<String, String> m = s.getMetadata().getCustomMetadata();
            String chars = m.get("character");
            List<String> out = new ArrayList<>();
            if (chars != null) for (String c : chars.split("\n", -1)) if (!c.isEmpty()) out.add(c);
            return out;
        }
    }

    @Override
    public void close() throws OrtException {
        det.close();
        rec.close();
    }
}
