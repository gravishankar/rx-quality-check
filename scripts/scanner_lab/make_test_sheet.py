#!/usr/bin/env python3
"""
Printable / on-screen test sheet of SYNTHETIC labels for the Pixel scan test (Task 4C).
One label per page with its expected outcome. Drug codes are real public NDCs; every person,
pharmacy and number on the pharmacy labels is SYNTHETIC. Not committed (output path argument).

  python3 scripts/scanner_lab/make_test_sheet.py <out.pdf>
"""
import random
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, __import__("os").path.dirname(__file__))
import generate_labels as g  # noqa: E402

CASES = [
    ("S1", "pharmacy", 0, "11h", "Pharmacy label, metformin ER (NDC printed)", "Product matched in FDA records (NDC 62756-142-02). After confirming: 'Possible recall match' (no lot on a pharmacy label)."),
    ("S2", "pharmacy", 1, "10h", "Pharmacy label, rosuvastatin (NDC printed)", "Product matched in FDA records (82009-018-10). After confirming: 'No match in the records checked' with the date (or a newer FDA result)."),
    ("S3", "pharmacy", 2, "11u", "Pharmacy label, warfarin (NDC printed)", "'We don't check this medication' (excluded by policy). No recall check."),
    ("S4", "pharmacy_nondc", 0, None, "Pharmacy label without NDC, metformin ER", "Fields shown as 'Read from your label'; product not identified; result 'Possible recall match' at ingredient level."),
    ("S5", "pharmacy", 5, "10h", "Pharmacy label, sertraline", "'Not covered by this version of the app.' No recall check."),
    ("S6", "stock", 0, None, "Manufacturer bottle, metformin ER, lot JKU4639A, UPC barcode", "Product matched; lot read from label; after you confirm the lot: 'Recall match found' (D-0325-2021)."),
    ("S7", "carton", 0, None, "Carton with GS1 DataMatrix, metformin ER", "Product, lot and expiry read from the 2D barcode; after confirming: 'Recall match found'."),
]


def main(out):
    rnd = random.Random(7)
    pages = []
    font = ImageFont.truetype(g.FONTS["sansb"], 34)
    small = ImageFont.truetype(g.FONTS["sans"], 26)
    for cid, kind, idx, style, title, expect in CASES:
        d = g.DRUGS[idx]
        if kind == "pharmacy":
            im, _ = g.pharmacy_label(d, rnd, style)
        elif kind == "pharmacy_nondc":
            im, _ = g.pharmacy_label(d, rnd, "10h", include_ndc=False)
        elif kind == "stock":
            im, _ = g.stock_label(d, rnd)
        else:
            im, _ = g.carton(d, rnd)
        page = Image.new("RGB", (1700, 2200), "white")
        dr = ImageDraw.Draw(page)
        dr.text((80, 70), f"{cid}. {title}", font=font, fill="black")
        dr.text((80, 125), "SYNTHETIC TEST LABEL - not a real prescription. Real public drug codes; all personal details invented.", font=small, fill="black")
        page.paste(im.resize((1540, int(im.height * 1540 / im.width))), (80, 200))
        y = 200 + int(im.height * 1540 / im.width) + 60
        dr.text((80, y), "Expected:", font=font, fill="black")
        words, line, yy = expect.split(), "", y + 50
        for w in words:
            if dr.textlength(line + " " + w, font=small) > 1500:
                dr.text((80, yy), line.strip(), font=small, fill="black")
                line, yy = "", yy + 38
            line += " " + w
        dr.text((80, yy), line.strip(), font=small, fill="black")
        pages.append(page)
    pages[0].save(out, save_all=True, append_images=pages[1:], resolution=200)
    print(f"{len(pages)} pages -> {out}")


if __name__ == "__main__":
    main(sys.argv[1])
