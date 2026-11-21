import { config } from '../config';
import { fetchJson, parseDate, toExcerpt } from '../ingest/adapters/shared';
import { reserveSearchCall } from './budget';

export interface MiniMaxSearchHit {
  title: string;
  url: string;
  description: string;
  publishedAt: Date | null;
}

interface ServerBlock {
  type?: string;
  content?: unknown;
}

interface MessagesResponse {
  content?: ServerBlock[];
}

interface SearchResultItem {
  title?: string;
  url?: string;
  page_age?: string | null;
  content?: string | null;
}

export class MiniMaxSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MiniMaxSearchError';
  }
}

const DEFAULT_COUNT = 10;
const MAX_SEARCHES_PER_CALL = 2;
// A server-side search round takes 4-15s (several searches + a model pass) — the shared 15s fetch cap aborts it.
const SEARCH_TIMEOUT_MS = 60_000;

/**
 * Web search through MiniMax's hosted `web_search` server tool (Anthropic
 * Messages interface; beta). One call lets the model run up to
 * MAX_SEARCHES_PER_CALL searches server-side; we ignore its prose and keep the
 * raw `web_search_tool_result` blocks, which carry title/url/page_age/snippet.
 * Used as the fallback when Exa is unavailable. Budgeted like the other paid
 * search providers ('minimax' in search/budget.ts).
 */
export async function minimaxSearch(opts: { query: string; count?: number }): Promise<MiniMaxSearchHit[]> {
  const key = config.minimaxApiKey;
  if (!key) throw new MiniMaxSearchError('minimax search requires MINIMAX_API_KEY');
  const count = Math.min(25, Math.max(1, Math.floor(Number.isFinite(opts.count) ? (opts.count as number) : DEFAULT_COUNT)));
  reserveSearchCall('minimax');
  const base = config.minimaxBaseUrl.replace(/\/v1\/?$/, '');
  const res = await fetchJson<MessagesResponse>(`${base}/anthropic/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: config.minimaxModel,
      max_tokens: 1200,
      system:
        'You are a search relay. Search the web for the user query, preferring news and posts from the past day. ' +
        'Do not write an answer — after searching reply with the single word DONE.',
      messages: [{ role: 'user', content: opts.query }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES_PER_CALL }],
    }),
  }, { timeoutMs: SEARCH_TIMEOUT_MS });
  const seen = new Set<string>();
  const hits: MiniMaxSearchHit[] = [];
  for (const block of res.content ?? []) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;
    for (const r of block.content as SearchResultItem[]) {
      if (!r.url || !r.title || seen.has(r.url)) continue;
      seen.add(r.url);
      hits.push({
        url: r.url,
        title: r.title,
        description: toExcerpt(r.content) ?? '',
        publishedAt: parseDate(r.page_age),
      });
      if (hits.length >= count) return hits;
    }
  }
  return hits;
}
