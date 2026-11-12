/**
 * Task 4C: run every lab label (OCR + barcode fixture) through readScan → the production composition
 * root (state machine, safety gates, recall engine) → confirmation → result. Used by the integration
 * test (replay) and to record the real responses it needs (`--record`, live HTTPS; run with
 * NODE_USE_ENV_PROXY=1 behind a proxy).
 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRecallCheck } from '../../mobile/src/app/recallCheck.ts';
import { confirmationEvent, screenFor } from '../../mobile/src/app/screens.ts';
import { readScan } from '../../mobile/src/scanner/readScan.ts';
import type { HttpTransport } from '../../mobile/src/services/transport.ts';
import { liveTransport, loadCassette, recordingTransport, replayTransport, saveCassette, type Cassette } from '../lib/cassette.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
export const SCAN_CASSETTE = join(ROOT, 'tests', 'fixtures', 'scanner', 'cassette.json');

export function scanVocabulary(): string[] {
  const c = read('data/drug_catalog.json') as { ingredients?: { name: string; aliases?: string[] }[] };
  const words = new Set<string>();
  for (const i of c.ingredients ?? []) for (const w of [i.name, ...(i.aliases ?? [])]) for (const part of w.toUpperCase().split(/[^A-Z]+/)) if (part.length >= 3) words.add(part);
  return [...words];
}

export interface FlowResult {
  file: string;
  afterScan: string;
  confirmScreen: { fields: { key: string; evidence: string; value: string }[]; notice: string | null } | null;
  finalState: string;
  category: string | null;
  requests: string[];
}

export async function runLabelFlow(label: { file: string; ocr_lines: { text: string; score: number }[]; barcodes: { format: string; text: string; symbology: string | null }[] }, transport: HttpTransport, opts: { useBarcodes: boolean }): Promise<FlowResult> {
  const now = () => '2026-11-12T12:00:00.000Z';
  const app = createRecallCheck({ transport, now, sleep: async () => undefined, catalogJson: read('data/drug_catalog.json'), policyJson: read('data/exclusion_policy.json'), load: { allowUnapproved: true } });
  const scan = readScan({ lines: label.ocr_lines, barcodes: opts.useBarcodes ? label.barcodes : [] }, scanVocabulary());
  let r = await app.scan(scan.extraction);
  const afterScan = r.state.name;
  let confirmScreen: FlowResult['confirmScreen'] = null;
  if (r.state.name === 'CONFIRM') {
    const m = screenFor(r.state, { now: now(), persistHistory: false });
    if (m.kind === 'CONFIRM') {
      confirmScreen = { fields: m.fields.map((f) => ({ key: f.key, evidence: f.evidence, value: f.value })), notice: m.notice };
      r = await app.send(r.state, confirmationEvent(m.items.map((i) => i.key), m.lot, m.askRelease ? 'IR' : null));
    }
  }
  const m = screenFor(r.state, { now: now(), persistHistory: false });
  return { file: label.file, afterScan, confirmScreen, finalState: r.state.name, category: m.kind === 'RESULT' ? m.view.category : null, requests: app.audit.entries.map((e) => e.url) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lab = read('tests/fixtures/scanner/ocr_lab.json') as { labels: Parameters<typeof runLabelFlow>[0][] };
  const recording = process.argv.includes('--record');
  const c: Cassette = recording ? { _fixture: { source: 'openFDA, RxNav, DailyMed — live HTTPS (scan_flow.ts --record)', capturedAt: new Date().toISOString(), note: 'Task 4C scanner flow' }, entries: {} } : loadCassette(SCAN_CASSETTE);
  const transport = recording ? recordingTransport(liveTransport(), c) : replayTransport(c);
  for (const l of lab.labels)
    for (const useBarcodes of [false, true]) {
      const f = await runLabelFlow(l, transport, { useBarcodes });
      console.log(`${l.file.padEnd(46)} barcodes=${useBarcodes ? 'y' : 'n'} ${f.afterScan.padEnd(18)} → ${f.finalState.padEnd(14)} ${f.category ?? ''} ${f.confirmScreen?.notice ? '[NDC not found]' : ''}`);
    }
  if (recording) saveCassette(SCAN_CASSETTE, c);
}
