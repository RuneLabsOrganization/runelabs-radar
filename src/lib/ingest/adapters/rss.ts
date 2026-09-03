import { XMLParser } from 'fast-xml-parser';
import { safePublicHttpUrl } from '../../safe-url';
import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchWithTimeout, parseConfig, parseDate, textOf, toArray, toExcerpt, xmlNode } from './shared';

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
    const rec = xmlNode(l);
    if (rec) {
      const href = typeof rec['@_href'] === 'string' ? rec['@_href'] : null;
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
  const doc = xmlNode(parser.parse(xml));
  const out: FetchedItem[] = [];

  const channel = xmlNode(toArray(xmlNode(doc?.rss)?.channel)[0]);
  if (channel) {
    for (const item of toArray(channel.item)) {
      const node = xmlNode(item);
      if (!node) continue;
      const url = textOf(node.link);
      const title = textOf(node.title);
      if (!url || !title) continue;
      out.push({
        url,
        title,
        excerpt: toExcerpt(textOf(node.description)),
        publishedAt: parseDate(textOf(node.pubDate)),
      });
    }
    return out;
  }

  const feed = xmlNode(doc?.feed);
  if (feed) {
    for (const entry of toArray(feed.entry)) {
      const node = xmlNode(entry);
      if (!node) continue;
      const url = atomLink(node.link);
      const title = textOf(node.title);
      if (!url || !title) continue;
      out.push({
        url,
        title,
        excerpt: toExcerpt(textOf(node.summary) ?? textOf(node.content)),
        publishedAt: parseDate(textOf(node.updated) ?? textOf(node.published)),
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
    // SSRF guard at config time: the admin-supplied feed URL must be http(s)
    // on a public host (fetchWithTimeout re-validates every redirect hop)
    const url = safePublicHttpUrl(config.url);
    if (!url) throw new Error(`rss source "${source.name}" has an unsafe config.url: ${config.url}`);

    // conditional GET: skip the download entirely when the feed hasn't moved
    const headers: Record<string, string> = {};
    if (config.etag) headers['if-none-match'] = config.etag;
    if (config.lastModified) headers['if-modified-since'] = config.lastModified;
    const res = await fetchWithTimeout(url, { headers });
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
