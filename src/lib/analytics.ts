import { and, count, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { config } from './config';
import { getDb } from './db';
import {
  benchmarkSnapshots,
  insights,
  items,
  jobRuns,
  llmUsage,
  patterns,
  sources as sourcesTable,
  stories,
  topicClusters,
} from './db/schema';
import { DOMAINS, DOMAIN_MEMBERSHIP_THRESHOLD, type Domain } from './domains';
import { safeHttpUrl } from './safe-url';
import { parseDomainScores, topDomain } from '@/components/DomainChips';

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

/** Platforms/sources misextracted as "entities" — noise, not signal. */
const ENTITY_STOPLIST = new Set([
  'reddit',
  'hacker news',
  'hackernews',
  'hn',
  'github',
  'youtube',
  'twitter',
  'x',
  'discord',
  'arxiv',
  'show hn',
]);

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
      const name = e.name.replace(/\s+/g, ' ').trim();
      const key = name.toLowerCase();
      if (ENTITY_STOPLIST.has(key)) continue;
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

/**
 * Daily mention counts for specific entities over the trailing window —
 * the series behind each entity-surge pattern's trend chart. Keys are
 * lowercased entity names; arrays align with dailyDomainCounts' days.
 */
export function entityDailySeries(names: string[], days = 14): Map<string, number[]> {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const out = new Map<string, number[]>();
  if (wanted.size === 0) return out;
  for (const n of wanted) out.set(n, new Array<number>(days).fill(0));

  const dayIndex = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    dayIndex.set(utcDay(new Date(Date.now() - (days - 1 - i) * DAY_MS)), i);
  }

  const db = getDb();
  const rows = db
    .select({ entities: stories.entities, createdAt: stories.createdAt })
    .from(stories)
    .where(
      and(
        eq(stories.status, 'curated'),
        isNotNull(stories.entities),
        gte(stories.createdAt, new Date(Date.now() - days * DAY_MS)),
      ),
    )
    .all();
  for (const row of rows) {
    const idx = dayIndex.get(utcDay(row.createdAt));
    if (idx === undefined || !row.entities) continue;
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
      if (typeof e?.name !== 'string') continue;
      const key = e.name.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!wanted.has(key) || seenInStory.has(key)) continue;
      seenInStory.add(key);
      out.get(key)![idx] += 1;
    }
  }
  return out;
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

export { paretoFrontier } from './pareto';
export type { AaModel } from './pareto';
import type { AaModel } from './pareto';

/**
 * Models from the latest Artificial Analysis snapshot (stored compact by the
 * board sync). Sorted by intelligence, capped to keep the scatter readable.
 */
export function aaModels(limit = 60): { fetchedAt: string; models: AaModel[] } | null {
  const db = getDb();
  const snap = db
    .select()
    .from(benchmarkSnapshots)
    .where(eq(benchmarkSnapshots.source, 'artificial-analysis'))
    .orderBy(desc(benchmarkSnapshots.fetchedAt), desc(benchmarkSnapshots.id))
    .limit(1)
    .get();
  if (!snap) return null;
  try {
    const parsed = JSON.parse(snap.raw) as { compact?: boolean; models?: unknown };
    if (!parsed.compact || !Array.isArray(parsed.models)) return null;
    const models = (parsed.models as Record<string, unknown>[])
      .filter(
        (m): m is Record<string, unknown> =>
          typeof m.name === 'string' &&
          typeof m.intelligence === 'number' &&
          typeof m.price === 'number' &&
          (m.price as number) > 0,
      )
      .map((m) => ({
        name: m.name as string,
        org: typeof m.org === 'string' ? m.org : null,
        intelligence: m.intelligence as number,
        coding: typeof m.coding === 'number' ? m.coding : null,
        price: m.price as number,
        priceIn: typeof m.priceIn === 'number' ? m.priceIn : null,
        priceOut: typeof m.priceOut === 'number' ? m.priceOut : null,
        speed: typeof m.speed === 'number' ? m.speed : null,
        released: typeof m.released === 'string' ? m.released : null,
      }))
      .sort((a, b) => b.intelligence - a.intelligence)
      .slice(0, limit);
    if (models.length === 0) return null;
    return { fetchedAt: snap.fetchedAt.toISOString().slice(0, 10), models };
  } catch {
    return null;
  }
}

export interface MediaModel {
  name: string;
  org: string | null;
  elo: number;
  rank: number;
  released: string | null;
}

