import { config } from '../config';
import { fetchJson, parseDate, toExcerpt } from '../ingest/adapters/shared';
import { reserveSearchCall } from './budget';

export interface MiniMaxSearchHit {
  title: string;
  url: string;
  description: string;
  publishedAt: Date | null;
}

interface SearchResponse {
  organic?: { title?: string; link?: string; date?: string; snippet?: string }[];
  base_resp?: { status_code: number };
}

export class MiniMaxSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MiniMaxSearchError';
  }
}

const DEFAULT_COUNT = 10;
/** One budgeted search using the same endpoint as MiniMax's official search MCP. */
export async function minimaxSearch(opts: { query: string; count?: number }): Promise<MiniMaxSearchHit[]> {
  const key = config.minimaxApiKey;
  if (!key) throw new MiniMaxSearchError('minimax search requires MINIMAX_API_KEY');
  const count = Math.min(25, Math.max(1, Math.floor(Number.isFinite(opts.count) ? (opts.count as number) : DEFAULT_COUNT)));
  reserveSearchCall('minimax');
  const base = config.minimaxBaseUrl.replace(/\/v1\/?$/, '');
  const res = await fetchJson<SearchResponse>(`${base}/v1/coding_plan/search`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ q: opts.query }),
  });
  if (res.base_resp?.status_code) {
    throw new MiniMaxSearchError(`MiniMax search API error ${res.base_resp.status_code}`);
  }
  const seen = new Set<string>();
  const hits: MiniMaxSearchHit[] = [];
  for (const result of res.organic ?? []) {
    if (!result.link || !result.title || seen.has(result.link)) continue;
    seen.add(result.link);
    hits.push({
      url: result.link,
      title: result.title,
      description: toExcerpt(result.snippet) ?? '',
      publishedAt: parseDate(result.date),
    });
    if (hits.length >= count) break;
  }
  return hits;
}
