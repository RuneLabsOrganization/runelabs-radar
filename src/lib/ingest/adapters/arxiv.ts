import { XMLParser } from 'fast-xml-parser';
import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchText, parseConfig, parseDate, textOf, toArray, toExcerpt } from './shared';

interface ArxivConfig {
  query?: string;
  maxResults?: number;
}

const parser = new XMLParser({ ignoreAttributes: false });

export const arxivAdapter: SourceAdapter = {
  type: 'arxiv',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    const cfg = parseConfig<ArxivConfig>(source.config);
    const query = cfg.query ?? 'cat:cs.AI OR cat:cs.CL';
    const maxResults = cfg.maxResults ?? 40;
    const url =
      `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}` +
      `&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
    const xml = await fetchText(url);
    const doc = parser.parse(xml) as Record<string, any>;

    const out: FetchedItem[] = [];
    for (const entry of toArray<any>(doc?.feed?.entry)) {
      const entryUrl = textOf(entry?.id);
      // arXiv titles wrap across lines with leading indentation — collapse whitespace.
      const title = textOf(entry?.title)?.replace(/\s+/g, ' ').trim();
      if (!entryUrl || !title) continue;
      out.push({
        url: entryUrl,
        title,
        excerpt: toExcerpt(textOf(entry?.summary)),
        publishedAt: parseDate(textOf(entry?.published)),
      });
    }
    return out;
  },
};
