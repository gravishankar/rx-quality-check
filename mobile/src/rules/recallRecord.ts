/**
 * Per-record recall relevance (ARCHITECTURE §5.3, R-EV-1…R-EV-6).
 *
 * Decides, for one FDA enforcement record and one confirmed identity, whether the record is about
 * the patient's product. The rules are deliberately asymmetric:
 *  - A record is a PRODUCT_MATCH only when its own text names the patient's product NDC.
 *  - A record is OTHER_PRODUCT only on explicit evidence: text NDCs that name other products (and the
 *    NDC list was fully parsed), or an explicitly different ingredient set, salt, strength, dose
 *    form, release mechanism or route.
 *  - Everything else is POSSIBLE_MATCH. Missing or unparseable text never rules a record out.
 *
 * A product-level match alone never confirms a lot-specific recall: the user's confirmed lot must be
 * listed (lot.ts). `openfda.product_ndc` covers every strength on a label, so a structured NDC hit
 * without a text NDC is only POSSIBLE_MATCH.
 */
import type { LotComparison, LotScope, RecordAssessment, RecordReason, RecordRelevance } from '../models/evidence.ts';
import type { MedicationIdentity, Strength } from '../models/identity.ts';
import { isRecord } from '../models/lookup.ts';
import { compareRelease, formEvidenceFromText, productSegment } from './doseForm.ts';
import { readIngredientsFromText } from './ingredients.ts';
import { compareLot, parseLotScope } from './lot.ts';
import { extractNdcsWithKeys, packageKey, productKeyOfProductNdc } from './ndc.ts';
import { extractStrengthExpressions, sameStrength, sameStrengthSet, type StrengthExpression } from './strength.ts';
import { sourceProductUncertain } from './sourceProduct.ts';

const REQUIRED_STRING_FIELDS = [
  'recall_number',
  'status',
  'classification',
  'product_description',
  'code_info',
  'recalling_firm',
  'reason_for_recall',
  'report_date',
] as const;

export interface ValidEnforcementRecord {
  recall_number: string;
  status: string;
  classification: string;
  product_description: string;
  code_info: string;
  recalling_firm: string;
  reason_for_recall: string;
  report_date: string;
  recall_initiation_date: string | null;
  termination_date: string | null;
  structuredProductNdcs: string[] | null;
}

/** Defensive per-record validation; the service layer validates pages, cached data may be older. */
export function validateRecord(r: unknown): ValidEnforcementRecord | null {
  if (!isRecord(r)) return null;
  for (const k of REQUIRED_STRING_FIELDS) if (typeof r[k] !== 'string') return null;
  if ((r.product_description as string).trim() === '' || (r.recall_number as string).trim() === '') return null;
  let structured: string[] | null = null;
  if (r.openfda !== undefined) {
    if (!isRecord(r.openfda)) return null;
    const p = r.openfda.product_ndc;
    if (p !== undefined) {
      if (!Array.isArray(p) || !p.every((x) => typeof x === 'string')) return null;
      structured = p as string[];
    }
  }
  const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    recall_number: r.recall_number as string,
    status: r.status as string,
    classification: r.classification as string,
    product_description: r.product_description as string,
    code_info: r.code_info as string,
    recalling_firm: r.recalling_firm as string,
    reason_for_recall: r.reason_for_recall as string,
    report_date: r.report_date as string,
    recall_initiation_date: optStr(r.recall_initiation_date),
    termination_date: optStr(r.termination_date),
    structuredProductNdcs: structured,
  };
}

interface AttributeComparison {
  /** Explicit evidence of a different product. */
  differences: RecordReason[];
  /** Attributes the text does not settle. */
  unknowns: RecordReason[];
}

type Pairing = 'SAME' | 'DIFFERENT' | 'UNKNOWN';

/**
 * Order of the ingredient names that belong to one strength expression (review round 2, issue 1):
 * the shortest run of text just before the expression (after the previous expression) that names
 * every ingredient, each exactly once. Null when no such run exists: the pairing is not established.
 */
