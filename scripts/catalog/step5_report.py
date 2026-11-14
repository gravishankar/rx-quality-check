#!/usr/bin/env python3
"""Extended drug list, step 5: human-readable review table (Markdown + CSV) from steps 1-4.
  python3 -I scripts/catalog/step5_report.py build/catalog data/proposals"""
import csv, json, sys
from pathlib import Path

LABEL = {"EXISTING": "In the app now", "PROPOSED_ACTIVE": "Add (active)", "PROPOSED_INACTIVE": "Add (switched off)",
         "EXCLUDED_BY_POLICY": "Excluded by policy", "OUT_OF_SCOPE": "Out of scope"}

def main(build, out):
    b, o = Path(build), Path(out)
    review = json.loads((b / "review.json").read_text())
    check = {tuple(x["cms"]): x for x in json.loads((b / "app_check.json").read_text())}
    stages = {x["drug_id"]: x for x in json.loads((o / "activation_stages.json").read_text())} if (o / "activation_stages.json").exists() else {}
    cov = {x["drug_id"]: x for x in json.loads((b / "coverage.json").read_text())} if (b / "coverage.json").exists() else {}
    s1 = json.loads((b / "step1.json").read_text()); src = s1["source"]; total = src["total_claims_all_drugs"]
    rows = []
    for r in review:
        c = check.get(tuple(r["cms_names"]), {})
        rows.append({
            "rank": r["rank"], "cms_generic_names": "; ".join(r["cms_names"]), "claims_2023": r["claims_2023"],
            "share_pct": round(100 * r["claims_2023"] / total, 2),
            "ingredients_rxcui": "; ".join(r.get("ingredients", [])) or "—",
            "decision": LABEL[r["decision"]], "catalog_drug_id": r.get("drug_id") or "—",
            "stage": stages.get(r.get("drug_id"), {}).get("stage", "—") if r["decision"] != "EXISTING" else "now",
            "oral_share_pct": round(100 * cov[r["drug_id"]]["oral_share"]) if r.get("drug_id") in cov else "—",
            "fda_oral_rx_products": r.get("oral_rx_products", "—"),
            "recall_records_app_search": c.get("recall_records", "—"),
            "example_ndc": r.get("exemplar_ndc") or "—",
            "reason": "" if r["decision"] in ("EXISTING", "PROPOSED_ACTIVE") else r["reason"],
        })
    with open(o / "extended_drug_list_review.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    def share(k): return 100 * sum(r["claims_2023"] for r in review if r["decision"] == k) / total
    n = lambda k: sum(r["decision"] == k for r in review)
    md = [f"""# Extended drug list — proposal for review (catalog 0.3.0-proposed)

Proposal, not yet in the app. The app still uses `data/drug_catalog.json` 0.2.0 (14 drugs) until the
team approves this list (OD-2) and decides OD-30 and OD-32. Verified 2026-11-13.

## How the list was made (same method as the original 15)

1. **Ranking.** CMS *Medicare Part D Prescribers — by Geography and Drug*, data year 2023, National rows
   ([file]({src['url']}), SHA-256 `{src['sha256']}`). Generic names ranked by total claims, summed over
   brand names; the top 200 are taken. These cover {100*sum(x['claims_2023'] for x in review)/total:.1f}% of all
   {total:,} Part D claims in 2023. This reproduces the original list: ranks 1–18 match OpenPrescriber's
   published top 20 exactly (19 and 20 swap). OpenPrescriber's counts are about 42–44% of CMS's
   official national totals, so the counts here come from CMS directly.
2. **Ingredients.** Each CMS name is mapped to RxNorm ingredients and verified exactly on RxNav, with
   every salt form (precise ingredient). CMS abbreviations that cannot be matched automatically are
   mapped in a small, listed override table (`scripts/catalog/step1_rank_and_map.py`) and still verified.
3. **Scope.** FDA's NDC Directory (openFDA) must list at least one **oral, prescription** product with
   exactly that ingredient set. Inhalers, eye drops, skin products, injections, sublingual products,
   kits, vaccines and supplies are out of scope, as today.
4. **Exclusions.** The existing exclusion policy (anticoagulants, transplant immunosuppressants) is
   applied unchanged. Digoxin is switched off pending OD-32 (narrow-therapeutic-index criterion).
5. **App check.** For every drug, the app's own code reads a real FDA product record, decides
   eligibility against this catalog (before and after the RxNav step), and runs the recall search it
   would send. All {len(check)} drugs behave exactly as listed below. Drugs whose recall search would
   find fewer records than the plain ingredient name are switched off until app fix F1.
6. **Validation.** The proposed catalog passes the app's configuration validator and precedence
   self-test (`npm run config:validate -- --catalog-file data/proposals/drug_catalog_0.3.0-proposed.json`).

## Summary

| Decision | Drugs | Share of all 2023 Part D claims |
|---|---|---|
| In the app now | {n('EXISTING')} | {share('EXISTING'):.1f}% |
| Add (active) | {n('PROPOSED_ACTIVE')} | {share('PROPOSED_ACTIVE'):.1f}% |
| Add (switched off until a fix or decision) | {n('PROPOSED_INACTIVE')} | {share('PROPOSED_INACTIVE'):.1f}% |
| Excluded by policy | {n('EXCLUDED_BY_POLICY')} | {share('EXCLUDED_BY_POLICY'):.1f}% |
| Out of scope (not oral, or not a drug) | {n('OUT_OF_SCOPE')} | {share('OUT_OF_SCOPE'):.1f}% |

Coverage of all 2023 Part D claims, as a range. The upper bound counts every claim of a covered
generic name, including patches, inhalers and eye drops the app does not check; the oral-weighted
estimate weights each drug's claims by the share of its FDA prescription products that are oral-only
(a proxy: CMS data does not split claims by dosage form). Details: `docs/F1_AND_STAGED_ACTIVATION.md`.

| Scope | Upper bound | Oral-weighted estimate |
|---|---|---|
| Today (14 drugs) | 29.1% | 28.1% |
| + 130 proposed active | 74.5% | 69.3% |
| + 17 held | 79.2% | 73.5% |

**App fix F1 (implemented 2026-11-13, awaiting approval):** the recall-search gap is closed for 13 of
the 14 drugs it affected (verified on recorded FDA responses); they stay switched off until F1 is
approved. Dextroamphetamine/amphetamine still needs follow-up F3 (mixed salts). Activation is
proposed in four stages (`data/proposals/activation_stages.json`).

**Worth a second look before approving:** methotrexate (an immunosuppressant used outside
transplant, so the transplant criterion does not cover it); sacubitril/valsartan (0 recall records
found, plausible for a brand-only product); timolol and estradiol (most of their claims are eye drops
or patches, which the app does not cover).

## The list

Columns: CMS rank; CMS generic name(s); 2023 claims; RxNorm ingredient(s) with RxCUI; decision;
catalog drug ID; oral prescription products in FDA's NDC Directory; recall records the app's search
finds today (openFDA enforcement, 2026-11-13); one real product NDC used for the app check; reason.
The 200 CMS names make 196 rows: names that are the same ingredient are one row (for example
"Ondansetron" and "Ondansetron Hcl"). Product and recall counts are per ingredient set across all
salts, so metoprolol succinate and tartrate show the same counts.

| # | CMS generic name | Claims 2023 | Ingredient (RxCUI) | Decision | Stage | Catalog ID | FDA oral Rx products | Oral-only share | Recall records found | Example NDC | Reason |
|---|---|---|---|---|---|---|---|---|---|---|---|"""]
    for r in rows:
        osh = f"{r['oral_share_pct']}%" if r['oral_share_pct'] != "—" else "—"
        md.append(f"| {r['rank']} | {r['cms_generic_names']} | {r['claims_2023']:,} | {r['ingredients_rxcui']} | {r['decision']} | {r['stage']} | `{r['catalog_drug_id']}` | {r['fda_oral_rx_products']} | {osh} | {r['recall_records_app_search']} | {r['example_ndc']} | {r['reason']} |")
    md.append("\nCSV of the same table: `data/proposals/extended_drug_list_review.csv`. Catalog in the app's format: `data/proposals/drug_catalog_0.3.0-proposed.json`.")
    (o / "EXTENDED_DRUG_LIST.md").write_text("\n".join(md) + "\n")
    print("wrote", o / "EXTENDED_DRUG_LIST.md", len(rows), "rows")

if __name__ == "__main__":
    main(*sys.argv[1:])
