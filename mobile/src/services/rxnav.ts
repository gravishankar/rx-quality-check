/**
 * RxNav (RxNorm) client for drug identity normalization: NDC status (NDC → clinical drug RxCUI) and
 * the ingredient concepts (IN / PIN) of a clinical drug. Keyless, direct HTTPS.
 */
import type { LookupOutcome } from '../models/lookup.ts';
import { isRecord } from '../models/lookup.ts';
import { validateRxNavNdcStatus, validateRxNavVersion, type RxNavNdcStatus, type RxNavVersion } from '../models/openfda.ts';
import { requestJson, unavailable, type ClientDeps } from './request.ts';

export const RXNAV_BASE = 'https://rxnav.nlm.nih.gov/REST';

export interface RxNavConcept {
  rxcui: string;
  name: string;
  tty: string;
}

export interface RxNavRelated {
  relatedGroup: { conceptGroup?: { tty: string; conceptProperties?: RxNavConcept[] }[] };
}

export const validateRxNavRelated = (body: unknown): string | null => {
  if (!isRecord(body) || !isRecord(body.relatedGroup)) return 'relatedGroup must be an object';
  const groups = body.relatedGroup.conceptGroup;
  if (groups === undefined) return null;
  if (!Array.isArray(groups)) return 'relatedGroup.conceptGroup must be an array';
  for (const [i, g] of groups.entries()) {
    if (!isRecord(g) || typeof g.tty !== 'string') return `conceptGroup[${i}].tty must be a string`;
    if (g.conceptProperties === undefined) continue;
    if (!Array.isArray(g.conceptProperties)) return `conceptGroup[${i}].conceptProperties must be an array`;
    for (const c of g.conceptProperties) {
      if (!isRecord(c) || typeof c.rxcui !== 'string' || typeof c.name !== 'string' || typeof c.tty !== 'string') return 'concept must have rxcui, name, tty';
    }
  }
  return null;
};

export interface RxNavClient {
  ndcStatus(ndc11: string): Promise<LookupOutcome<RxNavNdcStatus>>;
  ingredientsOf(rxcui: string): Promise<LookupOutcome<RxNavRelated>>;
  version(): Promise<LookupOutcome<RxNavVersion>>;
}

export const ndcStatusUrl = (ndc11: string) => `${RXNAV_BASE}/ndcstatus.json?${new URLSearchParams({ ndc: ndc11 }).toString()}`;
export const relatedUrl = (rxcui: string) => `${RXNAV_BASE}/rxcui/${rxcui}/related.json?${new URLSearchParams({ tty: 'IN PIN' }).toString()}`;

export function createRxNavClient(deps: ClientDeps): RxNavClient {
  return {
    ndcStatus(ndc11) {
      if (!/^\d{11}$/.test(ndc11)) return Promise.resolve(unavailable('RXNAV', '(not sent)', 'REQUEST_BLOCKED', 'not an 11-digit NDC', deps.now()));
      return requestJson(deps, 'RXNAV', ndcStatusUrl(ndc11), validateRxNavNdcStatus);
    },
    ingredientsOf(rxcui) {
      if (!/^\d+$/.test(rxcui)) return Promise.resolve(unavailable('RXNAV', '(not sent)', 'REQUEST_BLOCKED', 'not an RxCUI', deps.now()));
      return requestJson(deps, 'RXNAV', relatedUrl(rxcui), validateRxNavRelated);
    },
    version: () => requestJson(deps, 'RXNAV', `${RXNAV_BASE}/version.json`, validateRxNavVersion),
  };
}

/** IN and PIN concepts from a related response. */
export function conceptsOf(r: RxNavRelated): RxNavConcept[] {
  return (r.relatedGroup.conceptGroup ?? []).flatMap((g) => g.conceptProperties ?? []);
}
