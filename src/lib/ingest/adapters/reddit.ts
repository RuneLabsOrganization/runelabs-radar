import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchJson, parseConfig, toExcerpt } from './shared';

interface RedditConfig {
  subreddit?: string;
}

interface RedditPost {
  title?: string;
  permalink?: string;
  selftext?: string;
  created_utc?: number;
}

interface RedditListing {
  data?: { children?: Array<{ data?: RedditPost }> };
}

export const redditAdapter: SourceAdapter = {
  type: 'reddit',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    const cfg = parseConfig<RedditConfig>(source.config);
    if (!cfg.subreddit) throw new Error(`reddit source "${source.name}" is missing config.subreddit`);
    const url = `https://www.reddit.com/r/${encodeURIComponent(cfg.subreddit)}/top.json?t=day&limit=25`;
    const listing = await fetchJson<RedditListing>(url, {
      headers: { 'User-Agent': 'runelabs-radar/1.0' },
    });

    const out: FetchedItem[] = [];
    for (const child of listing.data?.children ?? []) {
      const post = child?.data;
      if (!post?.title || !post.permalink) continue;
      out.push({
        url: `https://www.reddit.com${post.permalink}`,
        title: post.title,
        excerpt: toExcerpt(post.selftext),
        publishedAt: typeof post.created_utc === 'number' ? new Date(post.created_utc * 1000) : null,
      });
    }
    return out;
  },
};
