import { XMLParser } from 'fast-xml-parser';
import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchText, parseConfig, parseDate, textOf, toArray, toExcerpt, xmlNode } from './shared';

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
    const doc = xmlNode(parser.parse(xml));

    const out: FetchedItem[] = [];
    for (const entry of toArray(xmlNode(doc?.feed)?.entry)) {
      const node = xmlNode(entry);
      if (!node) continue;
      const entryUrl = textOf(node.id);
      // arXiv titles wrap across lines with leading indentation — collapse whitespace.
      const title = textOf(node.title)?.replace(/\s+/g, ' ').trim();
      if (!entryUrl || !title) continue;
      out.push({
        url: entryUrl,
        title,
        excerpt: toExcerpt(textOf(node.summary)),
        publishedAt: parseDate(textOf(node.published)),
      });
    }
    return out;
  },
};
