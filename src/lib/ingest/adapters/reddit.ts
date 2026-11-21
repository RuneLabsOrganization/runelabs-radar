import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchJson, fetchText, parseConfig, parseDate, toExcerpt } from './shared';
import { parseFeed } from './rss';

interface RedditConfig {
  subreddit?: string;
}

// Reddit 403s generic clients on its JSON API regardless of User-Agent; the
// .rss endpoint with a browser-like UA is the reliable unauthenticated option.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Reddit rate-limits unauthenticated requests to roughly one per minute per IP —
// closely spaced subreddit fetches within one ingest run get 429s without this.
// The worker runs every 30 min, so a ~1 min gap between subreddits is harmless.
const MIN_INTERVAL_MS = 61_000;
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

/**
 * Reddit shut off unauthenticated subreddit RSS (every .rss URL 404s), so when
 * REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET are set we use the official app-only
 * OAuth flow (client_credentials, read-only, ~100 req/min) against
 * oauth.reddit.com. Without credentials the legacy RSS path below is kept.
 */
const OAUTH_UA = 'RunelabsRadar/1.0 (read-only research feed; +https://radar.runelabs.org)';
const OAUTH_INTERVAL_MS = 1_100;

interface RedditToken {
  value: string;
  expiresAt: number;
}
let token: RedditToken | null = null;

export function _resetRedditTokenForTests(): void {
  token = null;
}

function oauthCreds(): { id: string; secret: string } | null {
  const id = process.env.REDDIT_CLIENT_ID?.trim();
  const secret = process.env.REDDIT_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

async function accessToken(creds: { id: string; secret: string }): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const res = await fetchJson<{ access_token?: string; expires_in?: number; error?: string }>(
    'https://www.reddit.com/api/v1/access_token',
    {
      method: 'POST',
      headers: {
        'User-Agent': OAUTH_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${creds.id}:${creds.secret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    },
  );
  if (!res.access_token) throw new Error(`reddit oauth failed: ${res.error ?? 'no access_token in response'}`);
  token = { value: res.access_token, expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000 };
  return token.value;
}

interface RedditListing {
  data?: {
    children?: {
      data?: { title?: string; permalink?: string; selftext?: string; created_utc?: number; stickied?: boolean };
    }[];
  };
}

async function fetchViaOauth(subreddit: string, creds: { id: string; secret: string }): Promise<FetchedItem[]> {
  const bearer = await accessToken(creds);
  const listing = await fetchJson<RedditListing>(
    `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/top?t=day&limit=25&raw_json=1`,
    { headers: { 'User-Agent': OAUTH_UA, Authorization: `Bearer ${bearer}` } },
  );
  const out: FetchedItem[] = [];
  for (const child of listing.data?.children ?? []) {
    const d = child.data;
    if (!d?.title || !d.permalink || d.stickied) continue;
    out.push({
      url: `https://www.reddit.com${d.permalink}`,
      title: d.title,
      excerpt: toExcerpt(d.selftext),
      publishedAt: d.created_utc ? parseDate(d.created_utc * 1000) : null,
    });
  }
  return out;
}

let oauthQueue: Promise<unknown> = Promise.resolve();
let oauthLastAt = 0;

function oauthThrottled<T>(fn: () => Promise<T>): Promise<T> {
  const next = oauthQueue.then(async () => {
    const wait = oauthLastAt + OAUTH_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      oauthLastAt = Date.now();
    }
  });
  oauthQueue = next.catch(() => {});
  return next;
}

export const redditAdapter: SourceAdapter = {
  type: 'reddit',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    const cfg = parseConfig<RedditConfig>(source.config);
    if (!cfg.subreddit) throw new Error(`reddit source "${source.name}" is missing config.subreddit`);
    const creds = oauthCreds();
    if (creds) return oauthThrottled(() => fetchViaOauth(cfg.subreddit as string, creds));
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
