/**
 * F1 before/after recall retrieval on real FDA data, through the app's own evidence path
 * (runEffect FETCH_RECALL_EVIDENCE → evaluateRecallEvidence). "Before" reads ingredient names with the
 * pre-F1 reader (build/f1/ingredients_before.ts, from git), "after" with the current one.
 *   record:  NODE_USE_ENV_PROXY=1 npx tsx scripts/catalog/f1_before_after.ts --record
 *   replay:  npx tsx scripts/catalog/f1_before_after.ts            (offline, from tests/fixtures/f1/)
 * Writes build/f1/before_after.json and prints a summary.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { directoryProductFrom, identityFromProduct } from '../../mobile/src/rules/identity.ts';
import { evaluateRecallEvidence } from '../../mobile/src/rules/recallEvidence.ts';
import { runEffect, DEFAULT_RX_RULES, type Ports } from '../../mobile/src/engine/runner.ts';
import { createOpenFdaClient } from '../../mobile/src/services/openfda.ts';
import { splitIngredientName as oldSplit } from '../../tests/fixtures/f1/ingredients_before_f1.ts';
import { liveTransport, loadCassette, recordingTransport, replayTransport, saveCassette, type Cassette } from '../lib/cassette.ts';
import type { MedicationIdentity } from '../../mobile/src/models/identity.ts';
import type { OpenFdaNdcProduct } from '../../mobile/src/models/openfda.ts';

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const record = isMain && process.argv.includes('--record');
const CASSETTE = 'tests/fixtures/f1/cassette.json';
const EXEMPLARS = 'tests/fixtures/f1/exemplars.json';
const NOW = '2026-11-13T12:00:00.000Z';
const cassette: Cassette = record || !existsSync(CASSETTE)
  ? { _fixture: { source: 'openFDA NDC Directory and enforcement, live HTTPS (scripts/catalog/f1_before_after.ts --record)', capturedAt: new Date().toISOString(), note: 'F1 before/after recall retrieval' }, entries: {} }
  : loadCassette(CASSETTE);
const transport = record ? recordingTransport(liveTransport(), cassette) : replayTransport(cassette);
const fda = createOpenFdaClient({ transport, now: () => NOW });

// Affected drugs (F1 search gaps) and extra salt forms of the same ingredients, to test false positives.
const CASES: { id: string; search: string }[] = [
  { id: 'clopidogrel bisulfate tablet', search: 'generic_name:"clopidogrel" AND active_ingredients.name:"CLOPIDOGREL BISULFATE"' },
  { id: 'escitalopram oxalate tablet', search: 'active_ingredients.name:"ESCITALOPRAM OXALATE" AND dosage_form:"TABLET, FILM COATED"' },
  { id: 'citalopram hydrobromide tablet', search: 'active_ingredients.name:"CITALOPRAM HYDROBROMIDE" AND dosage_form:"TABLET, FILM COATED"' },
  { id: 'doxycycline hyclate capsule', search: 'active_ingredients.name:"DOXYCYCLINE HYCLATE" AND dosage_form:"CAPSULE"' },
  { id: 'doxycycline monohydrate capsule', search: 'active_ingredients.name:"DOXYCYCLINE" AND dosage_form:"CAPSULE" AND generic_name:"monohydrate"' },
  { id: 'isosorbide mononitrate ER tablet', search: 'active_ingredients.name:"ISOSORBIDE MONONITRATE" AND dosage_form:"TABLET, EXTENDED RELEASE"' },
  { id: 'dapagliflozin tablet', search: 'active_ingredients.name:"DAPAGLIFLOZIN PROPANEDIOL"' },
  { id: 'hydroxyzine hydrochloride tablet', search: 'active_ingredients.name:"HYDROXYZINE DIHYDROCHLORIDE" AND dosage_form:"TABLET, FILM COATED"' },
  { id: 'hydroxyzine pamoate capsule', search: 'active_ingredients.name:"HYDROXYZINE PAMOATE" AND dosage_form:"CAPSULE"' },
  { id: 'sitagliptin tablet', search: 'active_ingredients.name:"SITAGLIPTIN PHOSPHATE" AND generic_name:"sitagliptin" AND NOT generic_name:"metformin"' },
  { id: 'chlorhexidine gluconate oral rinse', search: 'active_ingredients.name:"CHLORHEXIDINE GLUCONATE" AND route:"ORAL"' },
  { id: 'clindamycin palmitate oral solution', search: 'active_ingredients.name:"CLINDAMYCIN PALMITATE HYDROCHLORIDE"' },
  { id: 'clindamycin hydrochloride capsule', search: 'active_ingredients.name:"CLINDAMYCIN HYDROCHLORIDE" AND dosage_form:"CAPSULE"' },
  { id: 'levocetirizine tablet', search: 'active_ingredients.name:"LEVOCETIRIZINE DIHYDROCHLORIDE" AND dosage_form:"TABLET, FILM COATED"' },
  { id: 'pramipexole tablet', search: 'active_ingredients.name:"PRAMIPEXOLE DIHYDROCHLORIDE" AND dosage_form:"TABLET"' },
  { id: 'ketorolac tromethamine tablet', search: 'active_ingredients.name:"KETOROLAC TROMETHAMINE" AND route:"ORAL"' },
  // Controls: unchanged by F1.
  { id: 'CONTROL metformin ER tablet (current drug)', search: 'product_ndc:"62756-142"' },
  { id: 'CONTROL potassium chloride ER tablet', search: 'active_ingredients.name:"POTASSIUM CHLORIDE" AND dosage_form:"TABLET, EXTENDED RELEASE"' },
];

async function exemplars(): Promise<Record<string, OpenFdaNdcProduct>> {
  if (!record) return JSON.parse(readFileSync(EXEMPLARS, 'utf8'));
  const out: Record<string, OpenFdaNdcProduct> = {};
  for (const c of CASES) {
    const url = `https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(`(${c.search}) AND product_type:"HUMAN PRESCRIPTION DRUG" AND marketing_category:"ANDA"`)}&limit=1`;
    let r = await fetch(url);
    if (r.status === 404) r = await fetch(`https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(`(${c.search}) AND product_type:"HUMAN PRESCRIPTION DRUG"`)}&limit=1`);
    const j = (await r.json()) as { results?: OpenFdaNdcProduct[] };
    if (!j.results?.[0]) throw new Error(`no exemplar for ${c.id}`);
    out[c.id] = j.results[0];
  }
  writeFileSync(EXEMPLARS, JSON.stringify(out, null, 1));
  return out;
}

const ports: Ports = {
  extract: async () => null, lookupPackageNdc: async () => { throw new Error('unused'); },
  fetchRecallPage: (q, skip) => fda.enforcementPage(q, skip), loadCachedResult: async () => null,
  persist: async () => undefined, sleep: async () => undefined, now: () => NOW,
};

async function assess(identity: MedicationIdentity) {
  const [ev] = await runEffect({ type: 'FETCH_RECALL_EVIDENCE', identity } as never, ports, {} as never, DEFAULT_RX_RULES);
  if (!ev || ev.type !== 'EVIDENCE_READY') return { error: ev?.type ?? 'none', search: '', retrieved: [] as string[], finding: 'ERROR', records: {} as Record<string, string> };
  const f = evaluateRecallEvidence(identity, ev.bundle);
  const records: Record<string, string> = {};
  for (const [g, list] of [['CONFIRMED', f.confirmed], ['POTENTIAL', f.potential], ['UNRESOLVED', f.unresolved], ['NOT_APPLICABLE', f.notApplicable]] as const)
    for (const r of list) records[r.recallNumber] = `${g}${g === 'NOT_APPLICABLE' || g === 'POTENTIAL' ? ` (${r.reasons.join(', ')})` : ''}`;
  const text = ev.bundle.results.find((r) => r.queryId === 'ingredient_text');
  const retrieved = (text?.pages ?? []).flatMap((p) => (p.kind === 'OK' ? p.data.results.map((x) => (x as { recall_number: string }).recall_number) : []));
  return { search: ev.bundle.plan.queries.find((q) => q.id === 'ingredient_text')?.search ?? '', retrieved: [...new Set(retrieved)], finding: f.finding, records };
}

/** Hold the source product as resolved, to isolate a change from OD-33 (labeled SYNTHETIC where used). */
export const holdSourceResolved = (id: MedicationIdentity): MedicationIdentity => ({ ...id, isOriginalPackager: true, sourceProductStatus: 'NOT_APPLICABLE' });