export const MEDIA_TYPES = [
  { source: 'aa-media-image', key: 'image', label: 'Text to image' },
  { source: 'aa-media-video', key: 'video', label: 'Text to video' },
  { source: 'aa-media-image-edit', key: 'imageEdit', label: 'Image editing' },
] as const;

export type MediaKey = (typeof MEDIA_TYPES)[number]['key'];

/** Latest AA media-arena snapshots (image/video/image-editing), top models by ELO rank. */
export function aaMedia(limit = 10): { fetchedAt: string; arenas: Partial<Record<MediaKey, MediaModel[]>> } | null {
  const db = getDb();
  const arenas: Partial<Record<MediaKey, MediaModel[]>> = {};
  let newest: Date | null = null;
  for (const t of MEDIA_TYPES) {
    const snap = db
      .select()
      .from(benchmarkSnapshots)
      .where(eq(benchmarkSnapshots.source, t.source))
      .orderBy(desc(benchmarkSnapshots.fetchedAt), desc(benchmarkSnapshots.id))
      .limit(1)
      .get();
    if (!snap) continue;
    try {
      const parsed = JSON.parse(snap.raw) as { compact?: boolean; models?: unknown };
      if (!parsed.compact || !Array.isArray(parsed.models)) continue;
      const models = (parsed.models as Record<string, unknown>[])
        .filter(
          (m): m is Record<string, unknown> =>
            typeof m.name === 'string' && typeof m.elo === 'number' && typeof m.rank === 'number',
        )
        .map((m) => ({
          name: m.name as string,
          org: typeof m.org === 'string' ? m.org : null,
          elo: m.elo as number,
          rank: m.rank as number,
          released: typeof m.released === 'string' ? m.released : null,
        }))
        .sort((a, b) => a.rank - b.rank)
        .slice(0, limit);
      if (models.length > 0) {
        arenas[t.key] = models;
        if (!newest || snap.fetchedAt > newest) newest = snap.fetchedAt;
      }
    } catch {
      // skip unparseable snapshot
    }
  }
  if (!newest) return null;
  return { fetchedAt: newest.toISOString().slice(0, 10), arenas };
}

export interface SourceVolumeRow {
  name: string;
  daily: number[]; // items per day, oldest → newest
  total7d: number;
}

/** Item volume per source: daily counts for sparklines + 7-day totals. */
export function sourceVolume(days = 14): SourceVolumeRow[] {
  const db = getDb();
  const start = new Date(Date.now() - days * DAY_MS);
  const rows = db
    .select({ fetchedAt: items.fetchedAt, name: sourcesTable.name })
    .from(items)
    .innerJoin(sourcesTable, eq(items.sourceId, sourcesTable.id))
    .where(gte(items.fetchedAt, start))
    .all();

  // UTC calendar-day buckets, matching dailyDomainCounts.
  const index = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    index.set(utcDay(new Date(Date.now() - (days - 1 - i) * DAY_MS)), i);
  }
  const bySource = new Map<string, number[]>();
  for (const row of rows) {
    const i = index.get(utcDay(row.fetchedAt));
    if (i === undefined) continue;
    const daily = bySource.get(row.name) ?? new Array<number>(days).fill(0);
    daily[i] += 1;
    bySource.set(row.name, daily);
  }
  return [...bySource.entries()]
    .map(([name, daily]) => ({
      name,
      daily,
      total7d: daily.slice(-7).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total7d - a.total7d);
}

export interface JobRunCell {
  status: 'ok' | 'error' | 'running';
  startedAt: Date;
  durationMs: number | null;
}

/** Recent runs per job for the health timeline (oldest → newest). */
export function jobHistory(perJob = 28): Record<string, JobRunCell[]> {
  const db = getDb();
  const out: Record<string, JobRunCell[]> = {};
  for (const job of [
    'ingest',
    'curate',
    'embed',
    'snapshot',
    'velocity',
    'launches',
    'pain',
    'science',
    'opportunities',
    'board',
    'brief',
    'stacks',
  ] as const) {
    const rows = db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, job))
      .orderBy(desc(jobRuns.id))
      .limit(perJob)
      .all();
    out[job] = rows
      .reverse()
      .map((r) => ({
        status: r.status,
        startedAt: r.startedAt,
        durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      }));
  }
  return out;
}

