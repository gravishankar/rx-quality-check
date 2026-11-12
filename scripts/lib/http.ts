/**
 * HTTP access and outcome classification for public drug-data APIs.
 *
 * Core safety invariant (see docs/TEST_PLAN.md, "Release gates"):
 *   Only a well-formed, source-specific "no results" answer may become NO_MATCH.
 *   Every other failure (network error, timeout, 5xx, unexpected 4xx, unparseable body, schema
 *   violation) becomes SOURCE_UNAVAILABLE or RATE_LIMITED. A parsing or lookup failure must never
 *   be reported as "no recall found".
 */

export type SourceId = 'OPENFDA' | 'DAILYMED' | 'RXNAV';

export type LookupOutcome<T> =
  | { kind: 'OK'; data: T; meta: ResponseMeta }
  | { kind: 'NO_MATCH'; meta: ResponseMeta }
  | { kind: 'RATE_LIMITED'; retryAfterSeconds: number | null; meta: ResponseMeta }
  | { kind: 'SOURCE_UNAVAILABLE'; reason: UnavailableReason; detail: string; meta: ResponseMeta };

export type UnavailableReason =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'HTTP_5XX'
  | 'HTTP_UNEXPECTED_STATUS'
  | 'INVALID_JSON'
  | 'SCHEMA_VIOLATION';

export interface ResponseMeta {
  source: SourceId;
  url: string;
  httpStatus: number | null;
  /** ISO-8601 timestamp of when this device received the response. */
  retrievedAt: string;
  elapsedMs: number;
  /** Selected response headers useful for rate-limit / caching analysis. */
  headers: Record<string, string>;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}

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

/** Source-specific detection of a legitimate "no results" answer. */
export function isNoMatchResponse(source: SourceId, status: number, body: unknown): boolean {
  switch (source) {
    case 'OPENFDA':
      // openFDA signals "no matches" with HTTP 404 and error.code NOT_FOUND.
      return (
        status === 404 &&
        isRecord(body) &&
        isRecord(body.error) &&
        body.error.code === 'NOT_FOUND'
      );
    case 'DAILYMED':
      // DailyMed v2 returns 200 with an empty data array and metadata.total_elements === 0.
      return (
        status === 200 &&
        isRecord(body) &&
        Array.isArray(body.data) &&
        body.data.length === 0 &&
        isRecord(body.metadata) &&
        Number(body.metadata.total_elements) === 0
      );
    case 'RXNAV':
      // RxNav returns 200 with an idGroup lacking rxnormId when a name does not resolve.
      return (
        status === 200 &&
        isRecord(body) &&
        isRecord(body.idGroup) &&
        !('rxnormId' in body.idGroup)
      );
  }
}

/**
 * Classify a raw HTTP response into a LookupOutcome. `validate` must return null when the body
 * matches the expected schema, or a description of the first violation.
 */
export function classifyResponse<T>(
  source: SourceId,
  url: string,
  raw: RawResponse,
  validate: (body: unknown) => string | null,
  timing: { retrievedAt: string; elapsedMs: number },
): LookupOutcome<T> {
  const meta: ResponseMeta = {
    source,
    url,
    httpStatus: raw.status,
    retrievedAt: timing.retrievedAt,
    elapsedMs: timing.elapsedMs,
    headers: raw.headers,
  };

  if (raw.status === 429) {
    const ra = raw.headers['retry-after'];
    const seconds = ra !== undefined && /^\d+$/.test(ra) ? Number(ra) : null;
    return { kind: 'RATE_LIMITED', retryAfterSeconds: seconds, meta };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.bodyText);
  } catch {
    if (raw.status >= 500) {
      return { kind: 'SOURCE_UNAVAILABLE', reason: 'HTTP_5XX', detail: `HTTP ${raw.status}`, meta };
    }
    return {
      kind: 'SOURCE_UNAVAILABLE',
      reason: 'INVALID_JSON',
      detail: `HTTP ${raw.status}; body is not JSON`,
      meta,
    };
  }

  if (isNoMatchResponse(source, raw.status, body)) {
    return { kind: 'NO_MATCH', meta };
  }

  if (raw.status >= 500) {
    // NB: openFDA also returns HTTP 500 for malformed queries (observed 2026-11-12), so a 5xx
    // cannot be read as "the service is down" or as "no data" — it is simply unavailable.
    return { kind: 'SOURCE_UNAVAILABLE', reason: 'HTTP_5XX', detail: `HTTP ${raw.status}`, meta };
  }
  if (raw.status !== 200) {
    return {
      kind: 'SOURCE_UNAVAILABLE',
      reason: 'HTTP_UNEXPECTED_STATUS',
      detail: `HTTP ${raw.status}`,
      meta,
    };
  }

  const violation = validate(body);
  if (violation !== null) {
    return { kind: 'SOURCE_UNAVAILABLE', reason: 'SCHEMA_VIOLATION', detail: violation, meta };
  }
  return { kind: 'OK', data: body as T, meta };
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

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
