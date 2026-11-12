/**
 * Lightweight SPL (HL7 Structured Product Labeling) establishment extraction for the feasibility
 * harness. This is a deliberately simple string scanner, not a conforming XML parser; Task 3 must
 * replace it with a real XML parser plus fixture-based tests before any production use.
 *
 * Operation codes. Labels below were OBSERVED in live DailyMed SPL XML on 2026-11-12
 * (actDefinition/code displayName), except where marked "unverified":
 *   C43360 MANUFACTURE   C84731 PACK      C84732 LABEL     C25391 ANALYSIS
 *   C73606 REPACK        C73607 RELABEL
 *   C82401 API MANUFACTURE  (from Document A; unverified in this run)
 *
 * NOTE: Document A §1.2 and §4 name C43215 as MANUFACTURE. Live SPL data uses C43360 with
 * displayName "MANUFACTURE"; C43215 was not observed. The parser therefore classifies
 * operations by the code AND the displayName carried in the document itself, and reports
 * every raw code so discrepancies stay visible.
 */

export const OPERATION_LABELS: Record<string, string> = {
  C43360: 'MANUFACTURE',
  C84731: 'PACK',
  C84732: 'LABEL',
  C25391: 'ANALYSIS',
  C73606: 'REPACK',
  C73607: 'RELABEL',
  C82401: 'API MANUFACTURE (unverified)',
};

const MANUFACTURE_CODES = new Set(['C43360']);
const REPACK_RELABEL_CODES = new Set(['C73606', 'C73607']);

export interface SplEstablishment {
  name: string;
  duns: string | null;
  operations: string[]; // NCI codes
  /** displayName values as written in the SPL, keyed by code. */
  operationNames: Record<string, string>;
}

export interface SplEstablishmentSummary {
  establishments: SplEstablishment[];
  operationCounts: Record<string, number>;
  /** Number of establishments with a MANUFACTURE operation (by code or displayName). */
  manufactureEstablishmentCount: number;
  hasManufacture: boolean;
  /** True when the SPL contains no establishment <performance> section at all. */
  noEstablishmentSection: boolean;
  hasRepackOrRelabel: boolean;
  /** Source NDCs from <asEquivalentEntity><definingMaterialKind><code code="..."/> */
  equivalentSourceNdcs: string[];
  /** Product NDCs declared in the SPL (manufacturedProduct code with NDC code system). */
  declaredProductNdcs: string[];
}

const NDC_OID = '2.16.840.1.113883.6.69';
const DUNS_OID = '1.3.6.1.4.1.519.1';

export function summarizeSplEstablishments(xml: string): SplEstablishmentSummary {
  const byKey = new Map<string, SplEstablishment>();
  const perfRe = /<performance>\s*<actDefinition>\s*<code\s+([^>]*?)\/?>/g;
  for (const m of xml.matchAll(perfRe)) {
    const attrs = m[1]!;
    const code = attrs.match(/\bcode="([^"]+)"/)?.[1];
    if (!code) continue;
    const displayName = attrs.match(/\bdisplayName="([^"]*)"/)?.[1] ?? '';
    const idx = m.index ?? 0;
    // The establishment is the nearest enclosing <assignedOrganization> before this performance.
    const orgStart = xml.lastIndexOf('<assignedOrganization>', idx);
    const orgText = orgStart >= 0 ? xml.slice(orgStart, idx) : '';
    const name = decodeEntities(orgText.match(/<name>([^<]*)<\/name>/)?.[1]?.trim() ?? '(unnamed)');
    const duns =
      orgText.match(new RegExp(`<id[^>]*root="${escapeRe(DUNS_OID)}"[^>]*extension="(\\d+)"`))?.[1] ??
      orgText.match(new RegExp(`<id[^>]*extension="(\\d+)"[^>]*root="${escapeRe(DUNS_OID)}"`))?.[1] ??
      null;
    const key = `${orgStart}`;
    const est = byKey.get(key) ?? { name, duns, operations: [], operationNames: {} };
    if (!est.operations.includes(code)) est.operations.push(code);
    est.operationNames[code] = displayName;
    byKey.set(key, est);
  }
  const establishments = [...byKey.values()];
  const operationCounts: Record<string, number> = {};
  for (const e of establishments) {
    for (const op of e.operations) operationCounts[op] = (operationCounts[op] ?? 0) + 1;
  }
  const isManufacture = (e: SplEstablishment) =>
    e.operations.some((c) => MANUFACTURE_CODES.has(c) || e.operationNames[c]?.toUpperCase() === 'MANUFACTURE');
  const manufactureEstablishmentCount = establishments.filter(isManufacture).length;

  const equivalentSourceNdcs = new Set<string>();
  const eqRe = /<asEquivalentEntity[\s\S]*?<definingMaterialKind>\s*<code\s+code="([^"]+)"/g;
  for (const m of xml.matchAll(eqRe)) equivalentSourceNdcs.add(m[1]!);

  const declaredProductNdcs = new Set<string>();
  const prodRe = new RegExp(
    `<manufacturedProduct>\\s*<code\\s+code="([^"]+)"\\s+codeSystem="${escapeRe(NDC_OID)}"`,
    'g',
  );
  for (const m of xml.matchAll(prodRe)) declaredProductNdcs.add(m[1]!);

  return {
    establishments,
    operationCounts,
    manufactureEstablishmentCount,
    hasManufacture: manufactureEstablishmentCount > 0,
    noEstablishmentSection: establishments.length === 0,
    hasRepackOrRelabel: establishments.some((e) => e.operations.some((c) => REPACK_RELABEL_CODES.has(c))),
    equivalentSourceNdcs: [...equivalentSourceNdcs],
    declaredProductNdcs: [...declaredProductNdcs],
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
