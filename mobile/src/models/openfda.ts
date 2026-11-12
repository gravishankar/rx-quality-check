/**
 * openFDA / DailyMed / RxNav response types and minimal structural validators (moved from
 * scripts/lib/schemas.ts in Task 2; the harness re-exports them from there).
 *
 * Minimal structural validators for the public API responses the app depends on.
 * Each validator returns null when valid, or a description of the first violation.
 * They intentionally check only fields the app relies on; extra fields are allowed.
 */
import { isRecord } from './lookup.ts';

type V = (body: unknown) => string | null;

const str = (o: Record<string, unknown>, k: string, path: string): string | null =>
  typeof o[k] === 'string' ? null : `${path}.${k} must be a string`;
const arr = (o: Record<string, unknown>, k: string, path: string): string | null =>
  Array.isArray(o[k]) ? null : `${path}.${k} must be an array`;

function openFdaEnvelope(body: unknown): string | null {
  if (!isRecord(body)) return 'body must be an object';
  if (!isRecord(body.meta)) return 'meta must be an object';
  if (typeof body.meta.last_updated !== 'string') return 'meta.last_updated must be a string';
  if (!isRecord(body.meta.results)) return 'meta.results must be an object';
  if (typeof body.meta.results.total !== 'number') return 'meta.results.total must be a number';
  if (!Array.isArray(body.results)) return 'results must be an array';
  return null;
}

export interface OpenFdaNdcProduct {
  product_ndc: string;
  generic_name: string;
  labeler_name: string;
  dosage_form: string;
  route?: string[];
  marketing_category?: string;
  application_number?: string;
  finished?: boolean;
  active_ingredients: { name: string; strength: string }[];
  packaging?: { package_ndc: string; description: string }[];
  pharm_class?: string[];
  openfda?: Record<string, unknown>;
  spl_id?: string;
}
export interface OpenFdaEnvelope<T> {
  meta: { last_updated: string; results: { skip: number; limit: number; total: number } };
  results: T[];
}

export const validateOpenFdaNdc: V = (body) => {
  const e = openFdaEnvelope(body);
  if (e) return e;
  const results = (body as { results: unknown[] }).results;
  for (const [i, r] of results.entries()) {
    const p = `results[${i}]`;
    if (!isRecord(r)) return `${p} must be an object`;
    for (const k of ['product_ndc', 'generic_name', 'labeler_name', 'dosage_form']) {
      const v = str(r, k, p);
      if (v) return v;
    }
    const ai = arr(r, 'active_ingredients', p);
    if (ai) return ai;
    for (const [j, a] of (r.active_ingredients as unknown[]).entries()) {
      if (!isRecord(a) || typeof a.name !== 'string' || typeof a.strength !== 'string') {
        return `${p}.active_ingredients[${j}] must have string name and strength`;
      }
    }
    if (r.packaging !== undefined) {
      if (!Array.isArray(r.packaging)) return `${p}.packaging must be an array`;
      for (const [j, pk] of r.packaging.entries()) {
        if (!isRecord(pk) || typeof pk.package_ndc !== 'string') {
          return `${p}.packaging[${j}].package_ndc must be a string`;
        }
      }
    }
  }
  return null;
};

export interface OpenFdaEnforcement {
  recall_number: string;
  status: string;
  classification: string;
  product_description: string;
  code_info: string;
  recalling_firm: string;
  reason_for_recall: string;
  report_date: string;
  recall_initiation_date?: string;
  termination_date?: string;
  product_type: string;
  openfda?: {
    product_ndc?: string[];
    package_ndc?: string[];
    generic_name?: string[];
    substance_name?: string[];
    manufacturer_name?: string[];
    rxcui?: string[];
    spl_set_id?: string[];
    is_original_packager?: boolean[];
    original_packager_product_ndc?: string[];
  };
}

export const validateOpenFdaEnforcement: V = (body) => {
  const e = openFdaEnvelope(body);
  if (e) return e;
  const results = (body as { results: unknown[] }).results;
  for (const [i, r] of results.entries()) {
    const p = `results[${i}]`;
    if (!isRecord(r)) return `${p} must be an object`;
    for (const k of [
      'recall_number',
      'status',
      'classification',
      'product_description',
      'code_info',
      'recalling_firm',
      'reason_for_recall',
      'report_date',
    ]) {
      const v = str(r, k, p);
      if (v) return v;
    }
    if (r.openfda !== undefined && !isRecord(r.openfda)) return `${p}.openfda must be an object`;
  }
  return null;
};

export interface DailyMedSplList {
  data: { setid: string; title: string; spl_version: number; published_date: string }[];
  metadata: { db_published_date: string; total_elements: number | string };
}

export const validateDailyMedSplList: V = (body) => {
  if (!isRecord(body)) return 'body must be an object';
  if (!Array.isArray(body.data)) return 'data must be an array';
  if (!isRecord(body.metadata)) return 'metadata must be an object';
  if (typeof body.metadata.db_published_date !== 'string') {
    return 'metadata.db_published_date must be a string';
  }
  for (const [i, d] of body.data.entries()) {
    if (!isRecord(d) || typeof d.setid !== 'string' || typeof d.title !== 'string') {
      return `data[${i}] must have string setid and title`;
    }
  }
  return null;
};

export interface RxNavIdGroup {
  idGroup: { rxnormId?: string[] };
}
export const validateRxNavIdGroup: V = (body) => {
  if (!isRecord(body) || !isRecord(body.idGroup)) return 'idGroup must be an object';
  const ids = body.idGroup.rxnormId;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string'))) {
    return 'idGroup.rxnormId must be an array of strings';
  }
  return null;
};

export interface RxNavNdcStatus {
  ndcStatus: {
    ndc11: string;
    status: string;
    rxcui: string;
    conceptName: string;
    conceptStatus?: string;
  };
}
export const validateRxNavNdcStatus: V = (body) => {
  if (!isRecord(body) || !isRecord(body.ndcStatus)) return 'ndcStatus must be an object';
  for (const k of ['ndc11', 'status', 'rxcui', 'conceptName']) {
    const v = str(body.ndcStatus, k, 'ndcStatus');
    if (v) return v;
  }
  return null;
};

export interface RxNavVersion {
  version: string;
  apiVersion: string;
}
export const validateRxNavVersion: V = (body) => {
  if (!isRecord(body)) return 'body must be an object';
  return str(body, 'version', '$') ?? str(body, 'apiVersion', '$');
};

/** Accept any JSON value; used only where the harness inspects the body itself. */
export const validateAny: V = () => null;
