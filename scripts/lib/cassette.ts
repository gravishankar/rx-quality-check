/**
 * Recorded real HTTP responses ("cassettes") for the end-to-end integration.
 *
 *  - record: forwards every request to the live transport and stores the response by exact URL.
 *  - replay: serves only recorded responses; an unrecorded URL throws (never a silent mock), so a
 *    change in the requests the production code makes is detected immediately.
 *
 * Responses are stored as received (public regulatory data only; requests never contain patient
 * data — enforced by the privacy guard and asserted by the scenario audit).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RawResponse } from '../../mobile/src/services/classify.ts';
import { fetchTransport, type HttpTransport } from '../../mobile/src/services/transport.ts';

export interface CassetteEntry {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  capturedAt: string;
}

export interface Cassette {
  _fixture: { source: string; capturedAt: string; note: string };
  entries: Record<string, CassetteEntry>;
}

export function loadCassette(path: string): Cassette {
  if (!existsSync(path)) return { _fixture: { source: '', capturedAt: '', note: '' }, entries: {} };
  return JSON.parse(readFileSync(path, 'utf8')) as Cassette;
}

export function saveCassette(path: string, c: Cassette): void {
  const sorted: Record<string, CassetteEntry> = {};
  for (const k of Object.keys(c.entries).sort()) sorted[k] = c.entries[k] as CassetteEntry;
  writeFileSync(path, JSON.stringify({ ...c, entries: sorted }, null, 1) + '\n');
}

export class NotRecordedError extends Error {
  constructor(url: string) {
    super(`request not recorded: ${url}\n  (the production code now makes a request the cassette does not contain; re-record with \`npm run e2e:record\`)`);
    this.name = 'NotRecordedError';
  }
}

export function replayTransport(c: Cassette): HttpTransport & { used: Set<string> } {
  const used = new Set<string>();
  return {
    used,
    async get(url) {
      const e = c.entries[url];
      if (!e) throw new NotRecordedError(url);
      used.add(url);
      return { status: e.status, headers: e.headers, bodyText: e.bodyText };
    },
  };
}

/** Live HTTPS transport (Node fetch; behind a proxy run with NODE_USE_ENV_PROXY=1). */
export function liveTransport(): HttpTransport {
  return fetchTransport((url, init) => fetch(url, init));
}

export function recordingTransport(inner: HttpTransport, c: Cassette): HttpTransport {
  return {
    async get(url, opts): Promise<RawResponse> {
      const r = await inner.get(url, opts);
      c.entries[url] = { ...r, capturedAt: new Date().toISOString() };
      return r;
    },
  };
}
