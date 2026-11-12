/**
 * HTTP access and outcome classification for public drug-data APIs.
 *
 * Core safety invariant (see docs/TEST_PLAN.md, "Release gates"):
 *   Only a well-formed, source-specific "no results" answer may become NO_MATCH.
 *   Every other failure (network error, timeout, 5xx, unexpected 4xx, unparseable body, schema
 *   violation) becomes SOURCE_UNAVAILABLE or RATE_LIMITED. A parsing or lookup failure must never
 *   be reported as "no recall found".
 */

import { isRecord, type LookupOutcome, type ResponseMeta, type SourceId } from '../../mobile/src/models/lookup.ts';

export type { LookupOutcome, ResponseMeta, SourceId, UnavailableReason } from '../../mobile/src/models/lookup.ts';
export { isRecord } from '../../mobile/src/models/lookup.ts';

import { classifyResponse, type RawResponse } from '../../mobile/src/services/classify.ts';

// Task 3: response classification moved to mobile/src/services/classify.ts (used by the app's
// clients); re-exported here for the feasibility harness and Task 1 tests.
export { classifyResponse, isNoMatchResponse, type RawResponse } from '../../mobile/src/services/classify.ts';

const INTERESTING_HEADERS = [
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'access-control-allow-origin',
  'cache-control',
  'etag',
  'last-modified',
  'content-type',
];

export async function fetchRaw(
  url: string,
  opts: { timeoutMs?: number; accept?: string } = {},
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Generic client identifier: no device, user or app-install identifiers are sent.
        'User-Agent': 'rx-quality-check-feasibility/0.1',
        Accept: opts.accept ?? 'application/json',
      },
    });
    const headers: Record<string, string> = {};
    for (const h of INTERESTING_HEADERS) {
      const v = res.headers.get(h);
      if (v !== null) headers[h] = v;
    }
    return { status: res.status, headers, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch + classify, converting thrown network/timeout errors into SOURCE_UNAVAILABLE. */
export async function lookup<T>(
  source: SourceId,
  url: string,
  validate: (body: unknown) => string | null,
  opts: { timeoutMs?: number } = {},
): Promise<LookupOutcome<T>> {
  const started = Date.now();
  const retrievedAt = () => new Date().toISOString();
  try {
    const raw = await fetchRaw(url, opts);
    return classifyResponse<T>(source, url, raw, validate, {
      retrievedAt: retrievedAt(),
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      kind: 'SOURCE_UNAVAILABLE',
      reason: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      detail: err instanceof Error ? `${err.name}: ${err.message}${causeOf(err)}` : String(err),
      meta: {
        source,
        url,
        httpStatus: null,
        retrievedAt: retrievedAt(),
        elapsedMs: Date.now() - started,
        headers: {},
      },
    };
  }
}

function causeOf(err: Error): string {
  const c = (err as Error & { cause?: unknown }).cause;
  return c instanceof Error ? ` (cause: ${c.message})` : '';
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
