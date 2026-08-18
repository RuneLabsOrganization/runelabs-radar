import { XMLParser } from 'fast-xml-parser';
import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchWithTimeout, parseConfig, parseDate, textOf, toArray, toExcerpt } from './shared';

interface RssConfig {
  url?: string;
  /** Conditional-GET state persisted in the sources.config JSON by runIngest. */
  etag?: string;
  lastModified?: string;
}

const parser = new XMLParser({ ignoreAttributes: false });

/** Pick the best href from an Atom entry's link(s): prefer rel="alternate" (or no rel), fall back to the first href. */
function atomLink(link: unknown): string | null {
  let fallback: string | null = null;
  for (const l of toArray(link)) {
    if (typeof l === 'string' && l.trim()) return l.trim();
    if (l && typeof l === 'object') {
      const rec = l as Record<string, unknown>;
      const href = typeof rec['@_href'] === 'string' ? (rec['@_href'] as string) : null;
      if (!href) continue;
      const rel = rec['@_rel'];
      if (rel == null || rel === 'alternate') return href;
      fallback ??= href;
    }
  }
  return fallback;
}

/** Parse an RSS 2.0 (`rss.channel.item[]`) or Atom (`feed.entry[]`) document into FetchedItems. */
export function parseFeed(xml: string): FetchedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const out: FetchedItem[] = [];

  const channel = toArray(doc?.rss?.channel)[0];
  if (channel) {
    for (const item of toArray<any>(channel.item)) {
      const url = textOf(item?.link);
      const title = textOf(item?.title);
      if (!url || !title) continue;
      out.push({
        url,
        title,
        excerpt: toExcerpt(textOf(item?.description)),
        publishedAt: parseDate(textOf(item?.pubDate)),
      });
    }
    return out;
  }

  const feed = doc?.feed;
  if (feed) {
    for (const entry of toArray<any>(feed.entry)) {
      const url = atomLink(entry?.link);
      const title = textOf(entry?.title);
      if (!url || !title) continue;
      out.push({
        url,
        title,
        excerpt: toExcerpt(textOf(entry?.summary) ?? textOf(entry?.content)),
        publishedAt: parseDate(textOf(entry?.updated) ?? textOf(entry?.published)),
      });
    }
  }
  return out;
}

export const rssAdapter: SourceAdapter = {
  type: 'rss',
  async fetchItems(source: Source, cfg?: Record<string, unknown>): Promise<FetchedItem[]> {
    // cfg is the orchestrator-parsed config (mutations persist); fall back to
    // parsing the raw column when called standalone (tests, CLI)
    const config = (cfg as RssConfig | undefined) ?? parseConfig<RssConfig>(source.config);
    if (!config.url) throw new Error(`rss source "${source.name}" is missing config.url`);

    // conditional GET: skip the download entirely when the feed hasn't moved
    const headers: Record<string, string> = {};
    if (config.etag) headers['if-none-match'] = config.etag;
    if (config.lastModified) headers['if-modified-since'] = config.lastModified;
    const res = await fetchWithTimeout(config.url, { headers });
    if (res.status === 304) return [];

    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    if (etag) config.etag = etag;
    else delete config.etag;
    if (lastModified) config.lastModified = lastModified;
    else delete config.lastModified;

    return parseFeed(await res.text());
  },
};
