/**
 * Classification of public-API HTTP responses into LookupOutcome (moved from scripts/lib/http.ts in
 * Task 3; behavior unchanged).
 *
 * Core safety invariant (release gate RG-1): only a well-formed, source-specific "no results"
 * answer may become NO_MATCH. Every other failure (network error, timeout, 5xx, unexpected 4xx,
 * unparseable body, schema violation) becomes SOURCE_UNAVAILABLE or RATE_LIMITED.
 */
import { isRecord, type LookupOutcome, type ResponseMeta, type SourceId } from '../models/lookup.ts';

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
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
