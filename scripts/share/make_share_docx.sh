#!/usr/bin/env bash
# Word (.docx) copies of review documents, from their Markdown sources (the Markdown stays the source).
# Landscape US Letter, Arial, bordered tables sized by content (scripts/share/reference.docx,
# scripts/share/docx_tables.py). Requires pandoc and python3.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/docs/share"
for src in docs/DEVICE_VERIFICATION_4H.md docs/CATALOG_STAGE1_READINESS.md docs/CORRECTNESS_FINDINGS.md; do
  name="$(basename "$src" .md)"
  pandoc "$ROOT/$src" -f gfm -t docx --reference-doc="$ROOT/scripts/share/reference.docx" -o "$OUT/$name.docx"
  python3 "$ROOT/scripts/share/docx_tables.py" "$OUT/$name.docx"
  zip -qd "$OUT/$name.docx" '*/' >/dev/null 2>&1 || true
  echo "$OUT/$name.docx"
done
