import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchText, parseConfig } from './shared';
import { parseFeed } from './rss';

interface RedditConfig {
  subreddit?: string;
}

// Reddit 403s generic clients on its JSON API regardless of User-Agent; the
// .rss endpoint with a browser-like UA is the reliable unauthenticated option.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Reddit rate-limits unauthenticated requests to roughly one per ~10s per IP —
// back-to-back subreddit fetches within one ingest run get 429s without this.
const MIN_INTERVAL_MS = 12_000;
let queue: Promise<unknown> = Promise.resolve();
let lastFetchAt = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const wait = lastFetchAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastFetchAt = Date.now();
    }
  });
  queue = next.catch(() => {});
  return next;
}

export const redditAdapter: SourceAdapter = {
  type: 'reddit',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    const cfg = parseConfig<RedditConfig>(source.config);
    if (!cfg.subreddit) throw new Error(`reddit source "${source.name}" is missing config.subreddit`);
    const url = `https://www.reddit.com/r/${encodeURIComponent(cfg.subreddit)}/top/.rss?t=day&limit=25`;
    return throttled(async () => {
      const xml = await fetchText(url, {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      return parseFeed(xml);
    });
  },
};
