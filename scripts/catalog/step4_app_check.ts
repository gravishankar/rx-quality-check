/**
 * Extended drug list, step 4: judge every proposed and existing drug with the app's own code.
 * For each drug's exemplar FDA product (a real NDC Directory record from step 2):
 *   1. identity as the app builds it (directoryProductFrom → identityFromProduct);
 *   2. eligibility (evaluateExclusion) against the proposed catalog and the current policy, both on the
 *      local identity (before RxNav) and with the RxNorm ingredient codes the RxNav step adds;
 *   3. the recall searches the app would plan (planRecallQueries), and the live ingredient-text search.
 * Writes build/catalog/app_check.json. Usage:
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/catalog/step4_app_check.ts <step2.json> <catalog.json> <review.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { directoryProductFrom, identityFromProduct } from '../../mobile/src/rules/identity.ts';
import { evaluateExclusion } from '../../mobile/src/rules/exclusion.ts';
import { parseCatalog, parsePolicy } from '../../mobile/src/rules/catalog.ts';
import { planRecallQueries } from '../../mobile/src/rules/recallEvidence.ts';
import type { OpenFdaNdcProduct } from '../../mobile/src/models/openfda.ts';

const [step2Path, catalogPath, reviewPath] = process.argv.slice(2) as [string, string, string];
const step2 = JSON.parse(readFileSync(step2Path, 'utf8')) as { rows: { cms_rank: number; cms_generic_name: string; ingredients?: { rxcui: string; name: string }[]; fda?: { exemplar: OpenFdaNdcProduct | null } }[] };
const review = JSON.parse(readFileSync(reviewPath, 'utf8')) as { rank: number; cms_names: string[]; decision: string; drug_id: string | null }[];
const catalog = parseCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')), { allowUnapproved: true });
const policy = parsePolicy(JSON.parse(readFileSync('data/exclusion_policy.json', 'utf8')), { allowUnapproved: true });
if (!catalog.ok || !policy.ok) throw new Error('config did not load');

async function total(search: string): Promise<number | string> {
  const url = `https://api.fda.gov/drug/enforcement.json?search=${encodeURIComponent(search)}&limit=1`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.status === 404) return 0;
    if (r.ok) return ((await r.json()) as { meta: { results: { total: number } } }).meta.results.total;
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  return 'ERROR';
}

const out = [];
for (const rv of review) {
  if (!rv.drug_id && rv.decision !== 'EXCLUDED_BY_POLICY') continue;
  const row = step2.rows.find((r) => r.cms_generic_name === rv.cms_names[0]);
  const ex = row?.fda?.exemplar;
  if (!row || !ex) { out.push({ ...rv, check: 'NO_EXEMPLAR' }); continue; }
  const id = identityFromProduct(directoryProductFrom(ex), null, null);
  const local = evaluateExclusion(id, policy, catalog);
  // What the RxNav step adds: ingredient RxCUIs (exact RxNorm names, verified in step 1).
  const enriched = { ...id, ingredients: id.ingredients.map((i) => {
    const hit = row.ingredients?.find((x) => x.name.toLowerCase() === i.name.toLowerCase() || i.name.toLowerCase().startsWith(x.name.toLowerCase()));
    return hit ? { ...i, rxcui: hit.rxcui } : i;
  }) };
  const after = evaluateExclusion(enriched, policy, catalog);
  const plan = planRecallQueries(enriched);
  const text = plan.queries.find((q) => q.id === 'ingredient_text');
  const recalls = text ? await total(text.search) : 'NONE';
  const drugId = (d: typeof after) => (d.decision === 'ELIGIBLE' ? `${d.catalogDrugId} (by ${d.matchedBy})` : '');
  out.push({ rank: rv.rank, cms: rv.cms_names, expected: rv.decision, drug_id: rv.drug_id, exemplar: ex.product_ndc,
    identity_names: id.ingredients.map((i) => i.name), local: `${local.decision}${'reason' in local ? `:${local.reason}` : ''}`,
    enriched: `${after.decision}${'reason' in after ? `:${after.reason}` : ''}`, matched_drug: drugId(after), recall_search: text?.search, recall_records: recalls });
  process.stdout.write(`${rv.rank} ${rv.cms_names[0]} → ${out.at(-1)!.enriched} ${out.at(-1)!.matched_drug} recalls=${recalls}\n`);
  await new Promise((r) => setTimeout(r, 250));
}
writeFileSync('build/catalog/app_check.json', JSON.stringify(out, null, 1));
