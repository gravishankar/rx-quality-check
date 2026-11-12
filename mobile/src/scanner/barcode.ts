/**
 * Interpret decoded barcodes (pure). Only symbols whose structure carries an NDC are used:
 *   - UPC-A starting with "3" (often reported as EAN-13 "03…"), with a valid check digit;
 *   - GS1 element strings with AI (01) GTIN-14 carrying "03" after the indicator digit
 *     (GS1 DataMatrix "]d2", GS1-128 "]C1", or a DataMatrix whose data starts with AI 01 and
 *     whose GTIN check digit is valid), from which lot (AI 10) and expiry (AI 17) are also read.
 * Everything else — notably the Code 128 barcodes printed on pharmacy labels, which encode Rx or
 * store numbers — is NOT a drug code and is never turned into an NDC. Serial numbers (AI 21) are
 * discarded and never stored.
 */
import { parseNdcInput } from '../rules/ndc.ts';

export interface ScannedBarcode {
  /** Engine format name, e.g. "UPC_A", "EAN_13", "CODE_128", "DATA_MATRIX". */
  format: string;
  text: string;
  /** ISO/IEC 15424 symbology identifier when the engine reports it (e.g. "]d2"). */
  symbology: string | null;
}

export type BarcodeReading =
  | { kind: 'NDC_CODE'; source: 'UPC' | 'GS1'; code: string; gtin: string | null; lot: string | null; expiry: string | null; format: string }
  | { kind: 'NOT_A_DRUG_CODE'; format: string; reason: string };

const GS = '\u001d';

/** GS1 element string → AI map (01, 10, 17, 21 and fixed-length AIs needed to walk the string). */
export function parseGs1(data: string): Map<string, string> | null {
  const s = data.replace(/^\]([dC])[0-9]/, '');
  const FIXED: Record<string, number> = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
  const VARIABLE = new Set(['10', '21', '22', '240', '241', '30', '37', '90', '91', '92', '93', '94', '95', '96', '97', '98', '99', '710', '711', '712', '713', '714', '715']);
  const out = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) {
      i++;
      continue;
    }
    const ai2 = s.slice(i, i + 2);
    const ai3 = s.slice(i, i + 3);
    if (FIXED[ai2] !== undefined) {
      const len = FIXED[ai2] as number;
      const v = s.slice(i + 2, i + 2 + len);
      if (v.length !== len) return null;
      out.set(ai2, v);
      i += 2 + len;
    } else if (VARIABLE.has(ai3) || VARIABLE.has(ai2)) {
      const ai = VARIABLE.has(ai3) ? ai3 : ai2;
      const end = s.indexOf(GS, i + ai.length);
      const v = s.slice(i + ai.length, end === -1 ? s.length : end);
      if (v.length === 0 || v.length > 20) return null;
      out.set(ai, v);
      i = end === -1 ? s.length : end + 1;
    } else {
      return null; // unknown AI: do not guess
    }
  }
  return out.size > 0 ? out : null;
}

/** GS1 date YYMMDD → ISO YYYY-MM-DD (DD "00" = end of month, kept as day 00 → shown as month). */
function gs1Date(v: string): string | null {
  if (!/^\d{6}$/.test(v)) return null;
  const mm = Number(v.slice(2, 4));
  if (mm < 1 || mm > 12) return null;
  return `20${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4, 6)}`;
}

export function interpretBarcode(b: ScannedBarcode): BarcodeReading {
  const fmt = b.format.toUpperCase();
  const text = b.text.trim();
  if (fmt === 'UPC_A' || fmt === 'EAN_13') {
    const p = parseNdcInput(text);
    if (p.kind === 'UPC_A' || p.kind === 'EAN_13') return { kind: 'NDC_CODE', source: 'UPC', code: text, gtin: null, lot: null, expiry: null, format: fmt };
    return { kind: 'NOT_A_DRUG_CODE', format: fmt, reason: p.error ?? 'not an NDC-bearing UPC' };
  }
  const gs1Flag = b.symbology === ']d2' || b.symbology === ']C1' || b.symbology === ']e0';
  const looksGs1 = gs1Flag || ((fmt === 'DATA_MATRIX' || fmt === 'CODE_128') && /^01\d{14}/.test(text.replace(/^\]([dC])[0-9]/, '')));
  if (looksGs1) {
    const ais = parseGs1(text);
    const gtin = ais?.get('01') ?? null;
    if (!ais || !gtin) return { kind: 'NOT_A_DRUG_CODE', format: fmt, reason: 'GS1 data without a GTIN' };
    const p = parseNdcInput(gtin);
    if (p.kind !== 'GTIN_14') return { kind: 'NOT_A_DRUG_CODE', format: fmt, reason: p.error ?? 'GTIN does not carry an NDC' };
    const lotRaw = ais.get('10') ?? null;
    const lot = lotRaw && /^[A-Za-z0-9\-./]{1,20}$/.test(lotRaw) ? lotRaw : null;
    const exp = ais.get('17');
    return { kind: 'NDC_CODE', source: 'GS1', code: gtin, gtin, lot, expiry: exp ? gs1Date(exp) : null, format: fmt };
  }
  return { kind: 'NOT_A_DRUG_CODE', format: fmt, reason: fmt === 'CODE_128' ? 'pharmacy or store barcode (no GS1 drug identifier)' : 'format does not carry an NDC' };
}