/**
 * OD-33 on the recorded F1 exemplars: the same identity with its real source information (no
 * enrichment run: packager flag as openFDA publishes it) versus held resolved.
 */
export async function runOd33Comparison() {
  const ex = await exemplars();
  const out = [];
  for (const c of CASES) {
    const rec = ex[c.id]!;
    const real = identityFromProduct(directoryProductFrom(rec), rec.packaging?.[0]?.package_ndc ?? null, null);
    const a = await assess(real), b = await assess(holdSourceResolved(real));
    out.push({ case: c.id, labeler: rec.labeler_name, isOriginalPackager: real.isOriginalPackager ?? null, resolved: b.finding, unresolved: a.finding,
      keptByOd33: Object.keys(a.records).filter((n) => (a.records[n] ?? '').startsWith('POTENTIAL') && (b.records[n] ?? '').startsWith('NOT_APPLICABLE')),
      otherChanges: Object.keys(a.records).filter((n) => a.records[n] !== b.records[n] && !(((a.records[n] ?? '').startsWith('POTENTIAL (SOURCE_PRODUCT_UNRESOLVED')))) });
  }
  return out;
}

export async function runF1Comparison() {
const ex = await exemplars();
const out = [];
for (const c of CASES) {
  const rec = ex[c.id]!;
  const pkg = rec.packaging?.[0]?.package_ndc ?? null;
  // Isolation: this comparison measures F1 only, so the exemplar's source product is held resolved
  // (SYNTHETIC for repackaged exemplars). OD-33's effect on the same data: runOd33Comparison().
  const after = holdSourceResolved(identityFromProduct(directoryProductFrom(rec), pkg, null));
  const actives = rec.active_ingredients ?? [];
  const before: MedicationIdentity = { ...after, ingredients: after.ingredients.map((i, k) => { const o = oldSplit(actives[k]?.name ?? i.name); return { ...i, name: o.name, salt: o.salt }; }) };
  const b = await assess(before), a = await assess(after);
  const newly = a.retrieved.filter((n) => !b.retrieved.includes(n));
  const lost = b.retrieved.filter((n) => !a.retrieved.includes(n));
  const row = { case: c.id, product_ndc: rec.product_ndc, product: `${rec.generic_name} ${rec.dosage_form}`, strength: actives.map((x) => `${x.name} ${x.strength}`).join(' + '),
    before: { search: b.search, retrieved: b.retrieved.length, finding: b.finding }, after: { search: a.search, retrieved: a.retrieved.length, finding: a.finding },
    newly_retrieved: newly.map((n) => ({ recall: n, after: a.records[n] ?? 'not evaluated' })), lost, changed: Object.keys(b.records).filter((n) => a.records[n] && a.records[n] !== b.records[n]).map((n) => ({ recall: n, before: b.records[n], after: a.records[n] })) };
  out.push(row);
  if (isMain) console.log(`${c.id} [${rec.product_ndc}]: ${b.retrieved.length} -> ${a.retrieved.length} retrieved; finding ${b.finding} -> ${a.finding}; lost ${lost.length}; changed ${row.changed.length}`);
}
return out;
}
if (isMain) {
  const out = await runF1Comparison();
  if (record) saveCassette(CASSETTE, cassette);
  writeFileSync('build/f1/before_after.json', JSON.stringify(out, null, 1));
}
