import type { sources } from '../db/schema';

export type Source = typeof sources.$inferSelect;

export interface FetchedItem {
  url: string;
  title: string;
  excerpt: string | null; // plain text, <= 500 chars
  publishedAt: Date | null;
}

export interface SourceAdapter {
  type: Source['type'];
  /**
   * cfg: the orchestrator-parsed config object. Adapters may read cadence keys
   * from it and may MUTATE it to persist fetch state (etag, lastModified) —
   * runIngest writes it back to the sources row after a successful fetch.
   */
  fetchItems(source: Source, cfg?: Record<string, unknown>): Promise<FetchedItem[]>;
}
