import { and, gte, isNull } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { config } from './config';
import { getDb } from './db';
import { launches } from './db/schema';
import { fetchJson } from './ingest/adapters/shared';
import { chatJSON } from './llm/minimax';
import { upsertMetric } from './metrics';

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

/** One batched LLM call tags untagged recent launches with a category slug. */
async function tagCategories(): Promise<number> {
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
  const map = res.categories ?? {};
  let tagged = 0;
  for (const l of untagged) {
    const cat = map[String(l.id)];
    const valid =
      typeof cat === 'string' && (LAUNCH_CATEGORIES as readonly string[]).includes(cat)
        ? cat
        : 'other';
    db.update(launches).set({ category: valid }).where(eq(launches.id, l.id)).run();
    tagged++;
  }
  return tagged;
}

/** Writes today's launch counts per category into the time-series store. */
function recordDailyCounts(): void {
  const db = getDb();
  const dayAgo = new Date(Date.now() - 864e5);
  const recent = db.select().from(launches).where(gte(launches.launchedAt, dayAgo)).all();
  const counts = new Map<string, number>();
  for (const l of recent) {
    const cat = l.category ?? 'other';
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  for (const [category, count] of counts) {
    upsertMetric({ source: 'launches', entity: category, metric: 'count', value: count });
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

  return { fetched, tagged };
}
