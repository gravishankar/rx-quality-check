/**
 * DailyMed SPL client, used only to relate a repackaged product to the product it was repackaged
 * from (product identity resolution, not manufacturing provenance). No establishment, facility or
 * operation data is read.
 *
 * In SPL, a repackager's product lists its source product as
 *   <manufacturedProduct><code code="<repackaged NDC>" codeSystem="2.16.840.1.113883.6.69"/> …
 *     <asEquivalentEntity classCode="EQUIV"><definingMaterialKind>
 *       <code code="<source NDC>" codeSystem="2.16.840.1.113883.6.69"/>
 * (verified in tests/fixtures/spl/repackager_*.xml, live DailyMed 2026-11-12).
 */
import type { LookupOutcome } from '../models/lookup.ts';
import { productKeyOfProductNdc } from '../rules/ndc.ts';
import { requestText, unavailable, type ClientDeps } from './request.ts';
import { child, findAll, parseXml, XmlError } from './xml.ts';

export const DAILYMED_BASE = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
export const NDC_CODE_SYSTEM = '2.16.840.1.113883.6.69';

export const splXmlUrl = (setId: string) => `${DAILYMED_BASE}/spls/${setId}.xml`;

export interface DailyMedClient {
  splXml(setId: string): Promise<LookupOutcome<string>>;
}

export function createDailyMedClient(deps: ClientDeps): DailyMedClient {
  return {
    splXml(setId) {
      if (!/^[0-9a-f-]{36}$/i.test(setId)) return Promise.resolve(unavailable('DAILYMED', '(not sent)', 'REQUEST_BLOCKED', 'not an SPL set id', deps.now()));
      // DailyMed answers HTTP 406 to `Accept: application/xml` (verified Task 1); send */*.
      return requestText(deps, 'DAILYMED', splXmlUrl(setId), (t) => t.includes('<document'), { accept: '*/*' });
    },
  };
}

export type SourceProductReading =
  | { kind: 'SOURCES'; sourceProductNdcs: string[] }
  | { kind: 'NO_SOURCE_LISTED' }
  | { kind: 'PRODUCT_NOT_IN_SPL' }
  | { kind: 'UNREADABLE'; detail: string };

/**
 * Source product NDCs declared for one product of an SPL. Only the product whose own NDC matches
 * is read (an SPL may describe several products). Source codes are returned as product NDCs.
 */
export function sourceProductsFromSpl(xml: string, productNdc: string): SourceProductReading {
  let doc;
  try {
    doc = parseXml(xml);
  } catch (e) {
    return { kind: 'UNREADABLE', detail: e instanceof XmlError ? e.message : String(e) };
  }
  const want = productKeyOfProductNdc(productNdc);
  const products = findAll(doc, 'manufacturedProduct').filter((p) => {
    const code = child(p, 'code');
    return code?.attrs.codeSystem === NDC_CODE_SYSTEM && code.attrs.code !== undefined && productKeyOfProductNdc(code.attrs.code) === want;
  });
  if (products.length === 0) return { kind: 'PRODUCT_NOT_IN_SPL' };
  const sources = new Set<string>();
  for (const p of products) {
    for (const eq of p.children.filter((c) => c.name === 'asEquivalentEntity')) {
      const code = child(child(eq, 'definingMaterialKind') ?? eq, 'code');
      const c = code?.attrs.code;
      if (code?.attrs.codeSystem !== NDC_CODE_SYSTEM || c === undefined) continue;
      const parts = c.split('-');
      const product = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : c;
      const key = productKeyOfProductNdc(product);
      if (key !== null && key !== want) sources.add(product);
    }
  }
  return sources.size === 0 ? { kind: 'NO_SOURCE_LISTED' } : { kind: 'SOURCES', sourceProductNdcs: [...sources] };
}
