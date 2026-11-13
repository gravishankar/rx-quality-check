/**
 * Production implementation of the runner's Ports (engine/runner.ts) over the public-API clients,
 * an optional public-data cache and an optional assessment store. This is the only place where
 * network, cache and storage meet the workflow; the state machine and the recall engine are
 * unchanged and receive validated, classified pages exactly as before.
 *
 * - NDC Directory and recall pages are cached (TTL) only when OK or NO_MATCH; failures are never
 *   cached. Cached answers keep their original retrieval time, so the age stays visible.
 * - Identity enrichment adds RxNav ingredient RxCUIs and VERIFIED repackager source products.
 *   A source relationship is accepted only when the repackager's own SPL declares the source NDC
 *   and the NDC Directory confirms the source has the same ingredients, strengths, dose form and
 *   release mechanism. Nothing is inferred from manufacturer or labeler names.
 */
import type { EnforcementPage, RecallFinding, RecallQuery } from '../models/evidence.ts';
import type { LookupOutcome, SourceId } from '../models/lookup.ts';
import type { MedicationIdentity } from '../models/identity.ts';
import type { Ports } from '../engine/runner.ts';
import type { CachedResult, Capture } from '../state/machine.ts';
import type { LabelExtraction } from '../models/identity.ts';
import { directoryProductFrom } from '../rules/identity.ts';
import { packageKey, productKeyOfProductNdc } from '../rules/ndc.ts';
import { sameStrength } from '../rules/strength.ts';
import type { OpenFdaClient, NdcDirectoryOutcome } from './openfda.ts';
import { enforcementUrl, ndcUrl } from './openfda.ts';
import { conceptsOf, type RxNavClient } from './rxnav.ts';
import { sourceProductsFromSpl, type DailyMedClient } from './dailymed.ts';

/** Cache TTLs (ARCHITECTURE §9). */
export const TTL_MS = { identity: 30 * 24 * 3600_000, recalls: 24 * 3600_000 } as const;
/** Repackager chains are followed at most this deep (cycle-safe). */
export const MAX_SOURCE_DEPTH = 3;

export interface CachedResponse {
  outcome: 'OK' | 'NO_MATCH';
  bodyJson: string | null;
  retrievedAt: string;
  sourceLastUpdated: string | null;
}

/** Public regulatory data cache (implemented by storage/repositories.ts). Holds no patient data. */
export interface SourceCache {
  getFresh(source: string, queryKey: string, now: string): Promise<CachedResponse | null>;
  put(entry: { source: string; queryKey: string; outcome: 'OK' | 'NO_MATCH'; bodyJson: string | null; retrievedAt: string; expiresAt: string; sourceLastUpdated: string | null }): Promise<void>;
}

/** Saved assessments (implemented by storage/repositories.ts). */
export interface AssessmentStore {
  save(identity: MedicationIdentity, finding: RecallFinding): Promise<void>;
  latestFor(identity: MedicationIdentity): Promise<CachedResult | null>;
}

export interface LivePortsOptions {
  openfda: OpenFdaClient;
  rxnav?: RxNavClient;
  dailymed?: DailyMedClient;
  cache?: SourceCache;
  store?: AssessmentStore;
  extract?: (capture: Capture) => Promise<LabelExtraction | null>;
  now: () => string;
  sleep: (ms: number) => Promise<void>;
}

const addMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

