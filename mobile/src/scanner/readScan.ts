/**
 * Combine OCR lines and decoded barcodes from one photo into a LabelExtraction for the existing
 * engine, plus a per-field record of where each value came from (for the confirmation screen).
 * Pure; platform-independent (the native side only returns lines and barcode payloads).
 */
import type { LabelExtraction } from '../models/identity.ts';
import { interpretBarcode, type BarcodeReading, type ScannedBarcode } from './barcode.ts';
import { readLabelText, toExtraction, type OcrLine, type TextReading } from './labelText.ts';

export interface ScanOutput {
  lines: OcrLine[];
  barcodes: ScannedBarcode[];
  /** Diagnostics only (never sent anywhere). */
  timings?: { ocrMs: number; barcodeMs: number; totalMs: number };
  image?: { width: number; height: number };
  /** Partial failures inside the native scanner (development diagnostics; no label content). */
  warnings?: string[];
}

export type ScanProblem = 'NOTHING_READ' | 'NO_DRUG_FIELDS' | 'BARCODE_TEXT_NDC_DIFFER';

export interface ScanReading {
  extraction: LabelExtraction;
  text: TextReading;
  barcodes: BarcodeReading[];
  problems: ScanProblem[];
  /** Fields that were read (any source). */
  readFields: ('ndc' | 'drugName' | 'strength' | 'doseForm' | 'manufacturer' | 'lot')[];
}

export function readScan(out: ScanOutput, vocabulary: readonly string[]): ScanReading {
  const text = readLabelText(out.lines, vocabulary);
  const barcodes = out.barcodes.map(interpretBarcode);
  const drugCodes = barcodes.filter((b): b is Extract<BarcodeReading, { kind: 'NDC_CODE' }> => b.kind === 'NDC_CODE');
  // GS1 (with lot/expiry) preferred over UPC.
  const best = drugCodes.find((b) => b.source === 'GS1') ?? drugCodes[0] ?? null;
  const extraction = toExtraction(text, best ? { code: best.code, lot: best.lot, expiry: best.expiry } : null);
  const problems: ScanProblem[] = [];
  if (out.lines.length === 0 && drugCodes.length === 0) problems.push('NOTHING_READ');
  else if (!extraction.drugName && !extraction.strength && extraction.ndcTexts.length === 0) problems.push('NO_DRUG_FIELDS');
  if (best && text.ndc) {
    const digits = (s: string) => s.replace(/\D/g, '');
    const bc = digits(best.code);
    const tx = digits(text.ndc.value);
    // A text NDC (10 or 11 digits) should appear inside the barcode's 10-digit NDC body; compare by
    // the 10-digit body when the text is hyphenated 10-digit, else leave it to the directory.
    if (tx.length === 10 && !bc.includes(tx)) problems.push('BARCODE_TEXT_NDC_DIFFER');
  }
  const readFields: ScanReading['readFields'] = [];
  if (extraction.ndcTexts.length > 0) readFields.push('ndc');
  if (extraction.drugName) readFields.push('drugName');
  if (extraction.strength) readFields.push('strength');
  if (extraction.doseForm) readFields.push('doseForm');
  if (extraction.labelerText) readFields.push('manufacturer');
  if (extraction.lot) readFields.push('lot');
  return { extraction, text, barcodes, problems, readFields };
}
