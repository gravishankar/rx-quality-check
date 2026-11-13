#!/usr/bin/env bash
# Make PDF copies of the guides we share with testers, in docs/share/. Markdown stays the source:
# edit the .md file, then run:  bash scripts/share/make_share_pdfs.sh
# Needs pandoc and the Chromium that ships with Playwright (both available in the build environment).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/docs/share"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
DOCS=(
  "docs/TEST_ON_COMPUTER.md|Test on a Mac or laptop"
  "docs/INSTALL_ON_ANDROID.md|Install on an Android phone"
  "docs/task4c/PIXEL_SCAN_TEST_GUIDE.md|Scan test guide"
  "docs/FUNCTIONAL_TEST_PLAN.md|Functional test plan"
  "data/proposals/EXTENDED_DRUG_LIST.md|Extended drug list|landscape"
  "docs/DATA_SCHEMAS.md|Data schemas"
  "docs/F1_AND_STAGED_ACTIVATION.md|F1 and staged activation|landscape"
)
for entry in "${DOCS[@]}"; do
  IFS='|' read -r src title orient <<< "$entry"; name="$(basename "$src" .md)"
  pandoc -f gfm -t html5 -s --metadata pagetitle="$title" --css "$ROOT/scripts/share/share.css" --embed-resources \
    "$ROOT/$src" -o "$TMP/$name.html"
  node "$ROOT/scripts/share/print_pdf.cjs" "$TMP/$name.html" "$OUT/$name.pdf" "$src" "${orient:-portrait}"
  echo "wrote docs/share/$name.pdf"
done