function localOrder(text: string, from: number, to: number, names: readonly string[], aliases: Readonly<Record<string, string>>): string[] | null {
  const lower = text.slice(from, to).toLowerCase();
  const hits: { at: number; name: string }[] = [];
  const terms: [string, string][] = [...names.map((n): [string, string] => [n, n]), ...Object.entries(aliases).filter(([, v]) => names.includes(v))];
  for (const [term, name] of terms) {
    const re = new RegExp(`(^|[^a-z])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'g');
    for (const m of lower.matchAll(re)) hits.push({ at: (m.index ?? 0) + (m[1]?.length ?? 0), name });
  }
  hits.sort((x, y) => x.at - y.at);
  const seen = new Set<string>();
  let start = hits.length;
  for (let k = hits.length - 1; k >= 0 && seen.size < names.length; k--) {
    seen.add((hits[k] as { name: string }).name);
    start = k;
  }
  if (seen.size < names.length) return null;
  const run = hits.slice(start).map((h) => h.name);
  return new Set(run).size === run.length ? run : null;
}

/**
 * Compare one strength expression with the product (C1, review round 2). A difference is claimed
 * only when proven: the values differ as a multiset (no pairing can match), or the locally
 * established pairing differs. Equal values with an unestablished pairing are UNKNOWN, never SAME.
 */
function strengthPairing(e: StrengthExpression, from: number, identity: MedicationIdentity, ids: readonly Strength[], text: string, aliases: Readonly<Record<string, string>>): Pairing {
  const names = identity.ingredients.map((i) => i.name);
  if (!sameStrengthSet(e.components, ids)) return 'DIFFERENT';
  if (names.length < 2) return 'SAME';
  if (new Set(names).size !== names.length || e.index === undefined) return 'UNKNOWN';
  const order = localOrder(text, from, e.index, names, aliases);
  if (order === null) return 'UNKNOWN';
  return order.every((n, k) => sameStrength(e.components[k] as Strength, ids[names.indexOf(n)] as Strength)) ? 'SAME' : 'DIFFERENT';
}

/** Compare identity attributes with what the record's text explicitly states. */
export function compareAttributes(identity: MedicationIdentity, description: string): AttributeComparison {
  const differences: RecordReason[] = [];
  const unknowns: RecordReason[] = [];
  const seg = productSegment(description);
  const names = identity.ingredients.map((i) => i.name);

  // Ingredient set and salt.
  const aliases: Record<string, string> = {};
  for (const i of identity.ingredients) for (const a of i.aliases ?? []) aliases[a.toLowerCase()] = i.name;
  let ing = readIngredientsFromText(seg, names, aliases);
  if (ing.found.length === 0) ing = readIngredientsFromText(description, names, aliases);
  if (ing.partners.length > 0) differences.push('COMBINATION_PRODUCT');
  if (ing.found.length === 0 || ing.missing.length > 0) unknowns.push('INGREDIENT_NOT_IN_TEXT');
  for (const i of identity.ingredients) {
    const textSalt = ing.salts[i.name];
    if (i.salt !== null && textSalt !== undefined && textSalt !== null && textSalt !== i.salt) {
      differences.push('DIFFERENT_SALT');
      break;
    }
  }

  // Strength.
  const idStrengths = identity.ingredients.map((i) => i.strength);
  if (idStrengths.some((s) => s === null)) {
    unknowns.push('STRENGTH_NOT_STATED');
  } else {
    const ids = idStrengths as Strength[];
    let source = seg;
    let exprs = extractStrengthExpressions(seg);
    if (exprs.length === 0) {
      source = description;
      exprs = extractStrengthExpressions(description);
    }
    // Each expression's local window starts where the previous expression ended.
    const windows = exprs.map((e, k) => {
      const prev = k > 0 ? exprs[k - 1] : undefined;
      return prev && prev.index !== undefined ? prev.index + prev.text.length : 0;
    });
    const comparable = exprs.map((e, k) => ({ e, from: windows[k] as number })).filter(({ e }) =>
      e.components.every((c) => ids.some((s) => s.unit === c.unit && s.per === c.per)),
    );
    if (comparable.length === 0) {
      unknowns.push('STRENGTH_NOT_STATED');
    } else {
      const results = comparable.map(({ e, from }) =>
        e.components.length !== ids.length
          ? // Review item 1 (fallback): a different number of values than ingredients proves a
            // difference only if none of its values equals any of the product's strengths.
            e.components.some((c) => ids.some((s) => sameStrength(c, s)))
            ? 'PARTIAL'
            : 'DIFFERENT'
          : strengthPairing(e, from, identity, ids, source, aliases),
      );
      if (!results.includes('SAME')) {
        if (results.includes('UNKNOWN')) unknowns.push('STRENGTH_ASSOCIATION_UNCLEAR');
        else if (results.includes('PARTIAL')) unknowns.push('STRENGTH_PARTIALLY_STATED');
        else differences.push('STRENGTH_DIFFERS');
      }
    }
  }

  // Dose form, route and release.
  const fe = formEvidenceFromText(seg);
  if (fe.nonOral.length > 0) differences.push('NON_ORAL_OR_NOT_FINISHED_PRODUCT');
  if (fe.forms.length === 0) unknowns.push('DOSE_FORM_NOT_STATED');
  else if (!fe.forms.includes(identity.doseForm)) differences.push('DOSE_FORM_DIFFERS');
  const rel = compareRelease(identity.release, fe.release);
  if (rel === 'DIFFERENT') differences.push('RELEASE_DIFFERS');
  else if (rel === 'UNKNOWN') unknowns.push(fe.release === 'CONFLICTING' ? 'RELEASE_CONFLICTING_IN_TEXT' : 'RELEASE_NOT_STATED');

  return { differences, unknowns };
}

function lotOutcome(
  scope: LotScope,
  lot: LotComparison,
): { classification: 'CONFIRMED_MATCH' | 'POTENTIAL_MATCH'; reasons: RecordReason[]; lot: LotComparison } {
  switch (scope.kind) {
    case 'ALL_LOTS':
      return { classification: 'CONFIRMED_MATCH', reasons: ['ALL_LOTS'], lot: 'LOT_NOT_REQUIRED' };
    case 'ALL_LOTS_CONDITIONAL':
      return { classification: 'POTENTIAL_MATCH', reasons: ['LOT_SCOPE_CONDITIONAL'], lot };
    case 'LOT_SPECIFIC':
    case 'UNKNOWN': {
      switch (lot) {
        case 'LOT_LISTED':
          return { classification: 'CONFIRMED_MATCH', reasons: ['LOT_LISTED'], lot };
        case 'LOT_POSSIBLY_LISTED':
          return { classification: 'POTENTIAL_MATCH', reasons: ['LOT_POSSIBLY_LISTED'], lot };
        case 'LOT_NOT_FOUND_IN_LISTING':
          return {
            classification: 'POTENTIAL_MATCH',
            reasons: scope.kind === 'UNKNOWN' ? ['LOT_SCOPE_UNPARSED', 'LOT_NOT_FOUND_IN_LISTING'] : ['LOT_NOT_FOUND_IN_LISTING'],
            lot,
          };
        case 'LOT_UNKNOWN':
        case 'LOT_NOT_REQUIRED':
          return {
            classification: 'POTENTIAL_MATCH',
            reasons: scope.kind === 'UNKNOWN' ? ['LOT_SCOPE_UNPARSED', 'LOT_REQUIRED'] : ['LOT_REQUIRED'],
            lot: 'LOT_UNKNOWN',
          };
      }
    }
  }
}

/** Assess one enforcement record against a confirmed identity. */
export function assessRecord(identity: MedicationIdentity, raw: unknown, foundBy: string[]): RecordAssessment {
  const rec = validateRecord(raw);
  if (rec === null) {
    const rn = isRecord(raw) && typeof raw.recall_number === 'string' && raw.recall_number !== '' ? raw.recall_number : '(unreadable record)';
    return {
      recallNumber: rn,
      relevance: 'UNPARSEABLE',
      classification: 'UNRESOLVED',
      lotScope: { kind: 'UNKNOWN' },
      lot: identity.lot === null ? 'LOT_UNKNOWN' : 'LOT_NOT_FOUND_IN_LISTING',
      reasons: ['RECORD_SCHEMA_INVALID'],
      published: null,
      foundBy,
    };
  }

  const published = {
    classification: rec.classification,
    status: rec.status,
    reportDate: rec.report_date,
    recallInitiationDate: rec.recall_initiation_date,
    terminationDate: rec.termination_date,
    recallingFirm: rec.recalling_firm,
    reasonForRecall: rec.reason_for_recall,
    productDescription: rec.product_description,
    codeInfo: rec.code_info,
  };
  const lotScope = parseLotScope(rec.code_info);
  const lotCmp = compareLot(identity.lot, rec.code_info);
  const attrs = compareAttributes(identity, rec.product_description);

  const textNdc = extractNdcsWithKeys(rec.product_description);
  const codeNdc = extractNdcsWithKeys(rec.code_info, { requireLabel: true });
  const textProductKeys = new Set([...textNdc.ndcs, ...codeNdc.ndcs].map((n) => n.productKey));
  const textPackageKeys = new Set([...textNdc.ndcs, ...codeNdc.ndcs].map((n) => n.packageKey));

  const done = (
    relevance: RecordRelevance,
    classification: RecordAssessment['classification'],
    reasons: RecordReason[],
    lot: LotComparison = lotCmp,
  ): RecordAssessment => ({
    recallNumber: rec.recall_number,
    relevance,
    classification,
    lotScope,
    lot,
    reasons: [...new Set(reasons)],
    published,
    foundBy,
  });

  const productKey = identity.level === 'PRODUCT' && identity.productNdc !== null ? productKeyOfProductNdc(identity.productNdc) : null;

  if (productKey === null) {
    // Clinical-drug identity: never a product match.
    if (attrs.differences.length > 0) return done('OTHER_PRODUCT', 'NOT_APPLICABLE', attrs.differences);
    return done('POSSIBLE_MATCH', 'POTENTIAL_MATCH', ['PRODUCT_NOT_IDENTIFIED', ...attrs.unknowns]);
  }

  // R-EV-1: the record's text names the patient's product NDC.
  if (textProductKeys.has(productKey)) {
    if (attrs.differences.length > 0) {
      // The NDC says "your product" but the text describes something else: do not confirm.
      return done('POSSIBLE_MATCH', 'POTENTIAL_MATCH', ['TEXT_NDC_MATCHES_PRODUCT', 'TEXT_NDC_STRENGTH_CONFLICT', ...attrs.differences]);
    }
    if (identity.packageNdc !== null) {
      const pk = packageKey(identity.packageNdc);
      const sameProductPackages = [...textPackageKeys].filter((k) => k.slice(0, 9) === productKey);
      if (pk !== null && sameProductPackages.length > 0 && !sameProductPackages.includes(pk)) {
        return done('PRODUCT_MATCH', 'POTENTIAL_MATCH', ['TEXT_NDC_MATCHES_PRODUCT', 'PACKAGE_NOT_LISTED']);
      }
    }
    const lo = lotOutcome(lotScope, lotCmp);
    return done('PRODUCT_MATCH', lo.classification, ['TEXT_NDC_MATCHES_PRODUCT', ...lo.reasons], lo.lot);
  }

  // RP-4: the record names a product this product was repackaged from.
  const related = identity.relatedSourceProductNdcs.map(productKeyOfProductNdc).filter((k): k is string => k !== null);
  if (related.some((k) => textProductKeys.has(k)) && attrs.differences.length === 0) {
    return done('POSSIBLE_MATCH', 'POTENTIAL_MATCH', ['TEXT_NDC_MATCHES_RELATED_SOURCE_PRODUCT', ...attrs.unknowns]);
  }

  // R-EV-4: explicit evidence of a different product.
  if (attrs.differences.length > 0) return done('OTHER_PRODUCT', 'NOT_APPLICABLE', attrs.differences);
  // OD-33 (approved 2026-11-13): when where this product came from is unresolved, a notice that is
  // ruled out only because it names other NDCs could be about the unknown source product. With no
  // independent evidence of a different product (checked above), it stays a possible match.
  const sourceUnresolved = sourceProductUncertain(identity);
  if (textProductKeys.size > 0) {
    if (textNdc.unparsedMentions === 0) {
      if (sourceUnresolved) return done('POSSIBLE_MATCH', 'POTENTIAL_MATCH', ['SOURCE_PRODUCT_UNRESOLVED', 'TEXT_NDC_NAMES_OTHER_PRODUCTS', ...attrs.unknowns]);
      return done('OTHER_PRODUCT', 'NOT_APPLICABLE', ['TEXT_NDC_NAMES_OTHER_PRODUCTS']);
    }
    // R-EV-5: an NDC list we could not fully read never rules the product out.
    return done('POSSIBLE_MATCH', 'POTENTIAL_MATCH', ['TEXT_NDC_LIST_INCOMPLETE', ...attrs.unknowns]);
  }

  // No NDC in the text. Structured openfda.product_ndc is supporting evidence only (R-EV-2).
  const structured = rec.structuredProductNdcs?.map(productKeyOfProductNdc).filter((k): k is string => k !== null) ?? [];
  if (structured.includes(productKey)) {
    return done('POSSIBLE_MATCH', 'POTENTIAL_MATCH', ['STRUCTURED_NDC_ONLY', ...attrs.unknowns]);
  }
  if (structured.length > 0 && textNdc.unparsedMentions === 0) {
    const labeler = productKey.slice(0, 5);
    if (!structured.some((k) => k.slice(0, 5) === labeler)) {
      if (sourceUnresolved) return done('POSSIBLE_MATCH', 'POTENTIAL_MATCH', ['SOURCE_PRODUCT_UNRESOLVED', 'STRUCTURED_NDC_EXCLUDES_PRODUCT', ...attrs.unknowns]);
      return done('OTHER_PRODUCT', 'NOT_APPLICABLE', ['STRUCTURED_NDC_EXCLUDES_PRODUCT']);
    }
  }
  // R-EV-3: same ingredient/strength/form (or not stated) and no product-level evidence either way.
  return done('POSSIBLE_MATCH', 'POTENTIAL_MATCH', [
    textNdc.unparsedMentions > 0 ? 'TEXT_NDC_LIST_INCOMPLETE' : 'NO_PRODUCT_LEVEL_EVIDENCE',
    ...attrs.unknowns,
  ]);
}
