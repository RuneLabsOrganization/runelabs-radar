import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { insights, items, stories } from './db/schema';
import { DOMAINS, DOMAIN_MEMBERSHIP_THRESHOLD, type Domain } from './domains';
import { parseDomainScores } from '@/components/DomainChips';

const DAY_MS = 864e5;

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DayCount {
  date: string; // YYYY-MM-DD (UTC)
  total: number;
  byDomain: Record<Domain, number>;
}

/**
 * Curated-story volume per UTC day for the trailing window, split by domain
 * membership (score >= threshold). Days with no activity are zero-filled so
 * traces stay continuous.
 */
export function dailyDomainCounts(days = 14): DayCount[] {
  const db = getDb();
  const start = new Date(Date.now() - days * DAY_MS);
  const rows = db
    .select({ createdAt: stories.createdAt, domainScores: stories.domainScores })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, start)))
    .all();

  const byDate = new Map<string, DayCount>();
  for (let i = 0; i < days; i++) {
    const date = utcDay(new Date(Date.now() - (days - 1 - i) * DAY_MS));
    byDate.set(date, {
      date,
      total: 0,
      byDomain: Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>,
    });
  }
  for (const row of rows) {
    const bucket = byDate.get(utcDay(row.createdAt));
    if (!bucket) continue;
    bucket.total += 1;
    const scores = parseDomainScores(row.domainScores);
    if (!scores) continue;
    for (const d of DOMAINS) {
      if ((scores[d] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD) bucket.byDomain[d] += 1;
    }
  }
  return [...byDate.values()];
}

export interface Momentum {
  domain: Domain;
  thisWeek: number;
  lastWeek: number;
  /** Percent change w/w; null when last week had nothing to compare against. */
  deltaPct: number | null;
}

/** Week-over-week story volume per domain. */
export function domainMomentum(): Momentum[] {
  const db = getDb();
  const twoWeeksAgo = new Date(Date.now() - 14 * DAY_MS);
  const weekAgo = Date.now() - 7 * DAY_MS;
  const rows = db
    .select({ createdAt: stories.createdAt, domainScores: stories.domainScores })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, twoWeeksAgo)))
    .all();

  const thisWeek = Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>;
  const lastWeek = Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>;
  for (const row of rows) {
    const scores = parseDomainScores(row.domainScores);
    if (!scores) continue;
    const target = row.createdAt.getTime() >= weekAgo ? thisWeek : lastWeek;
    for (const d of DOMAINS) {
      if ((scores[d] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD) target[d] += 1;
    }
  }
  return DOMAINS.map((domain) => ({
    domain,
    thisWeek: thisWeek[domain],
    lastWeek: lastWeek[domain],
    deltaPct:
      lastWeek[domain] > 0
        ? Math.round(((thisWeek[domain] - lastWeek[domain]) / lastWeek[domain]) * 100)
        : null,
  }));
}

export interface EntityCount {
  name: string;
  kind: string;
  count: number;
  /** Mentions in the prior 7-day window (0 = newly on the scope). */
  prev: number;
}

interface StoredEntity {
  name?: unknown;
  kind?: unknown;
}

function collectEntities(rows: { entities: string | null }[]): Map<string, { name: string; kind: string; count: number }> {
  const map = new Map<string, { name: string; kind: string; count: number }>();
  for (const row of rows) {
    if (!row.entities) continue;
    let list: StoredEntity[];
    try {
      const parsed: unknown = JSON.parse(row.entities);
      if (!Array.isArray(parsed)) continue;
      list = parsed as StoredEntity[];
    } catch {
      continue;
    }
    const seenInStory = new Set<string>();
    for (const e of list) {
      if (typeof e?.name !== 'string' || e.name.trim() === '') continue;
      const name = e.name.trim();
      const key = name.toLowerCase();
      if (seenInStory.has(key)) continue; // count once per story
      seenInStory.add(key);
      const cur = map.get(key);
      if (cur) {
        cur.count += 1;
      } else {
        map.set(key, {
          name,
          kind: typeof e.kind === 'string' ? e.kind : 'model',
          count: 1,
        });
      }
    }
  }
  return map;
}

/** Most-mentioned entities across the last 7 days of curated stories, with prior-week counts. */
export function topEntities(limit = 8): EntityCount[] {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(Date.now() - 14 * DAY_MS);

  const current = collectEntities(
    db
      .select({ entities: stories.entities })
      .from(stories)
      .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, weekAgo)))
      .all(),
  );
  const prior = collectEntities(
    db
      .select({ entities: stories.entities, createdAt: stories.createdAt })
      .from(stories)
      .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, twoWeeksAgo)))
      .all()
      .filter((r) => r.createdAt < weekAgo),
  );

  return [...current.entries()]
    .map(([key, e]) => ({ name: e.name, kind: e.kind, count: e.count, prev: prior.get(key)?.count ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export interface EchoStats {
  /** Stories in the last 7 days corroborated by 2+ sources. */
  multiSource: number;
  strongest: { title: string; sources: number } | null;
}

/** Cross-source corroboration: the same story landing from several feeds is a strong signal. */
export function echoStats(): EchoStats {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const recent = db
    .select({ id: stories.id, title: stories.title })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, weekAgo)))
    .all();
  if (recent.length === 0) return { multiSource: 0, strongest: null };

  const counts = new Map<number, number>();
  const itemRows = db
    .select({ storyId: items.storyId })
    .from(items)
    .where(inArray(items.storyId, recent.map((s) => s.id)))
    .all();
  for (const row of itemRows) {
    if (row.storyId == null) continue;
    counts.set(row.storyId, (counts.get(row.storyId) ?? 0) + 1);
  }

  let multiSource = 0;
  let strongest: { title: string; sources: number } | null = null;
  for (const s of recent) {
    const n = counts.get(s.id) ?? 0;
    if (n >= 2) multiSource += 1;
    if (n >= 2 && (!strongest || n > strongest.sources)) {
      strongest = { title: s.title, sources: n };
    }
  }
  return { multiSource, strongest };
}

export interface Insight {
  headline: string;
  detail: string;
  direction: 'up' | 'down' | 'watch';
  domain?: Domain;
}

/** Latest analyst notes (written by the daily brief job). */
export function latestInsights(): { date: string; items: Insight[] } | null {
  const db = getDb();
  const latest = db.select().from(insights).orderBy(desc(insights.date)).limit(1).get();
  if (!latest) return null;
  try {
    const parsed: unknown = JSON.parse(latest.items);
    if (!Array.isArray(parsed)) return null;
    const items = parsed.filter(
      (i): i is Insight =>
        typeof i === 'object' &&
        i !== null &&
        typeof (i as Insight).headline === 'string' &&
        typeof (i as Insight).detail === 'string',
    );
    return { date: latest.date, items };
  } catch {
    return null;
  }
}
