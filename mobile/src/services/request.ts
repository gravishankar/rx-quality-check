/**
 * One request → one classified LookupOutcome. Thrown transport errors become SOURCE_UNAVAILABLE with
 * a specific reason (TIMEOUT, CANCELLED, REQUEST_BLOCKED, NETWORK_ERROR); they are never NO_MATCH.
 */
import type { LookupOutcome, ResponseMeta, SourceId, UnavailableReason } from '../models/lookup.ts';
import { classifyResponse, type RawResponse } from './classify.ts';
import type { HttpTransport, RequestOptions } from './transport.ts';

export interface ClientDeps {
  transport: HttpTransport;
  /** Device clock (ISO-8601); injected so tests are deterministic. */
  now: () => string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function failureReason(err: unknown): UnavailableReason {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'TIMEOUT';
  if (name === 'CancelledError') return 'CANCELLED';
  if (name === 'RequestBlockedError') return 'REQUEST_BLOCKED';
  return 'NETWORK_ERROR';
}

export function unavailable<T>(source: SourceId, url: string, reason: UnavailableReason, detail: string, retrievedAt: string): LookupOutcome<T> {
  return { kind: 'SOURCE_UNAVAILABLE', reason, detail, meta: { source, url, httpStatus: null, retrievedAt, elapsedMs: 0, headers: {} } };
}

/** GET a JSON resource and classify it with a schema validator. */
export async function requestJson<T>(
  deps: ClientDeps,
  source: SourceId,
  url: string,
  validate: (body: unknown) => string | null,
  opts: RequestOptions = {},
): Promise<LookupOutcome<T>> {
  let raw: RawResponse;
  try {
    raw = await deps.transport.get(url, { timeoutMs: deps.timeoutMs, signal: deps.signal, ...opts });
  } catch (err) {
    return unavailable(source, url, failureReason(err), err instanceof Error ? `${err.name}: ${err.message}` : String(err), deps.now());
  }
  return classifyResponse<T>(source, url, raw, validate, { retrievedAt: deps.now(), elapsedMs: 0 });
}

/** GET a text resource (SPL XML). 404 is NO_MATCH; anything else non-200 or unrecognized is unavailable. */
export async function requestText(
  deps: ClientDeps,
  source: SourceId,
  url: string,
  looksValid: (text: string) => boolean,
  opts: RequestOptions = {},
): Promise<LookupOutcome<string>> {
  let raw: RawResponse;
  try {
    raw = await deps.transport.get(url, { timeoutMs: deps.timeoutMs, signal: deps.signal, ...opts });
  } catch (err) {
    return unavailable(source, url, failureReason(err), err instanceof Error ? `${err.name}: ${err.message}` : String(err), deps.now());
  }
  const meta: ResponseMeta = { source, url, httpStatus: raw.status, retrievedAt: deps.now(), elapsedMs: 0, headers: raw.headers };
  if (raw.status === 429) {
    const ra = raw.headers['retry-after'];
    return { kind: 'RATE_LIMITED', retryAfterSeconds: ra !== undefined && /^\d+$/.test(ra) ? Number(ra) : null, meta };
  }
  if (raw.status === 404) return { kind: 'NO_MATCH', meta };
  if (raw.status >= 500) return { kind: 'SOURCE_UNAVAILABLE', reason: 'HTTP_5XX', detail: `HTTP ${raw.status}`, meta };
  if (raw.status !== 200) return { kind: 'SOURCE_UNAVAILABLE', reason: 'HTTP_UNEXPECTED_STATUS', detail: `HTTP ${raw.status}`, meta };
  if (!looksValid(raw.bodyText)) return { kind: 'SOURCE_UNAVAILABLE', reason: 'SCHEMA_VIOLATION', detail: 'unexpected document', meta };
  return { kind: 'OK', data: raw.bodyText, meta };
}
