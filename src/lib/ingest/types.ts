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
  fetchItems(source: Source): Promise<FetchedItem[]>;
}
