import { and, gte, isNull } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { config } from './config';
import { getDb } from './db';
import { launches } from './db/schema';
import { fetchJson } from './ingest/adapters/shared';
import { chatJSON, drainLlmUsageStats } from './llm/minimax';
import { upsertMetric, utcDay } from './metrics';

export const LAUNCH_CATEGORIES = [
  'ai-coding',
  'ai-content',
  'ai-media',
  'agents',
  'devtools',
  'saas-tools',
  'consumer',
  'other',
] as const;

interface ShowHnHit {
  objectID?: string;
  title?: string | null;
  url?: string | null;
  points?: number;
  num_comments?: number;
  created_at?: string;
}

export interface NewLaunch {
  source: 'show-hn' | 'producthunt';
  title: string;
  url: string;
  points: number | null;
  comments: number | null;
  launchedAt: Date;
}

/** Maps Algolia Show HN hits to launches; strips the "Show HN:" prefix. Exported for tests. */
export function mapShowHn(hits: ShowHnHit[]): NewLaunch[] {
  const out: NewLaunch[] = [];
  for (const hit of hits) {
    if (!hit.title) continue;
    const fallback = hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : null;
    const url = hit.url || fallback;
    if (!url) continue;
    const launchedAt = hit.created_at ? new Date(hit.created_at) : new Date();
    if (Number.isNaN(launchedAt.getTime())) continue;
    out.push({
      source: 'show-hn',
      title: hit.title.replace(/^show hn:?\s*/i, '').trim() || hit.title,
      url,
      points: typeof hit.points === 'number' ? hit.points : null,
      comments: typeof hit.num_comments === 'number' ? hit.num_comments : null,
      launchedAt,
    });
  }
  return out;
}

interface PhPost {
  name?: string;
  tagline?: string;
  url?: string;
  votesCount?: number;
  commentsCount?: number;
  createdAt?: string;
}

async function fetchProductHunt(): Promise<NewLaunch[]> {
  const query = `{
    posts(order: VOTES, postedAfter: "${new Date(Date.now() - 864e5).toISOString()}", first: 40) {
      nodes { name tagline url votesCount commentsCount createdAt }
    }
  }`;
  const data = await fetchJson<{ data?: { posts?: { nodes?: PhPost[] } } }>(
    'https://api.producthunt.com/v2/api/graphql',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.phToken}`,
      },
      body: JSON.stringify({ query }),
    },
  );
  const out: NewLaunch[] = [];
  for (const p of data.data?.posts?.nodes ?? []) {
    if (!p.name || !p.url) continue;
    const launchedAt = p.createdAt ? new Date(p.createdAt) : new Date();
    if (Number.isNaN(launchedAt.getTime())) continue;
    out.push({
      source: 'producthunt',
      title: p.tagline ? `${p.name} — ${p.tagline}` : p.name,
      url: p.url,
      points: typeof p.votesCount === 'number' ? p.votesCount : null,
      comments: typeof p.commentsCount === 'number' ? p.commentsCount : null,
      launchedAt,
    });
  }
  return out;
}

function upsertLaunches(list: NewLaunch[]): number {
  const db = getDb();
  let n = 0;
  for (const l of list) {
    db.insert(launches)
      .values({ ...l, createdAt: new Date() })
      .onConflictDoUpdate({
        target: launches.url,
        set: { points: l.points, comments: l.comments },
      })
      .run();
    n++;
  }
  return n;
}

/**
 * One batched LLM call tags untagged recent launches with a category slug.
 * Launches the response omits (or mislabels) stay NULL so the next run
 * retries them — never coerce to 'other' on a bad response shape.
 * Exported for tests.
 */
export async function tagCategories(): Promise<number> {
  const db = getDb();
  const untagged = db
    .select()
    .from(launches)
    .where(and(isNull(launches.category), gte(launches.launchedAt, new Date(Date.now() - 2 * 864e5))))
    .all();
  if (untagged.length === 0) return 0;

  const system =
    'You classify product launches into exactly one category from this set: ' +
    `${LAUNCH_CATEGORIES.join(', ')}. ` +
    'ai-coding = coding assistants/dev AI; ai-content = writing/marketing AI; ai-media = ' +
    'image/video/audio generation; agents = autonomous agents/automation; devtools = developer ' +
    'tooling without AI focus; saas-tools = business/productivity SaaS; consumer = consumer apps; ' +
    'other = anything else.\n' +
    'Respond with STRICT JSON only: {"categories":{"<id>":"<category>"}} — one key per launch id given.';
  const user = untagged.map((l) => `Launch ${l.id}: ${l.title}`).join('\n');

  const res = await chatJSON<{ categories?: Record<string, unknown> }>(system, user);
  const map = res.categories;
  if (typeof map !== 'object' || map === null || Object.keys(map).length === 0) {
    console.warn('[launches] tagging response missing "categories" — leaving launches untagged for retry');
    return 0;
  }
  let tagged = 0;
  for (const l of untagged) {
    const cat = map[String(l.id)];
    if (typeof cat !== 'string' || !(LAUNCH_CATEGORIES as readonly string[]).includes(cat)) {
      continue; // stays NULL → retried next run
    }
    db.update(launches).set({ category: cat }).where(eq(launches.id, l.id)).run();
    tagged++;
  }
  if (tagged === 0) {
    console.warn('[launches] tagging response matched no launch ids — check response shape');
  }
  return tagged;
}

/**
 * Writes per-category launch counts keyed by the LAUNCH date (not run time),
 * covering the tagging retry window. Untagged rows are skipped, and every
 * category is written (zeros included) for each covered day, so a later
 * successful tagging run heals earlier bad values. Exported for tests.
 */
export function recordDailyCounts(): void {
  const db = getDb();
  const twoDaysAgo = new Date(Date.now() - 2 * 864e5);
  const recent = db.select().from(launches).where(gte(launches.launchedAt, twoDaysAgo)).all();

  const byDay = new Map<string, Map<string, number>>();
  for (const l of recent) {
    if (!l.category) continue; // untagged → wait for the retry, don't pollute the series
    const day = utcDay(l.launchedAt);
    const counts = byDay.get(day) ?? new Map<string, number>();
    counts.set(l.category, (counts.get(l.category) ?? 0) + 1);
    byDay.set(day, counts);
  }
  for (const [day, counts] of byDay) {
    for (const category of LAUNCH_CATEGORIES) {
      upsertMetric({
        source: 'launches',
        entity: category,
        metric: 'count',
        value: counts.get(category) ?? 0,
        date: day,
      });
    }
  }
}

/**
 * Daily launch radar: Show HN (always) + Product Hunt (when PH_TOKEN is set),
 * LLM category tagging, and per-category daily counts for the lag-correlation
 * machinery.
 */
export async function runLaunches(): Promise<{ fetched: number; tagged: number }> {
  let fetched = 0;

  try {
    const since = Math.floor(Date.now() / 1000) - 86400;
    const data = await fetchJson<{ hits?: ShowHnHit[] }>(
      `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=50&numericFilters=created_at_i>${since}`,
    );
    fetched += upsertLaunches(mapShowHn(data.hits ?? []));
  } catch (e) {
    console.error('[launches] Show HN fetch failed:', e);
  }

  if (config.phToken) {
    try {
      fetched += upsertLaunches(await fetchProductHunt());
    } catch (e) {
      console.error('[launches] Product Hunt fetch failed:', e);
    }
  }

  let tagged = 0;
  try {
    tagged = await tagCategories();
  } catch (e) {
    console.error('[launches] category tagging failed:', e);
  }
  recordDailyCounts();

  return { fetched, tagged, ...drainLlmUsageStats() };
}
