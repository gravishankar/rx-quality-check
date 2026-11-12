/**
 * Task 4B research probe (NOT application code; not run by tests). Re-verifies provenance-related
 * assertions against live public sources reachable from the build environment:
 * openFDA NDC Directory + Drugs@FDA (api.fda.gov), DailyMed SPL XML, RxNav ndcproperties.
 * Writes docs/research/task4b/probe-results.json.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx docs/research/task4b/probe.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeSplEstablishments } from '../../../scripts/lib/spl.ts';

const OUT = join(import.meta.dirname, 'probe-results.json');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(url: string): Promise<{ status: number; text: string }> {
  await sleep(250);
  const r = await fetch(url, { headers: { 'User-Agent': 'rx-quality-check-research/0.1' } });
  return { status: r.status, text: await r.text() };
}
const json = async (url: string) => {
  const r = await get(url);
  return r.status === 200 ? JSON.parse(r.text) : { __status: r.status };
};

const DRUGS = ['atorvastatin calcium', 'amlodipine besylate', 'levothyroxine sodium', 'lisinopril', 'gabapentin', 'losartan potassium', 'metformin hydrochloride', 'metoprolol succinate', 'omeprazole', 'rosuvastatin calcium', 'pantoprazole sodium', 'furosemide', 'tamsulosin hydrochloride'];

async function main() {
  const started = new Date().toISOString();
  const products: unknown[] = [];
  for (const g of DRUGS) {
    const d = await json(`https://api.fda.gov/drug/ndc.json?search=generic_name:%22${encodeURIComponent(g)}%22+AND+finished:true&limit=100`);
    const rows = (d.results ?? []) as { product_ndc: string; labeler_name: string; spl_id?: string; openfda?: { spl_set_id?: string[]; is_original_packager?: boolean[] }; application_number?: string; marketing_category?: string; dosage_form: string; active_ingredients: { name: string; strength: string }[] }[];
    // Up to 3 original packagers and 2 repackagers per drug, distinct SPL set ids.
    const seen = new Set<string>();
    const pick: typeof rows = [];
    for (const want of [true, false]) {
      for (const r of rows) {
        const sid = r.openfda?.spl_set_id?.[0];
        const orig = r.openfda?.is_original_packager?.[0];
        if (!sid || seen.has(sid) || r.active_ingredients.length !== 1) continue;
        if (want ? orig === true : orig !== true) {
          seen.add(sid);
          pick.push(r);
          if (pick.filter((x) => (x.openfda?.is_original_packager?.[0] === true) === want).length >= (want ? 3 : 2)) break;
        }
      }
    }
    for (const r of pick) {
      const sid = r.openfda!.spl_set_id![0]!;
      const x = await get(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${sid}.xml`);
      const s = x.status === 200 ? summarizeSplEstablishments(x.text) : null;
      products.push({
        drug: g,
        product_ndc: r.product_ndc,
        labeler: r.labeler_name,
        is_original_packager: r.openfda?.is_original_packager?.[0] ?? null,
        application_number: r.application_number ?? null,
        marketing_category: r.marketing_category ?? null,
        dosage_form: r.dosage_form,
        spl_set_id: sid,
        spl_status: x.status,
        establishments: s?.establishments.map((e) => ({ name: e.name, duns: e.duns, operations: e.operations })) ?? null,
        manufacture_count: s?.manufactureEstablishmentCount ?? null,
        no_establishment_section: s?.noEstablishmentSection ?? null,
        repack_or_relabel: s?.hasRepackOrRelabel ?? null,
        equivalent_source_ndcs: s?.equivalentSourceNdcs ?? null,
        operation_counts: s?.operationCounts ?? null,
      });
    }
  }
  // Drugs@FDA: application → sponsor (authorized-generic / shared-application check).
  const apps = [...new Set(products.map((p) => (p as { application_number: string | null }).application_number).filter(Boolean))].slice(0, 25) as string[];
  const drugsfda: unknown[] = [];
  for (const a of apps) {
    const d = await json(`https://api.fda.gov/drug/drugsfda.json?search=application_number:%22${a}%22&limit=1`);
    const r = d.results?.[0];
    drugsfda.push({ application_number: a, status: d.__status ?? 200, sponsor_name: r?.sponsor_name ?? null, product_count: r?.products?.length ?? null, meta_last_updated: d.meta?.last_updated ?? null });
  }
  // Imprint check (RxNav ndcproperties) for a few product NDCs.
  const imprints: unknown[] = [];
  for (const p of products.slice(0, 40) as { product_ndc: string; drug: string; labeler: string }[]) {
    const d = await json(`https://rxnav.nlm.nih.gov/REST/ndcproperties.json?id=${p.product_ndc}`);
    const props = d.ndcPropertyList?.ndcProperty?.[0]?.propertyConceptList?.propertyConcept ?? [];
    const v = (n: string) => props.filter((x: { propName: string }) => x.propName === n).map((x: { propValue: string }) => x.propValue);
    imprints.push({ product_ndc: p.product_ndc, drug: p.drug, labeler: p.labeler, imprint: v('IMPRINT_CODE'), color: v('COLOR'), shape: v('SHAPE'), status: d.__status ?? 200 });
  }
  writeFileSync(OUT, JSON.stringify({ probe: 'task4b', started, finished: new Date().toISOString(), products, drugsfda, imprints }, null, 2) + '\n');
  console.log(`products ${products.length}, drugsfda ${drugsfda.length}, imprints ${imprints.length}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
