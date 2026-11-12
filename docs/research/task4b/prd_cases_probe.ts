/**
 * Task 4C research probe (NOT application code): re-verify the identity and facility-listing claims
 * of the Drug Quality Score App PRD acceptance cases against live first-party sources reachable from
 * the build environment (openFDA NDC Directory, DailyMed SPL, RxNav). Inspection histories, warning
 * letters and import alerts cannot be checked from here (FDA Data Dashboard / accessdata blocked).
 *   NODE_USE_ENV_PROXY=1 npx tsx docs/research/task4b/prd_cases_probe.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeSplEstablishments } from '../../../scripts/lib/spl.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function json(url: string) {
  await sleep(250);
  const r = await fetch(url);
  return r.status === 200 ? r.json() : { __status: r.status };
}
const CASES = [
  { id: 'levothyroxine_jerome_stevens', q: 'generic_name:"levothyroxine"+AND+labeler_name:"Jerome Stevens"' },
  { id: 'rosuvastatin_msn_72205-003', q: 'product_ndc:"72205-003"' },
  { id: 'telmisartan_inventia', q: 'generic_name:"telmisartan"+AND+openfda.manufacturer_name:"Inventia"' },
  { id: 'progesterone_bionpharma', q: 'generic_name:"progesterone"+AND+labeler_name:"Bionpharma"' },
  { id: 'anastrozole_zydus', q: 'generic_name:"anastrozole"+AND+labeler_name:"Zydus"' },
  { id: 'arimidex_ani', q: 'brand_name:"Arimidex"' },
  { id: 'estradiol_patch_mylan', q: 'generic_name:"estradiol"+AND+labeler_name:"Mylan"+AND+dosage_form:"PATCH"' },
];
const out: unknown[] = [];
for (const c of CASES) {
  const d = await json(`https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(c.q).replace(/%2B/g, '+').replace(/%3A/g, ':').replace(/%22/g, '%22')}&limit=20`);
  const rows = (d.results ?? []) as { product_ndc: string; labeler_name: string; brand_name?: string; generic_name: string; dosage_form: string; active_ingredients: { strength: string }[]; openfda?: { spl_set_id?: string[] } }[];
  const seen = new Set<string>();
  const products: unknown[] = [];
  for (const r of rows) {
    const sid = r.openfda?.spl_set_id?.[0];
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    await sleep(250);
    const x = await fetch(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${sid}.xml`);
    const s = x.status === 200 ? summarizeSplEstablishments(await x.text()) : null;
    const im = await json(`https://rxnav.nlm.nih.gov/REST/ndcproperties.json?id=${r.product_ndc}`);
    const props = im.ndcPropertyList?.ndcProperty?.[0]?.propertyConceptList?.propertyConcept ?? [];
    products.push({
      product_ndc: r.product_ndc, labeler: r.labeler_name, brand: r.brand_name ?? null, generic: r.generic_name, form: r.dosage_form, strengths: r.active_ingredients.map((a) => a.strength),
      spl_set_id: sid, manufacture_sites: s?.establishments.filter((e) => e.operations.includes('C43360')).map((e) => ({ name: e.name, duns: e.duns })) ?? null,
      api_sites: s?.establishments.filter((e) => e.operations.includes('C82401')).map((e) => e.name) ?? null,
      no_establishment_section: s?.noEstablishmentSection ?? null,
      imprint: props.filter((p: { propName: string }) => p.propName === 'IMPRINT_CODE').map((p: { propValue: string }) => p.propValue),
    });
    if (products.length >= 4) break;
  }
  out.push({ case: c.id, query: c.q, status: d.__status ?? 200, products });
  console.log(c.id, d.__status ?? 200, JSON.stringify(products.map((p) => { const q = p as { product_ndc: string; manufacture_sites: unknown[] | null; no_establishment_section: boolean; imprint: string[] }; return [q.product_ndc, q.manufacture_sites?.length ?? null, q.no_establishment_section, q.imprint.slice(0, 3)]; })));
}
writeFileSync(join(import.meta.dirname, 'prd_cases_results.json'), JSON.stringify({ probe: 'prd-cases', run: new Date().toISOString(), cases: out }, null, 1) + '\n');