async function cached<T>(
  o: LivePortsOptions,
  source: 'OPENFDA_NDC' | 'OPENFDA_ENFORCEMENT',
  key: string,
  ttl: number,
  fetchIt: () => Promise<LookupOutcome<T>>,
): Promise<LookupOutcome<T>> {
  const sourceId: SourceId = 'OPENFDA';
  if (o.cache) {
    const hit = await o.cache.getFresh(source, key, o.now());
    if (hit) {
      const meta = { source: sourceId, url: key, httpStatus: hit.outcome === 'OK' ? 200 : 404, retrievedAt: hit.retrievedAt, elapsedMs: 0, headers: { 'x-served-from': 'local-cache' } };
      return hit.outcome === 'OK' && hit.bodyJson !== null ? { kind: 'OK', data: JSON.parse(hit.bodyJson) as T, meta } : { kind: 'NO_MATCH', meta };
    }
  }
  const r = await fetchIt();
  if (o.cache && (r.kind === 'OK' || r.kind === 'NO_MATCH')) {
    const lastUpdated = r.kind === 'OK' ? ((r.data as { meta?: { last_updated?: string } }).meta?.last_updated ?? null) : null;
    await o.cache.put({ source, queryKey: key, outcome: r.kind, bodyJson: r.kind === 'OK' ? JSON.stringify(r.data) : null, retrievedAt: r.meta.retrievedAt, expiresAt: addMs(r.meta.retrievedAt, ttl), sourceLastUpdated: lastUpdated });
  }
  return r;
}

export function sameFormulation(a: MedicationIdentity, b: ReturnType<typeof directoryProductFrom>): boolean {
  const names = (xs: { name: string }[]) => xs.map((x) => x.name).sort().join('+');
  if (names(a.ingredients) !== names(b.ingredients)) return false;
  // Each ingredient's own strength (C1/C3): swapped combination strengths are a different product.
  if (new Set(a.ingredients.map((i) => i.name)).size !== a.ingredients.length) return false;
  for (const ia of a.ingredients) {
    const ib = b.ingredients.find((x) => x.name === ia.name);
    if (!ia.strength || !ib?.strength || !sameStrength(ia.strength, ib.strength)) return false;
    // Review round 2, issue 3: the salt is part of the formulation (an unknown salt on either side
    // cannot be verified as the same).
    if ((ia.salt ?? null) !== (ib.salt ?? null)) return false;
  }
  return a.doseForm === b.doseForm && a.release === b.release;
}

