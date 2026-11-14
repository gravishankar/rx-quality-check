/**
 * Extended drug list, step 6: review every proposed and current drug against EVERY oral prescription
 * FDA product with exactly its ingredient set (from step 2's recorded NDC Directory answers), using the
 * app's own code: identity (directoryProductFrom → identityFromProduct), eligibility before and after
 * the RxNav step (evaluateExclusion), dose-form family, release type and routes. Writes
 * build/catalog/product_review.json. Usage:
 *   npx tsx scripts/catalog/step6_product_review.ts <catalog.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { directoryProductFrom, identityFromProduct } from '../../mobile/src/rules/identity.ts';
import { evaluateExclusion } from '../../mobile/src/rules/exclusion.ts';
import { parseCatalog, parsePolicy } from '../../mobile/src/rules/catalog.ts';
import type { OpenFdaNdcProduct } from '../../mobile/src/models/openfda.ts';

const catPath = process.argv[2] ?? 'data/proposals/drug_catalog_0.3.0-proposed.json';
const catJson = JSON.parse(readFileSync(catPath, 'utf8'));
const catalog = parseCatalog(catJson, { allowUnapproved: true });
const policy = parsePolicy(JSON.parse(readFileSync('data/exclusion_policy.json', 'utf8')), { allowUnapproved: true });
if (!catalog.ok || !policy.ok) throw new Error('config');
const review = JSON.parse(readFileSync('build/catalog/review.json', 'utf8')) as { rank: number; cms_names: string[]; decision: string; drug_id: string | null }[];
const step1 = JSON.parse(readFileSync('build/catalog/step1.json', 'utf8')) as { rows: { cms_generic_name: string; ingredients?: { rxcui: string; name: string; precise_ingredients: { name: string }[] }[] }[] };
const products = JSON.parse(readFileSync('build/catalog/products_by_row.json', 'utf8')) as Record<string, OpenFdaNdcProduct[]>;
const signals = new Set((JSON.parse(readFileSync('data/exclusion_policy.json', 'utf8')) as { classes: { fda_epc_signals: string[] }[] }).classes.flatMap((c) => c.fda_epc_signals));

const SALT = new Set(['hydrochloride', 'hcl', 'dihydrochloride', 'hydrobromide', 'sodium', 'potassium', 'calcium', 'magnesium', 'besylate', 'maleate', 'mesylate', 'succinate', 'tartrate', 'bitartrate', 'fumarate', 'citrate', 'sulfate', 'bisulfate', 'phosphate', 'acetate', 'propionate', 'oxalate', 'bromide', 'chloride', 'hyclate', 'gluconate', 'tromethamine', 'medoxomil', 'axetil', 'pamoate', 'carbonate', 'propanediol', 'hippurate', 'benzoate', 'anhydrous', 'monohydrate', 'dihydrate', 'trihydrate', 'hemihydrate', 'sesquihydrate', 'disodium', 'usp', 'palmitate', 'mononitrate']);
type Ing = { rxcui: string; name: string; precise_ingredients: { name: string }[] };
const ingOf = (active: string, ings: Ing[]) => {
  const a = active.toUpperCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  for (const i of ings) {
    const names = [i.name, ...i.precise_ingredients.map((p) => p.name)].map((n) => n.toUpperCase());
    if (names.includes(a)) return i.rxcui;
    const n = i.name.toUpperCase();
    if (a.startsWith(n + ' ') && a.slice(n.length + 1).split(' ').every((w) => SALT.has(w.toLowerCase()))) return i.rxcui;
  }
  return null;
};
const tally = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

const out = [];
for (const rv of review) {
  if (!rv.drug_id) continue;
  const drug = catJson.drugs.find((d: { id: string }) => d.id === rv.drug_id);
  const ings = rv.cms_names.flatMap((n) => step1.rows.find((r) => r.cms_generic_name === n)?.ingredients ?? []).filter((x, i, a) => a.findIndex((y) => y.rxcui === x.rxcui) === i);
  const want = new Set(ings.map((i) => i.rxcui));
  const seen = new Set<string>();
  const members: OpenFdaNdcProduct[] = [];
  for (const n of rv.cms_names) for (const p of products[n] ?? []) {
    if (seen.has(p.product_ndc)) continue;
    const got = new Set((p.active_ingredients ?? []).map((a) => ingOf(a.name, ings)));
    if (!got.has(null) && got.size === want.size && [...want].every((x) => got.has(x))) { seen.add(p.product_ndc); members.push(p); }
  }
  const r = { rank: rv.rank, drug_id: rv.drug_id, status: drug.status, decision: rv.decision, products: members.length,
    eligible_this: 0, eligible_other: {} as Record<string, number>, needs_clarification: {} as Record<string, number>, unsupported: {} as Record<string, number>, excluded: {} as Record<string, number>,
    forms: {} as Record<string, number>, release: {} as Record<string, number>, co_routes: {} as Record<string, number>, epc_signal_hits: [] as string[], salts_seen: {} as Record<string, number>, dea_schedule: {} as Record<string, number> };
  for (const p of members) {
    const id = identityFromProduct(directoryProductFrom(p), p.packaging?.[0]?.package_ndc ?? null, null);
    const enriched = { ...id, ingredients: id.ingredients.map((i, k) => ({ ...i, rxcui: ingOf((p.active_ingredients ?? [])[k]?.name ?? '', ings) ?? i.rxcui })) };
    const d = evaluateExclusion(enriched, policy, catalog);
    if (d.decision === 'ELIGIBLE') { if (d.catalogDrugId === rv.drug_id) r.eligible_this++; else tally(r.eligible_other, d.catalogDrugId); }
    else tally(d.decision === 'NEEDS_CLARIFICATION' ? r.needs_clarification : d.decision === 'UNSUPPORTED' ? r.unsupported : r.excluded, d.reason);
    tally(r.forms, id.doseForm); tally(r.release, id.release);
    for (const route of p.route ?? []) if (route !== 'ORAL') tally(r.co_routes, route);
    for (const c of p.pharm_class ?? []) if (signals.has(c) && !r.epc_signal_hits.includes(c)) r.epc_signal_hits.push(c);
    for (const a of p.active_ingredients ?? []) tally(r.salts_seen, a.name);
    tally(r.dea_schedule, (p as { dea_schedule?: string }).dea_schedule ?? 'none');
  }
  out.push(r);
}
writeFileSync('build/catalog/product_review.json', JSON.stringify(out, null, 1));
const act = out.filter((x) => x.status === 'ACTIVE');
console.log(`drugs reviewed: ${out.length} (active ${act.length}); products: ${out.reduce((a, x) => a + x.products, 0)}`);
console.log(`active drugs where every product is eligible for that drug: ${act.filter((x) => x.eligible_this === x.products).length}`);
