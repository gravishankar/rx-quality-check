#!/usr/bin/env python3
"""
Extended drug list, step 3: turn the verified candidates (steps 1-2) into a proposed drug catalog in
the app's own format (data/schemas/drug_catalog.schema.json, schema 2), plus a review table.
Existing catalog entries are kept unchanged. Candidates are grouped by exact ingredient set.

Decision per candidate (in this order):
  EXCLUDED_BY_POLICY  an ingredient is on data/exclusion_policy.json (never added)
  OUT_OF_SCOPE        no oral prescription product with exactly this ingredient set in FDA's NDC Directory
  EXISTING            already in data/drug_catalog.json (unchanged)
  PROPOSED_INACTIVE   added with status INACTIVE: pending a team decision (OD-32) or FDA route data
                      that also lists a non-oral route for every oral product (needs review)
  PROPOSED_ACTIVE     added with status ACTIVE
  python3 -I scripts/catalog/step3_build_catalog.py <step2.json> <aliases.json> <out_catalog.json> <out_review.json>
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERIFIED_ON = "2026-11-13"
OD32 = {"3407": "digoxin"}  # named in OD-32 (narrow therapeutic index); lithium, phenytoin, carbamazepine fall outside the top 200
# Found by step 4 (the app's own code): entries the app cannot yet assess correctly.
APP_GAPS = {"isosorbide_mononitrate": "Needs a small app change: the label/FDA-record reader does not yet recognise the salt \"mononitrate\", so the app answers \"needs clarification\" for these products"}
# Salt-specific products kept apart (as metoprolol succinate already is).
SALT_SPLITS = {
    "Metoprolol Tartrate": ("metoprolol_tartrate", "Metoprolol tartrate", {"metoprolol": {"allow": ["203191"]}, "_release_types": ["IR"]},
                            "Scope is the tartrate salt (immediate-release). Metoprolol succinate is a separate catalog drug."),
    "Isosorbide Mononitrate": ("isosorbide_mononitrate", "Isosorbide mononitrate", {"isosorbide": {"allow": ["28004"]}},
                               "RxNorm models isosorbide mononitrate as a salt (PIN 28004) of the ingredient isosorbide; scope is limited to it. Isosorbide dinitrate is a different ingredient (IN 6058) and is not in this list."),
}

def restrictions_of(restr):
    r = {k: v for k, v in restr.items() if not k.startswith("_")}
    out = {"precise_ingredients": r} if r else {}
    if "_release_types" in restr:
        out["release_types"] = restr["_release_types"]
    return out

def ident(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")

def main(step2, aliases_path, out_catalog, out_review):
    d = json.loads(Path(step2).read_text())
    # From step 4: drugs whose recall search, as the app builds it today, finds fewer records than
    # the plain ingredient name (the app keeps an unrecognised salt word in the search name).
    gaps_file = Path(out_review).parent / "name_gaps.json"
    search_gaps = {}
    if gaps_file.exists():
        for rank, cms, app_names, ing_names, app_n, ing_n in json.loads(gaps_file.read_text()):
            if isinstance(app_n, int) and isinstance(ing_n, int) and app_n < ing_n:
                search_gaps[cms] = (f"Needs app fix F1 (salt words): the app's recall search uses {' + '.join(repr(n) for n in app_names)} "
                                    f"and finds {app_n} FDA recall records; the ingredient name {' + '.join(repr(n) for n in ing_names)} finds {ing_n}")
    aliases = json.loads(Path(aliases_path).read_text()) if Path(aliases_path).exists() else {}
    cat = json.loads((ROOT / "data" / "drug_catalog.json").read_text())
    pol = json.loads((ROOT / "data" / "exclusion_policy.json").read_text())
    excluded = {}
    for r in pol["ingredient_rules"]:
        for rx in r.get("rxcuis", []) + [m.get("rxcui") for m in r.get("match", []) if isinstance(m, dict)]:
            if rx: excluded[str(rx)] = r.get("id", "?")
    excl_names = {str(r.get("ingredient", r.get("name", ""))).lower(): r.get("id") for r in pol["ingredient_rules"]}
    existing_ing = {i["rxcui"]: i for i in cat["ingredients"]}
    existing_sets = {}
    for dr in cat["drugs"]:
        rx = tuple(sorted(next(i["rxcui"] for i in cat["ingredients"] if i["id"] == x) for x in dr["ingredients"]))
        existing_sets.setdefault(rx, []).append(dr)
    groups, order = {}, []
    for row in d["rows"]:
        if row["mapping"] != "VERIFIED":
            continue
        key = tuple(sorted(i["rxcui"] for i in row["ingredients"]))
        if row["cms_generic_name"] in SALT_SPLITS:
            key = key + (SALT_SPLITS[row["cms_generic_name"]][0],)
        if key not in groups:
            groups[key] = []; order.append(key)
        groups[key].append(row)
    new_ings, new_drugs, review = [], [], []
    for row in d["rows"]:
        if row["mapping"] == "NOT_A_DRUG_INGREDIENT":
            review.append({"rank": row["cms_rank"], "cms_names": [row["cms_generic_name"]], "claims_2023": row["claims_2023"], "decision": "OUT_OF_SCOPE", "reason": "Not a drug ingredient (vaccine, device or supply)", "drug_id": None})
    for key in order:
        rows = groups[key]; first = rows[0]; ings = first["ingredients"]
        rxs = [i["rxcui"] for i in ings]; claims = sum(r["claims_2023"] for r in rows)
        fda = first["fda"]; exact = sum(r["fda"]["oral_rx_products_exact_set_in_sample"] for r in rows)
        base = {"rank": first["cms_rank"], "cms_names": [r["cms_generic_name"] for r in rows], "claims_2023": claims,
                "ingredients": [f'{i["name"]} (RxCUI {i["rxcui"]})' for i in ings], "oral_rx_products": exact,
                "dosage_forms": fda["dosage_forms"], "pharm_class_epc": fda["pharm_class_epc"],
                "recall_records_by_name": fda["recall_records_by_name"], "latest_recall": fda["latest_recall_report_date"],
                "exemplar_ndc": (fda["exemplar"] or {}).get("product_ndc")}
        hit = [excluded.get(rx) or excl_names.get(i["name"].lower()) for rx, i in zip(rxs, ings)]
        if any(hit):
            review.append({**base, "decision": "EXCLUDED_BY_POLICY", "reason": f"Exclusion policy rule {next(h for h in hit if h)}", "drug_id": None}); continue
        if exact == 0:
            why = "No oral prescription product with exactly this ingredient set in FDA's NDC Directory"
            if fda["rx_products_any_route"] > 0: why += " (products exist for other routes: inhaled, eye, skin, injection or under the tongue)"
            review.append({**base, "decision": "OUT_OF_SCOPE", "reason": why, "drug_id": None}); continue
        split = SALT_SPLITS.get(first["cms_generic_name"])
        set_key = tuple(sorted(rxs))
        if not split and set_key in existing_sets:
            dr = existing_sets[set_key][0]
            review.append({**base, "decision": "EXISTING", "reason": "Already in the catalog (unchanged)", "drug_id": dr["id"]}); continue
        if split and split[0] in {x["id"] for x in cat["drugs"]}:
            review.append({**base, "decision": "EXISTING", "reason": "Already in the catalog (unchanged)", "drug_id": split[0]}); continue
        # Ingredients (reuse existing definitions).
        ing_ids = []
        for i in ings:
            if i["rxcui"] in existing_ing:
                ing_ids.append(existing_ing[i["rxcui"]]["id"]); continue
            iid = ident(i["name"])
            if iid not in {x["id"] for x in new_ings}:
                al = aliases.get(i["rxcui"], {})
                new_ings.append({"id": iid, "name": i["name"], "rxcui": i["rxcui"], "tty": i["tty"], "aliases": sorted(al),
                                 **({"alias_provenance": al} if al else {}),
                                 "precise_ingredients": i["precise_ingredients"],
                                 "provenance": {"source": f"RxNav /REST/rxcui.json?name={i['name']}&search=0, /rxcui/{i['rxcui']}/properties.json and /related.json?tty=PIN", "verified_on": VERIFIED_ON}})
            ing_ids.append(iid)
        did, disp, restr, note = split if split else ("_".join(ing_ids), "/".join(n["name"] for n in ings).capitalize(), {}, "")
        epc = fda["pharm_class_epc"]
        forms = ", ".join(f"{k.lower()} ({v})" for k, v in list(fda["dosage_forms"].items())[:4])
        routes_bad = (fda["exemplar"] or {}).get("route") and len((fda["exemplar"] or {}).get("route")) > 1
        status, decision, reason = "ACTIVE", "PROPOSED_ACTIVE", "Meets every criterion"
        if any(rx in OD32 for rx in rxs):
            status, decision, reason = "INACTIVE", "PROPOSED_INACTIVE", "Pending OD-32 (narrow-therapeutic-index criterion)"
        elif first["cms_generic_name"] in search_gaps:
            status, decision, reason = "INACTIVE", "PROPOSED_INACTIVE", search_gaps[first["cms_generic_name"]]
        elif did in APP_GAPS:
            status, decision, reason = "INACTIVE", "PROPOSED_INACTIVE", APP_GAPS[did]
        elif routes_bad:
            status, decision, reason = "INACTIVE", "PROPOSED_INACTIVE", f"Needs review: FDA lists route {' + '.join(fda['exemplar']['route'])} for the example product"
        notes = (note + " " if note else "") + f"CMS Part D 2023 generic name(s): {', '.join(r['cms_generic_name'] for r in rows)}; {claims:,} claims. FDA oral prescription products found: {exact} ({forms})."
        if status == "INACTIVE": notes += f" INACTIVE: {reason}."
        new_drugs.append({"id": did, "display_name": disp, "status": status, "ingredients": ing_ids, "aliases": [],
                          "rx_scope": "PRESCRIPTION_ONLY", "restrictions": restrictions_of(restr),
                          "part_d_rank_2023": first["cms_rank"],
                          "provenance": {"source": "CMS Medicare Part D Prescribers - by Geography and Drug, 2023, National (MUP_DPR_RY25_P04_V10_DY23_Geo.csv, SHA-256 876ff262...f4f8): top 200 generic names by total claims; RxNav (exact name, IN and PIN); openFDA NDC Directory (oral, human prescription)", "verified_on": VERIFIED_ON},
                          "notes": notes})
        review.append({**base, "decision": decision, "reason": reason, "drug_id": did})
    out = json.loads(json.dumps(cat))
    for dr in out["drugs"]:
        if dr["id"] == "metoprolol_succinate" and any(x["id"] == "metoprolol_tartrate" for x in new_drugs):
            dr["restrictions"]["release_types"] = ["ER"]
            dr["notes"] += " Release type ER added in 0.3.0-proposed so it stays distinct from metoprolol tartrate (IR)."
    out["catalog_version"] = "0.3.0-proposed"
    out["status"] = "PROPOSED_PENDING_APPROVAL"
    out["description"] = cat["description"] + " Version 0.3.0 (proposed) extends the scope to the top 200 Medicare Part D 2023 generic names by total claims that pass the same checks."
    out["provenance"] = {**cat["provenance"], "extended_scope_source": "scripts/catalog/ (steps 1-4): CMS Part D 2023 top 200 by total claims; RxNav and openFDA verified on 2026-11-13"}
    out["ingredients"] = cat["ingredients"] + new_ings
    out["drugs"] = [d for d in out["drugs"]] + new_drugs
    out["change_log"] = cat["change_log"] + [{"date": VERIFIED_ON, "version": "0.3.0-proposed", "change": f"Proposed: add {len(new_drugs)} drugs ({sum(x['status']=='ACTIVE' for x in new_drugs)} active, {sum(x['status']=='INACTIVE' for x in new_drugs)} inactive pending review) from the CMS Part D 2023 top 200 generic names by total claims, after RxNav, openFDA and exclusion-policy checks. Metoprolol succinate gains release_types [ER] to stay distinct from the new metoprolol tartrate [IR].", "source": "CMS MUP_DPR_RY25_P04_V10_DY23_Geo.csv; RxNav; openFDA NDC Directory and enforcement (2026-11-13)"}]
    Path(out_catalog).write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    Path(out_review).write_text(json.dumps(sorted(review, key=lambda r: r["rank"]), indent=1, ensure_ascii=False))
    from collections import Counter
    print(Counter(r["decision"] for r in review), "drugs added:", len(new_drugs), "ingredients added:", len(new_ings))

if __name__ == "__main__":
    main(*sys.argv[1:])
