package org.rxrecallcheck.app.scanner.core;

/** Minimal ARGB image (pure Java), shared by the app and the desktop harness. Never written to disk. */
public final class RgbImage {
    public final int width;
    public final int height;
    public final int[] argb;

    public RgbImage(int width, int height, int[] argb) {
        if (argb.length != width * height) throw new IllegalArgumentException("pixel count");
        this.width = width;
        this.height = height;
        this.argb = argb;
    }

    /** Bilinear sample with edge clamping. */
    public int sample(float x, float y) {
        x -= 0.5f;
        y -= 0.5f;
        int x0 = (int) Math.floor(x), y0 = (int) Math.floor(y);
        float fx = x - x0, fy = y - y0;
        int a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
        int r = mix((a >> 16) & 255, (b >> 16) & 255, (c >> 16) & 255, (d >> 16) & 255, fx, fy);
        int g = mix((a >> 8) & 255, (b >> 8) & 255, (c >> 8) & 255, (d >> 8) & 255, fx, fy);
        int bl = mix(a & 255, b & 255, c & 255, d & 255, fx, fy);
        return 0xff000000 | (r << 16) | (g << 8) | bl;
    }

    private int at(int x, int y) {
        x = Math.max(0, Math.min(width - 1, x));
        y = Math.max(0, Math.min(height - 1, y));
        return argb[y * width + x];
    }

    private static int mix(int a, int b, int c, int d, float fx, float fy) {
        float top = a + (b - a) * fx, bot = c + (d - c) * fx;
        return Math.max(0, Math.min(255, Math.round(top + (bot - top) * fy)));
    }

    /** Area-averaged downscale so the long side is at most maxSide (no upscaling). */
    public RgbImage downscale(int maxSide) {
        int m = Math.max(width, height);
        if (m <= maxSide) return this;
        float s = (float) m / maxSide;
        int w = Math.max(1, Math.round(width / s)), h = Math.max(1, Math.round(height / s));
        int[] out = new int[w * h];
        for (int y = 0; y < h; y++) {
            int y0 = (int) (y * s), y1 = Math.max(y0 + 1, Math.min(height, (int) ((y + 1) * s)));
            for (int x = 0; x < w; x++) {
                int x0 = (int) (x * s), x1 = Math.max(x0 + 1, Math.min(width, (int) ((x + 1) * s)));
                long r = 0, g = 0, b = 0, n = 0;
                for (int yy = y0; yy < y1; yy++)
                    for (int xx = x0; xx < x1; xx++) {
                        int p = argb[yy * width + xx];
                        r += (p >> 16) & 255;
                        g += (p >> 8) & 255;
                        b += p & 255;
                        n++;
                    }
                out[y * w + x] = 0xff000000 | (int) (r / n) << 16 | (int) (g / n) << 8 | (int) (b / n);
            }
        }
        return new RgbImage(w, h, out);
    }
}
