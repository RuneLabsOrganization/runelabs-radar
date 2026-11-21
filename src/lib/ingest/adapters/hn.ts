import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchJson, parseConfig, parseDate } from './shared';

interface HnConfig {
  query?: string;
  minPoints?: number;
}

interface HnHit {
  objectID?: string;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  created_at?: string;
}

export const hnAdapter: SourceAdapter = {
  type: 'hn',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    const cfg = parseConfig<HnConfig>(source.config);
    const query = cfg.query ?? '';
    const minPoints = cfg.minPoints ?? 0;
    // Algolia has no OR operator: "AI OR LLM OR GPT" is parsed as five required words
    // (including the literal "OR"), which matched 13 stories ever and went silent in
    // July. Split on OR and pass the terms as optionalWords so ANY term matches.
    const terms = query
      .split(/\s+OR\s+/i)
      .map((t) => t.trim())
      .filter(Boolean);
    const url =
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(terms.join(' '))}` +
      `&optionalWords=${encodeURIComponent(terms.join(' '))}` +
      `&tags=story&numericFilters=${encodeURIComponent(`points>=${minPoints}`)}&hitsPerPage=30`;
    const data = await fetchJson<{ hits?: HnHit[] }>(url);

    const out: FetchedItem[] = [];
    for (const hit of data.hits ?? []) {
      const title = hit.title ?? hit.story_title;
      const fallback = hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : null;
      const itemUrl = hit.url || fallback;
      if (!title || !itemUrl) continue;
      out.push({
        url: itemUrl,
        title,
        excerpt: null,
        publishedAt: parseDate(hit.created_at),
      });
    }
    return out;
  },
};
