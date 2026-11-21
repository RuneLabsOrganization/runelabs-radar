import { exaSearch } from '../../search/exa';
import { SearchBudgetError } from '../../search/budget';
import { minimaxSearch } from '../../search/minimax';
import { braveSearch } from '../../search/brave';
import type { FetchedItem, Source, SourceAdapter } from '../types';
import { HttpFetchError, parseConfig } from './shared';

interface ExaConfig {
  query?: string;
  count?: number; // 1..25, default 10
}

/**
 * Exa is primary (20k free requests/month, no card, outperforms Brave on the
 * Artificial Analysis Search benchmark). Brave is kept as a same-query
 * fallback rather than a second source row, so a topic never needs two rows
 * and Brave's now-scarce paid credit is only spent when Exa itself fails —
 * any error, not a specific status code, since Exa does not document a
 * distinct quota-exhaustion response the way Brave's HTTP 402 does.
 *
 * Poll cadence is owned by runIngest (pollMinutes in the source config), same
 * as the brave adapter.
 */
const toItem = (h: { url: string; title: string; description: string; publishedAt: Date | null }): FetchedItem => ({
  url: h.url,
  title: h.title,
  excerpt: h.description || null,
  publishedAt: h.publishedAt,
});

export const exaAdapter: SourceAdapter = {
  type: 'exa',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    const cfg = parseConfig<ExaConfig>(source.config);
    if (!cfg.query) throw new Error(`exa source "${source.name}" is missing config.query`);

    try {
      const hits = await exaSearch({ query: cfg.query, count: cfg.count });
      return hits.map(toItem);
    } catch (exaError) {
      // Fallback chain: Exa -> MiniMax web_search (cheap, already paid for) -> Brave.
      // Even when Exa is out of budget/credit we fall through to MiniMax; only Brave
      // (a separate paid plan) is skipped in that case so it isn't drained by every
      // Exa source on every tick.
      const exaOut =
        exaError instanceof SearchBudgetError || (exaError instanceof HttpFetchError && exaError.status === 402);
      try {
        const hits = await minimaxSearch({ query: cfg.query, count: cfg.count });
        if (hits.length > 0) return hits.map(toItem);
      } catch {
        /* fall through to Brave / rethrow */
      }
      if (exaOut) throw exaError;
      try {
        const hits = await braveSearch({ query: cfg.query, kind: 'news', count: cfg.count, freshness: 'pd' });
        return hits.map(toItem);
      } catch {
        // Every provider failed — surface the primary's error, it's the one that matters.
        throw exaError;
      }
    }
  },
};
