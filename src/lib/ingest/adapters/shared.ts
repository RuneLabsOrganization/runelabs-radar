/** Helpers shared by the ingest adapters. No DB access here — adapters only fetch and map. */

export const FETCH_TIMEOUT_MS = 15_000;
export const EXCERPT_MAX = 500;

/** Browser-ish UA: feed CDNs and API gateways commonly 403 the Node fetch default. */
export const DEFAULT_UA = 'RunelabsRadar/1.0 (+https://radar.runelabs.org)';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const ERROR_BODY_MAX = 2000;

/** Non-2xx fetch with the response body attached so callers can parse API errors. */
export class HttpFetchError extends Error {
  readonly status: number;
  readonly body: string;
  readonly resetSeconds: number | null;

  constructor(status: number, url: string, body: string, resetSeconds: number | null = null) {
    super(`HTTP ${status} fetching ${url}`);
    this.name = 'HttpFetchError';
    this.status = status;
    this.body = body;
    this.resetSeconds = resetSeconds;
  }
}

/** Longest window from `x-ratelimit-reset: "1, 522166"` or a Retry-After header. */
export function parseResetSeconds(res: Response): number | null {
  const raw = res.headers.get('x-ratelimit-reset') ?? res.headers.get('retry-after');
  if (!raw) return null;
  const parts = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parts.length > 0 ? Math.max(...parts) : null;
}

/** Jittered backoff: 500ms after the first failure, ~2s after the second. */
function backoffMs(attempt: number): number {
  return (attempt === 1 ? 500 : 2000) + Math.random() * 500;
}

/**
 * Fetch with a 15s timeout, a default UA, and up to 2 retries with jittered
 * backoff on 429/5xx/network/timeout — a transient error must not cost a
 * whole cadence tick. 304 passes through without throwing (the RSS adapter's
 * conditional GET relies on it); every other non-2xx throws.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { 'user-agent': DEFAULT_UA, ...(init.headers as Record<string, string> | undefined) };
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, backoffMs(attempt)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, headers, signal: controller.signal });
      if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
        lastError = new Error(`HTTP ${res.status} fetching ${url}`);
        continue;
      }
      if (!res.ok && res.status !== 304) {
        const body = await res.text().catch(() => '');
        throw new HttpFetchError(
          res.status,
          url,
          body.slice(0, ERROR_BODY_MAX),
          parseResetSeconds(res),
        );
      }
      return res;
    } catch (e) {
      lastError = e;
      // 402/401/4xx must not burn the jittered retry budget — only 429/5xx/network do.
      if (e instanceof HttpFetchError && !RETRYABLE_STATUSES.has(e.status)) throw e;
      if (attempt === MAX_ATTEMPTS) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetchWithTimeout(url, init);
  return res.text();
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(url, init);
  return (await res.json()) as T;
}

/** fast-xml-parser returns a lone child as an object, not a one-element array — normalize. */
export function toArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
};

/**
 * Decode HTML entities: all numeric (&#8217; / &#x2019;) plus the common
 * named set. Feeds love leaving these in titles — decode at ingest, never
 * at render.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(x?[0-9a-fA-F]+);/g, (m, n: string) => {
      const isHex = n.toLowerCase().startsWith('x');
      const code = parseInt(isHex ? n.slice(1) : n, isHex ? 16 : 10);
      if (Number.isNaN(code) || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    })
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Extract the text of a parsed XML node. With attributes enabled, fast-xml-parser
 * represents `<title type="html">x</title>` as `{ '#text': 'x', '@_type': 'html' }`
 * and plain nodes as strings (or numbers, when numeric-looking).
 */
export function textOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = decodeEntities(v.trim());
    return s.length > 0 ? s : null;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) {
    return textOf((v as Record<string, unknown>)['#text']);
  }
  return null;
}

/** Strip HTML tags, decode entities, collapse whitespace. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain-text excerpt: strip HTML, collapse whitespace, truncate to 500 chars. Empty → null. */
export function toExcerpt(v: unknown): string | null {
  if (v == null) return null;
  const text = stripHtml(String(v));
  if (text.length === 0) return null;
  return text.length > EXCERPT_MAX ? text.slice(0, EXCERPT_MAX) : text;
}

/** Lenient date parse; invalid or missing → null. */
export function parseDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse a source's JSON config column; malformed JSON throws (counted as a source failure). */
export function parseConfig<T>(config: string): T {
  try {
    return JSON.parse(config) as T;
  } catch {
    throw new Error(`invalid source config JSON: ${config.slice(0, 100)}`);
  }
}
