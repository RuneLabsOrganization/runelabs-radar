import { config } from '../config';
import { fetchJson, parseDate, toExcerpt } from '../ingest/adapters/shared';

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

export class BraveSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BraveSearchError';
  }
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
  if (kind === 'web') {
    const res = await fetchJson<BraveWebResponse>(`${WEB_ENDPOINT}?${params}`, { headers });
    return mapResults(res.web?.results);
  }
  const res = await fetchJson<BraveNewsResponse>(`${NEWS_ENDPOINT}?${params}`, { headers });
  return mapResults(res.results);
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
