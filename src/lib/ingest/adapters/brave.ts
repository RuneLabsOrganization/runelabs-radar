import { braveSearch } from '../../search/brave';
import type { FetchedItem, Source, SourceAdapter } from '../types';
import { parseConfig } from './shared';

interface BraveConfig {
  query?: string;
  count?: number; // 1..50, default 20
  freshness?: 'pd' | 'pw' | 'pm'; // past day / week / month, default pd
}

/**
 * Brave News Search adapter: targeted queries per domain instead of hoping a
 * feed covers the story. Poll cadence is owned by runIngest (pollMinutes in
 * the source config) so a fleet of queries stays inside the monthly query
 * budget; HTTP errors throw so runIngest records the failure.
 */
export const braveAdapter: SourceAdapter = {
  type: 'brave',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    const cfg = parseConfig<BraveConfig>(source.config);
    if (!cfg.query) throw new Error(`brave source "${source.name}" is missing config.query`);

    const hits = await braveSearch({
      query: cfg.query,
      kind: 'news',
      count: cfg.count,
      freshness: cfg.freshness ?? 'pd',
    });
    return hits.map((h) => ({
      url: h.url,
      title: h.title,
      excerpt: h.description || null,
      publishedAt: h.publishedAt,
    }));
  },
};
