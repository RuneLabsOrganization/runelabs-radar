import { config } from '../../config';
import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchJson, parseConfig, parseDate, toExcerpt } from './shared';

interface BraveConfig {
  query?: string;
  count?: number; // 1..50, default 20
  freshness?: 'pd' | 'pw' | 'pm'; // past day / week / month, default pd
  /** Self-throttle: skip the fetch when the source was polled more recently. Default 3h. */
  pollHours?: number;
}

interface BraveNewsResult {
  title?: string;
  url?: string;
  description?: string;
  /** ISO date for news results (relative phrases like "3 hours ago" on web results). */
  age?: string;
  page_age?: string;
  extra_snippets?: string[];
}

interface BraveNewsResponse {
  results?: BraveNewsResult[];
}

const ENDPOINT = 'https://api.search.brave.com/res/v1/news/search';
const DEFAULT_COUNT = 20;
const MAX_COUNT = 50;
const DEFAULT_POLL_HOURS = 3;

/**
 * Brave News Search adapter: targeted queries per domain instead of hoping a
 * feed covers the story. Self-throttles per source (pollHours) so a fleet of
 * queries stays inside the monthly query budget; HTTP errors throw so
 * runIngest records the failure (and lastFetchedAt backs off naturally).
 */
export const braveAdapter: SourceAdapter = {
  type: 'brave',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    const cfg = parseConfig<BraveConfig>(source.config);
    if (!cfg.query) throw new Error(`brave source "${source.name}" is missing config.query`);

    const pollMs = (cfg.pollHours ?? DEFAULT_POLL_HOURS) * 36e5;
    if (source.lastFetchedAt && Date.now() - source.lastFetchedAt.getTime() < pollMs) {
      return [];
    }

    const key = config.braveApiKey;
    if (!key) throw new Error('brave adapter requires BRAVE_API_KEY');

    const count = Math.min(
      MAX_COUNT,
      Math.max(1, Math.floor(Number.isFinite(cfg.count) ? (cfg.count as number) : DEFAULT_COUNT)),
    );
    const params = new URLSearchParams({
      q: cfg.query,
      count: String(count),
      freshness: cfg.freshness ?? 'pd',
      extra_snippets: 'true',
    });
    const res = await fetchJson<BraveNewsResponse>(`${ENDPOINT}?${params}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': key,
      },
    });

    const out: FetchedItem[] = [];
    for (const r of res.results ?? []) {
      if (!r.url || !r.title) continue;
      // extra_snippets adds depth beyond the meta description (paid plans)
      const text = [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(' — ');
      out.push({
        url: r.url,
        title: r.title,
        excerpt: toExcerpt(text),
        publishedAt: parseDate(r.page_age) ?? parseDate(r.age),
      });
    }
    return out;
  },
};
