/**
 * Outcome of one request to a public data source, as classified by the service layer.
 *
 * Core invariant (release gate RG-1): only a well-formed, source-specific "no results" answer may
 * become NO_MATCH. Every other failure becomes SOURCE_UNAVAILABLE or RATE_LIMITED. Rules treat
 * anything other than OK / NO_MATCH as missing evidence, never as absence of a recall.
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

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