/** Daily LLM call counts (zero-filled) plus the configured cap. */
export function llmUsageHistory(days = 14): { days: { date: string; calls: number }[]; cap: number } {
  const db = getDb();
  const rows = db.select().from(llmUsage).all();
  const byDate = new Map(rows.map((r) => [r.date, r.calls]));
  const out: { date: string; calls: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = utcDay(new Date(Date.now() - i * DAY_MS));
    out.push({ date, calls: byDate.get(date) ?? 0 });
  }
  return { days: out, cap: config.minimaxDailyCallCap };
}

export interface Funnel {
  items: number;
  stories: number;
  curated: number;
  topSignals: number;
}

/** 7-day pipeline conversion: fetched items → stories → curated → top signals. */
export function pipelineFunnel(days = 7): Funnel {
  const db = getDb();
  const start = new Date(Date.now() - days * DAY_MS);
  const itemCount =
    db.select({ c: count() }).from(items).where(gte(items.fetchedAt, start)).get()?.c ?? 0;
  const storyRows = db
    .select({ status: stories.status, topScore: stories.topScore })
    .from(stories)
    .where(gte(stories.createdAt, start))
    .all();
  const curated = storyRows.filter((s) => s.status === 'curated');
  return {
    items: itemCount,
    stories: storyRows.length,
    curated: curated.length,
    topSignals: curated.filter((s) => s.topScore >= 70).length,
  };
}

export interface PatternRow {
  kind: string;
  subject: string | null;
  headline: string;
  detail: string;
  score: number;
  date: string;
}

/** The most recent day's anomaly detections, strongest first. */
export function latestPatterns(limit = 6): PatternRow[] {
  const db = getDb();
  const latest = db
    .select({ date: patterns.date })
    .from(patterns)
    .orderBy(desc(patterns.date))
    .limit(1)
    .get();
  if (!latest) return [];
  return db
    .select({
      kind: patterns.kind,
      subject: patterns.subject,
      headline: patterns.headline,
      detail: patterns.detail,
      score: patterns.score,
      date: patterns.date,
    })
    .from(patterns)
    .where(eq(patterns.date, latest.date))
    .orderBy(desc(patterns.score))
    .limit(limit)
    .all();
}

export interface TopicNode {
  id: number;
  label: string;
  summary: string | null;
  size: number;
  heat: number;
  coherence: number;
  sector: Domain | null;
  children: TopicNode[];
}

/** Latest clustering run as a macro→subtopic tree (largest first at each level). */
export function topicHierarchy(): TopicNode[] | null {
  const db = getDb();
  const rows = db.select().from(topicClusters).all();
  if (rows.length === 0) return null;

  const toNode = (r: (typeof rows)[number]): TopicNode => ({
    id: r.id,
    label: r.label,
    summary: r.summary,
    size: r.size,
    heat: r.heat,
    coherence: r.coherence,
    sector: r.sector && (DOMAINS as readonly string[]).includes(r.sector) ? (r.sector as Domain) : null,
    children: [],
  });

  const macros = rows.filter((r) => r.parentId === null).map(toNode);
  const byId = new Map(macros.map((m) => [m.id, m]));
  for (const r of rows) {
    if (r.parentId === null) continue;
    byId.get(r.parentId)?.children.push(toNode(r));
  }
  for (const m of macros) m.children.sort((a, b) => b.size - a.size);
  macros.sort((a, b) => b.size - a.size);
  return macros;
}

export interface ClusterStory {
  id: number;
  title: string;
  url: string | null;
  score: number;
  ageDays: number;
  sector: Domain | null;
}

/** Stories of one leaf cluster, strongest first — the bottom of the drill-down. */
export function clusterStories(clusterId: number, limit = 40): ClusterStory[] {
  const db = getDb();
  const rows = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), eq(stories.clusterId, clusterId)))
    .orderBy(desc(stories.topScore))
    .limit(limit)
    .all();
  if (rows.length === 0) return [];

  const urlByStory = new Map<number, string>();
  const itemRows = db
    .select({ storyId: items.storyId, url: items.url })
    .from(items)
    .where(inArray(items.storyId, rows.map((r) => r.id)))
    .orderBy(items.id)
    .all();
  for (const row of itemRows) {
    if (row.storyId !== null && !urlByStory.has(row.storyId)) urlByStory.set(row.storyId, row.url);
  }

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: safeHttpUrl(urlByStory.get(r.id) ?? null),
    score: r.topScore,
    ageDays: Math.max(0, Math.round((now - r.createdAt.getTime()) / 864e5)),
    sector: topDomain(parseDomainScores(r.domainScores)),
  }));
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
