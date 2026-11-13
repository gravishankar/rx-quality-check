/**
 * Correctness finding C2 on real FDA data: recall retrieval for HCTZ combinations through the app's
 * own evidence path, with the ingredient alias "hctz" (fixed plan) and without it (the plan as
 * built before C2, i.e. the identity carries no aliases).
 *   record:  NODE_USE_ENV_PROXY=1 npx tsx scripts/catalog/c2_alias_search.ts --record
 *   replay:  npx tsx scripts/catalog/c2_alias_search.ts      (offline, tests/fixtures/c2/)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { directoryProductFrom, identityFromProduct, withCatalogAliases } from '../../mobile/src/rules/identity.ts';
import { evaluateRecallEvidence } from '../../mobile/src/rules/recallEvidence.ts';
import { runEffect, DEFAULT_RX_RULES, type Ports } from '../../mobile/src/engine/runner.ts';
import { createOpenFdaClient } from '../../mobile/src/services/openfda.ts';
import { liveTransport, loadCassette, recordingTransport, replayTransport, saveCassette, type Cassette } from '../lib/cassette.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import type { OpenFdaNdcProduct } from '../../mobile/src/models/openfda.ts';

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const record = isMain && process.argv.includes('--record');
const CASSETTE = 'tests/fixtures/c2/cassette.json';
const EXEMPLARS = 'tests/fixtures/c2/exemplars.json';
const NOW = '2026-11-13T12:00:00.000Z';
const cassette: Cassette = record || !existsSync(CASSETTE)
  ? { _fixture: { source: 'openFDA NDC Directory and enforcement, live HTTPS (scripts/catalog/c2_alias_search.ts --record)', capturedAt: new Date().toISOString(), note: 'C2 alias recall search' }, entries: {} }
  : loadCassette(CASSETTE);
const transport = record ? recordingTransport(liveTransport(), cassette) : replayTransport(cassette);
const fda = createOpenFdaClient({ transport, now: () => NOW });

/** Real products: Lupin losartan/HCTZ 100/25 (recall D-0886-2022 names its NDC and says "HCTZ"), and a valsartan/HCTZ. */
export const CASES = [
  { id: 'losartan/HCTZ 100/25 Lupin', search: 'product_ndc:"68180-217"' },
  { id: 'valsartan/HCTZ tablet', search: 'generic_name:"valsartan and hydrochlorothiazide" AND marketing_category:"ANDA"' },
];
const CATALOG = JSON.parse(readFileSync('data/proposals/drug_catalog_0.3.0-proposed.json', 'utf8')) as { ingredients: { name: string; aliases: string[] }[] };

async function exemplars(): Promise<Record<string, OpenFdaNdcProduct>> {
  if (!record) return JSON.parse(readFileSync(EXEMPLARS, 'utf8'));
  const out: Record<string, OpenFdaNdcProduct> = {};
  for (const c of CASES) {
    const j = (await (await fetch(`https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(c.search)}&limit=1`)).json()) as { results?: OpenFdaNdcProduct[] };
    if (!j.results?.[0]) throw new Error(`no exemplar for ${c.id}`);
    out[c.id] = j.results[0];
  }
  writeFileSync(EXEMPLARS, JSON.stringify(out, null, 1) + '\n');
  return out;
}

const ports: Ports = {
  extract: async () => null, lookupPackageNdc: async () => { throw new Error('unused'); },
  fetchRecallPage: (q, skip) => fda.enforcementPage(q, skip), loadCachedResult: async () => null,
  persist: async () => undefined, sleep: async () => undefined, now: () => NOW,
};

async function assess(identity: MedicationIdentity) {
  const [ev] = await runEffect({ type: 'FETCH_RECALL_EVIDENCE', identity } as never, ports, {} as never, DEFAULT_RX_RULES);
  if (!ev || ev.type !== 'EVIDENCE_READY') throw new Error(`evidence not ready: ${ev?.type}`);
  const f = evaluateRecallEvidence(identity, ev.bundle);
  const records: Record<string, string> = {};
  for (const [g, list] of [['CONFIRMED', f.confirmed], ['POTENTIAL', f.potential], ['UNRESOLVED', f.unresolved], ['NOT_APPLICABLE', f.notApplicable]] as const)
    for (const r of list) records[r.recallNumber] = `${g} (${r.reasons.join(', ')})`;
  return { search: ev.bundle.plan.queries.find((q) => q.kind === 'INGREDIENT_TEXT')?.search ?? '', finding: f.finding, searchAdequate: f.coverage.searchAdequate, records };
}

export async function runC2Comparison() {
  const ex = await exemplars();
  const out = [];
  for (const c of CASES) {
    const rec = ex[c.id]!;
    const base = identityFromProduct(directoryProductFrom(rec), rec.packaging?.[0]?.package_ndc ?? null, null);
    const before = await assess(base);
    const after = await assess(withCatalogAliases(base, CATALOG.ingredients));
    out.push({ case: c.id, product_ndc: rec.product_ndc, before, after,
      newly: Object.keys(after.records).filter((n) => !(n in before.records)).map((n) => ({ recall: n, after: after.records[n] })),
      lost: Object.keys(before.records).filter((n) => !(n in after.records)) });
  }
  return out;
}

if (isMain) {
  const out = await runC2Comparison();
  if (record) saveCassette(CASSETTE, cassette);
  for (const r of out) console.log(`${r.case} [${r.product_ndc}]: ${Object.keys(r.before.records).length} -> ${Object.keys(r.after.records).length} records; ${r.before.finding} -> ${r.after.finding}; new: ${r.newly.map((n) => `${n.recall} ${n.after}`).join(' | ')}; lost ${r.lost.length}`);
}
