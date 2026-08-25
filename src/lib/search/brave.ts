import { config } from '../config';
import { fetchJson, HttpFetchError, parseDate, toExcerpt } from '../ingest/adapters/shared';

export type BraveKind = 'news' | 'web';
export type BraveFreshness = 'pd' | 'pw' | 'pm';

export interface BraveHit {
  title: string;
  url: string;
  description: string;
  publishedAt: Date | null;
}

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
  extra_snippets?: string[];
}

interface BraveNewsResponse {
  results?: BraveResult[];
}

interface BraveWebResponse {
  web?: { results?: BraveResult[] };
}

const NEWS_ENDPOINT = 'https://api.search.brave.com/res/v1/news/search';
const WEB_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_COUNT = 20;
const MAX_COUNT = 50;
const DEFAULT_QUOTA_BLOCK_MS = 6 * 36e5;

/** Process-local: once Brave returns monthly USAGE_LIMIT_EXCEEDED, skip further HTTP. */
let quotaBlockedUntil = 0;

export class BraveSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BraveSearchError';
  }
}

export function resetBraveQuotaGate(): void {
  quotaBlockedUntil = 0;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function throwIfQuotaBlocked(): void {
  if (Date.now() < quotaBlockedUntil) {
    throw new BraveSearchError(`Brave Search quota exhausted until ${isoDate(quotaBlockedUntil)}.`);
  }
}

interface BraveErrorBody {
  error?: {
    code?: string;
    detail?: string;
    meta?: { current_spend?: number; usage_limit?: number };
  };
}

function rematerialize(e: unknown): never {
  if (!(e instanceof HttpFetchError)) throw e;
  let code = '';
  let spend = '';
  try {
    const parsed = JSON.parse(e.body) as BraveErrorBody;
    code = parsed.error?.code ?? '';
    const meta = parsed.error?.meta;
    if (meta && Number.isFinite(meta.current_spend) && Number.isFinite(meta.usage_limit)) {
      spend = ` ($${meta.current_spend}/$${meta.usage_limit})`;
    }
  } catch {
    /* body was not JSON */
  }
  if (e.status === 402) {
    const waitMs = e.resetSeconds != null ? e.resetSeconds * 1000 : DEFAULT_QUOTA_BLOCK_MS;
    quotaBlockedUntil = Date.now() + Math.min(waitMs, 32 * 864e5);
    const label = code || 'HTTP 402';
    throw new BraveSearchError(
      `Brave Search quota exhausted (${label}${spend}). Resets ${isoDate(quotaBlockedUntil)}.`,
    );
  }
  if (code) throw new BraveSearchError(`Brave Search ${code}: ${e.message}`);
  throw e;
}

function token(): string {
  const key = config.braveApiKey;
  if (!key) throw new BraveSearchError('brave adapter requires BRAVE_API_KEY');
  return key;
}

function mapResults(results: BraveResult[] | undefined): BraveHit[] {
  const out: BraveHit[] = [];
  for (const r of results ?? []) {
    if (!r.url || !r.title) continue;
    const text = [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(' — ');
    out.push({
      url: r.url,
      title: r.title,
      description: toExcerpt(text) ?? '',
      publishedAt: parseDate(r.page_age) ?? parseDate(r.age),
    });
  }
  return out;
}

/**
 * One Brave Search request (news or web). Throws without BRAVE_API_KEY so
 * ingest records the failure; jobs that can degrade should catch.
 */
export async function braveSearch(opts: {
  query: string;
  kind?: BraveKind;
  count?: number;
  freshness?: BraveFreshness;
}): Promise<BraveHit[]> {
  throwIfQuotaBlocked();
  const kind = opts.kind ?? 'news';
  const count = Math.min(
    MAX_COUNT,
    Math.max(1, Math.floor(Number.isFinite(opts.count) ? (opts.count as number) : DEFAULT_COUNT)),
  );
  const params = new URLSearchParams({
    q: opts.query,
    count: String(count),
    freshness: opts.freshness ?? 'pd',
    extra_snippets: 'true',
  });
  const headers = {
    Accept: 'application/json',
    'X-Subscription-Token': token(),
  };
  try {
    if (kind === 'web') {
      const res = await fetchJson<BraveWebResponse>(`${WEB_ENDPOINT}?${params}`, { headers });
      return mapResults(res.web?.results);
    }
    const res = await fetchJson<BraveNewsResponse>(`${NEWS_ENDPOINT}?${params}`, { headers });
    return mapResults(res.results);
  } catch (e) {
    rematerialize(e);
  }
}

function pauseMs(): number {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return 0;
  return 1100;
}

/** Sequential batch with ~1 QPS spacing so we stay inside Brave's rate limit. */
export async function braveSearchBatch(
  queries: Array<{ query: string; kind?: BraveKind; count?: number; freshness?: BraveFreshness }>,
): Promise<{ hits: BraveHit[]; queriesOk: number; queriesFailed: number }> {
  const seen = new Set<string>();
  const hits: BraveHit[] = [];
  let queriesOk = 0;
  let queriesFailed = 0;
  for (let i = 0; i < queries.length; i++) {
    const wait = pauseMs();
    if (i > 0 && wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    try {
      const batch = await braveSearch(queries[i]!);
      queriesOk++;
      for (const hit of batch) {
        if (seen.has(hit.url)) continue;
        seen.add(hit.url);
        hits.push(hit);
      }
    } catch (e) {
      queriesFailed++;
      console.warn(`[brave] query failed (${queries[i]!.kind ?? 'news'}): ${queries[i]!.query}`, e);
    }
  }
  return { hits, queriesOk, queriesFailed };
}
