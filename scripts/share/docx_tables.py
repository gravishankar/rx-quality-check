"""Scale every table in a pandoc-made .docx to the full landscape text width, sizing columns by content. Usage: docx_tables.py file.docx"""
import re, sys, zipfile, shutil, os
TEXT_W = 15840 - 900 - 900
path = sys.argv[1]
z = zipfile.ZipFile(path); files = {n: z.read(n) for n in z.namelist()}; z.close()
doc = files['word/document.xml'].decode()
def fix(tbl):
    # Drop an all-empty header row (two-column key/value tables written with a blank header).
    rows = re.findall(r'<w:tr\b.*?</w:tr>', tbl, flags=re.S)
    if rows and not ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', rows[0])).strip():
        tbl = tbl.replace(rows[0], '', 1)
        tbl = re.sub(r'w:firstRow="1"', 'w:firstRow="0"', tbl)
    cols = [int(x) for x in re.findall(r'<w:gridCol w:w="(\d+)"\s*/>', tbl)]
    if not cols: return tbl
    # Weight each column by its content: mean text length of its cells, with a floor for short columns.
    n = len(cols); lens = [[] for _ in range(n)]
    for r in re.findall(r'<w:tr\b.*?</w:tr>', tbl, flags=re.S):
        cells = re.findall(r'<w:tc>.*?</w:tc>', r, flags=re.S)
        for i, c in enumerate(cells[:n]):
            lens[i].append(len(''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', c))))
    # Header length sets a floor; a column empty below its header is a fill-in column and gets room.
    w = []
    for l in lens:
        head, body = (l[0] if l else 0), l[1:]
        mean = (sum(body) / len(body)) if body else 0
        w.append(28.0 if body and max(body) == 0 else max(12.0, head + 2, mean))
    w = [x ** 0.75 for x in w]  # soften: long columns get more room, short ones stay readable
    # Minimum width per column: its longest word must fit (about 110 dxa per character at 9.5 pt + padding).
    longest = [0] * n
    for r in re.findall(r'<w:tr\b.*?</w:tr>', tbl, flags=re.S):
        for i, c in enumerate(re.findall(r'<w:tc>.*?</w:tc>', r, flags=re.S)[:n]):
            words = ' '.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', c)).split()
            if words: longest[i] = max(longest[i], max(min(len(x), 18) for x in words))
    mins = [max(700, (L + 1) * 140 + 216) for L in longest]
    tot = sum(w)
    new = [max(mins[i], round(x * TEXT_W / tot)) for i, x in enumerate(w)]
    over = sum(new) - TEXT_W
    if over > 0:  # take the excess from columns above their minimum, in proportion to their slack
        slack = [new[i] - mins[i] for i in range(n)]; st = sum(slack) or 1
        new = [new[i] - round(over * slack[i] / st) for i in range(n)]
    new[-1] += TEXT_W - sum(new)
    it = iter(new)
    tbl = re.sub(r'<w:gridCol w:w="\d+"\s*/>', lambda m: f'<w:gridCol w:w="{next(it)}"/>', tbl)
    tbl = re.sub(r'<w:tblW [^>]*/>', f'<w:tblW w:w="{TEXT_W}" w:type="dxa"/>', tbl)
    # cell widths, row by row, in grid order (pandoc tables have no merged cells)
    def row(m):
        r = m.group(0); k = iter(new)
        return re.sub(r'<w:tcW [^>]*/>', lambda _: f'<w:tcW w:w="{next(k)}" w:type="dxa"/>', r)
    tbl = re.sub(r'<w:tr\b.*?</w:tr>', row, tbl, flags=re.S)
    if '<w:tblLayout' not in tbl:
        tbl = tbl.replace('</w:tblPr>', '<w:tblLayout w:type="fixed"/></w:tblPr>', 1)
    return tbl
doc = re.sub(r'<w:tbl>.*?</w:tbl>', lambda m: fix(m.group(0)), doc, flags=re.S)
files['word/document.xml'] = doc.encode()
tmp = path + '.tmp'
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as out:
    for n, b in files.items(): out.writestr(n, b)
shutil.move(tmp, path)
