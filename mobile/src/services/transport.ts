/**
 * HTTP transport for public drug-data APIs: direct HTTPS GET from the phone, no credentials, no
 * cookies, generic User-Agent, timeout and caller cancellation, a host allowlist and a privacy
 * guard that refuses any URL containing patient-specific values. Every request is recorded in an
 * in-memory audit log (never persisted, never sent anywhere).
 *
 * The `fetch` implementation is injected, so the same code runs in React Native, Node (tests,
 * live checks) and replay mode (recorded real responses).
 */
import type { RawResponse } from './classify.ts';

export const ALLOWED_HOSTS: readonly string[] = ['api.fda.gov', 'dailymed.nlm.nih.gov', 'rxnav.nlm.nih.gov'];
export const DEFAULT_TIMEOUT_MS = 20_000;
/** Generic client identifier: no app-install, device or user identifier. */
export const USER_AGENT = 'rx-recall-check/0.1';

export interface RequestOptions {
  accept?: string;
  timeoutMs?: number;
  /** Caller cancellation (e.g. the user navigated away). */
  signal?: AbortSignal;
}

export interface HttpTransport {
  get(url: string, opts?: RequestOptions): Promise<RawResponse>;
}

export class RequestBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestBlockedError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`request timed out after ${ms} ms: ${url}`);
    this.name = 'TimeoutError';
  }
}

export class RequestCancelledError extends Error {
  constructor() {
    super('request cancelled');
    this.name = 'CancelledError';
  }
}

type FetchLike = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal; credentials?: 'omit'; redirect?: 'error' | 'follow' }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const KEPT_HEADERS = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'content-type', 'last-modified', 'etag'];

/** Transport over a fetch implementation, with timeout and caller cancellation. */
export function fetchTransport(fetchImpl: FetchLike): HttpTransport {
  return {
    async get(url, opts = {}) {
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onCancel = () => controller.abort();
      if (opts.signal) {
        if (opts.signal.aborted) throw new RequestCancelledError();
        opts.signal.addEventListener('abort', onCancel, { once: true });
      }
      try {
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT, Accept: opts.accept ?? 'application/json' },
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'error',
        });
        const headers: Record<string, string> = {};
        for (const h of KEPT_HEADERS) {
          const v = res.headers.get(h);
          if (v !== null) headers[h] = v;
        }
        return { status: res.status, headers, bodyText: await res.text() };
      } catch (err) {
        if (timedOut) throw new RequestTimeoutError(url, timeoutMs);
        if (opts.signal?.aborted) throw new RequestCancelledError();
        throw err;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onCancel);
      }
    },
  };
}

export interface AuditEntry {
  url: string;
  host: string;
  /** Query parameter names and values as sent (all public identifiers by construction). */
  params: Record<string, string>;
  outcome: 'SENT' | 'BLOCKED';
  reason?: string;
}

export interface PrivacyGuard {
  /**
   * Patient-specific values that must never appear in a request (lot, label text, names, Rx
   * number, pharmacy, directions). Set per session by the app; compared case-insensitively against
   * the decoded URL. Values shorter than 3 characters are ignored (too common to be meaningful).
   */
  sensitiveValues(): readonly string[];
}

export interface AuditLog {
  entries: AuditEntry[];
}

/**
 * Wrap a transport with the host allowlist, HTTPS-only rule, the privacy guard and the audit log.
 * A violating request is never sent: it throws RequestBlockedError, which clients classify as
 * SOURCE_UNAVAILABLE (REQUEST_BLOCKED). Blocking is a programming error to be fixed, not a result.
 */
export function guardedTransport(inner: HttpTransport, guard: PrivacyGuard, audit: AuditLog = { entries: [] }): HttpTransport & { audit: AuditLog } {
  return {
    audit,
    async get(url, opts) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new RequestBlockedError(`not a URL: ${url}`);
      }
      const params: Record<string, string> = {};
      parsed.searchParams.forEach((v, k) => (params[k] = v));
      const block = (reason: string): never => {
        audit.entries.push({ url, host: parsed.host, params, outcome: 'BLOCKED', reason });
        throw new RequestBlockedError(reason);
      };
      if (parsed.protocol !== 'https:') block('only HTTPS is allowed');
      if (!ALLOWED_HOSTS.includes(parsed.host)) block(`host ${parsed.host} is not allowlisted`);
      if (parsed.username || parsed.password) block('credentials in URL');
      const decoded = decodeURIComponent(parsed.pathname + parsed.search).toLowerCase();
      for (const v of guard.sensitiveValues()) {
        const needle = v.trim().toLowerCase();
        if (needle.length >= 3 && decoded.includes(needle)) block('request contains a patient-specific value');
      }
      audit.entries.push({ url, host: parsed.host, params, outcome: 'SENT' });
      return inner.get(url, opts);
    },
  };
}

/** A guard with no sensitive values (for public-data utilities such as fixture capture). */
export const NO_SENSITIVE_VALUES: PrivacyGuard = { sensitiveValues: () => [] };