export function createLivePorts(o: LivePortsOptions): Ports {
  const lookupProduct = (productNdc: string): Promise<NdcDirectoryOutcome> =>
    cached(o, 'OPENFDA_NDC', ndcUrl(`product_ndc:"${productNdc}"`), TTL_MS.identity, () => o.openfda.ndcByProduct(productNdc));

  async function ingredientRxcuis(identity: MedicationIdentity): Promise<MedicationIdentity> {
    if (!o.rxnav || identity.packageNdc === null) return identity;
    const ndc11 = packageKey(identity.packageNdc);
    if (ndc11 === null) return identity;
    const st = await o.rxnav.ndcStatus(ndc11);
    if (st.kind !== 'OK' || st.data.ndcStatus.status !== 'ACTIVE' || !/^\d+$/.test(st.data.ndcStatus.rxcui)) return identity;
    const rel = await o.rxnav.ingredientsOf(st.data.ndcStatus.rxcui);
    if (rel.kind !== 'OK') return identity;
    const ins = conceptsOf(rel.data).filter((c) => c.tty === 'IN');
    return {
      ...identity,
      // Only an exact name match assigns an RxCUI; otherwise the ingredient stays name-matched.
      ingredients: identity.ingredients.map((i) => {
        const c = ins.find((x) => x.name.toLowerCase() === i.name);
        return c && i.rxcui === null ? { ...i, rxcui: c.rxcui } : i;
      }),
    };
  }

  async function sourceProducts(identity: MedicationIdentity): Promise<MedicationIdentity> {
    if (identity.level !== 'PRODUCT' || identity.productNdc === null) return identity;
    if (identity.isOriginalPackager === true) return { ...identity, sourceProductStatus: 'NOT_APPLICABLE' };
    // Repackager, or unknown (openFDA does not always publish is_original_packager): the product's
    // own SPL is the authoritative declaration of a source product.
    if (!o.dailymed || !identity.splSetId) {
      return { ...identity, sourceProductStatus: identity.isOriginalPackager === false ? 'NOT_ESTABLISHED' : 'NOT_CHECKED' };
    }
    const verified: string[] = [];
    // unavailable: a lookup failed. incomplete: the chain could not be followed to its end (depth
    // limit, a cycle, an unreadable SPL further down, or a source whose packager status is unknown).
    let unavailable = false;
    let incomplete = false;
    const self = productKeyOfProductNdc(identity.productNdc);
    const visited = new Set<string>();
    const walk = async (productNdc: string, setId: string | null, depth: number): Promise<void> => {
      const key = productKeyOfProductNdc(productNdc);
      if (key === null || setId === null) return void (incomplete = true);
      if (visited.has(key)) return void (incomplete = true);
      if (depth >= MAX_SOURCE_DEPTH) return void (incomplete = true);
      visited.add(key);
      const spl = await o.dailymed!.splXml(setId);
      if (spl.kind !== 'OK') {
        if (spl.kind !== 'NO_MATCH') unavailable = true;
        else if (depth > 0) incomplete = true;
        return;
      }
      const reading = sourceProductsFromSpl(spl.data, productNdc);
      if (reading.kind === 'UNREADABLE') return void (unavailable = true);
      if (reading.kind !== 'SOURCES') {
        // A source that is itself a repackager but declares nothing: the chain stops short.
        if (depth > 0) incomplete = true;
        return;
      }
      for (const src of reading.sourceProductNdcs) {
        if (productKeyOfProductNdc(src) === self) {
          incomplete = true; // the chain leads back to the product itself
          continue;
        }
        const res = await lookupProduct(src);
        if (res.kind !== 'OK') {
          if (res.kind !== 'NO_MATCH') unavailable = true;
          else incomplete = true;
          continue;
        }
        // Review round 2, issue 2: a declared source that the directory does not list under its NDC,
        // or lists with another formulation, is a rejected branch: the chain is not fully verified.
        let branchVerified = false;
        for (const rec of res.data.results) {
          const p = directoryProductFrom(rec);
          if (productKeyOfProductNdc(p.productNdc) !== productKeyOfProductNdc(src) || !sameFormulation(identity, p)) continue;
          branchVerified = true;
          if (!verified.includes(p.productNdc)) verified.push(p.productNdc);
          if (p.isOriginalPackager === false) await walk(p.productNdc, p.splSetId ?? null, depth + 1);
          else if (p.isOriginalPackager !== true) incomplete = true;
        }
        if (!branchVerified) incomplete = true;
      }
    };
    await walk(identity.productNdc, identity.splSetId ?? null, 0);
    const status = verified.length > 0 ? (unavailable || incomplete ? 'PARTIAL' : 'VERIFIED') : unavailable ? 'UNAVAILABLE' : 'NOT_ESTABLISHED';
    return { ...identity, relatedSourceProductNdcs: verified, sourceProductStatus: status };
  }

  return {
    extract: async (capture) => (o.extract ? o.extract(capture) : null),
    lookupPackageNdc: (packageNdc) =>
      cached(o, 'OPENFDA_NDC', ndcUrl(`packaging.package_ndc:"${packageNdc}"`), TTL_MS.identity, () => o.openfda.ndcByPackage(packageNdc)),
    fetchRecallPage: (query: RecallQuery, skip: number): Promise<EnforcementPage> =>
      // The positive control is never served from cache: it must prove the live query path works.
      query.kind === 'POSITIVE_CONTROL'
        ? o.openfda.enforcementPage(query, skip)
        : cached(o, 'OPENFDA_ENFORCEMENT', enforcementUrl(query, skip), TTL_MS.recalls, () => o.openfda.enforcementPage(query, skip)),
    enrichIdentity: async (identity) => sourceProducts(await ingredientRxcuis(identity)),
    loadCachedResult: async (identity) => (o.store && identity ? o.store.latestFor(identity) : null),
    persist: async (identity, finding) => {
      if (!o.store) throw new Error('no local store configured');
      await o.store.save(identity, finding);
    },
    sleep: o.sleep,
    now: o.now,
  };
}
