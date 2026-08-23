import { and, count, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { memo, TTL } from './cache';
import { config } from './config';
import { getDb } from './db';
import {
  benchmarkSnapshots,
  comps as compsTable,
  insights,
  items,
  jobRuns,
  launches as launchesTable,
  llmUsage,
  metricPoints,
  opportunities as opportunitiesTable,
  patterns,
  sources as sourcesTable,
  stacks as stacksTable,
  stories,
  topicClusters,
} from './db/schema';
import { DOMAINS, DOMAIN_MEMBERSHIP_THRESHOLD, type Domain } from './domains';
import { TOP_SIGNAL_MIN } from './feed';
import { canonicalEntityKey, canonicalEntityName } from './entity';
import { RUNNING_FRESH_MS, type JobName } from './jobs';
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
function _dailyDomainCounts(days = 14): DayCount[] {
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
function _domainMomentum(): Momentum[] {
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
      if (ENTITY_STOPLIST.has(name.toLowerCase())) continue;
      // canonical key merges variants ("GPT-5" ≡ "gpt 5") into one entity
      const key = canonicalEntityKey(name);
      if (key === '') continue;
      if (seenInStory.has(key)) continue; // count once per story
      seenInStory.add(key);
      const cur = map.get(key);
      if (cur) {
        cur.count += 1;
      } else {
        map.set(key, {
          name: canonicalEntityName(name),
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
 * canonicalEntityKey(name); arrays align with dailyDomainCounts' days.
 */
function _entityDailySeries(names: string[], days = 14): Map<string, number[]> {
  const wanted = new Set(names.map((n) => canonicalEntityKey(n)));
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
      const key = canonicalEntityKey(e.name);
      if (!wanted.has(key) || seenInStory.has(key)) continue;
      seenInStory.add(key);
      out.get(key)![idx] += 1;
    }
  }
  return out;
}

/** Most-mentioned entities across the last 7 days of curated stories, with prior-week counts. */
function _topEntities(limit = 8): EntityCount[] {
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
function _echoStats(): EchoStats {
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
 * Join key across market sources (§6d): vendor display names ('GPT-5.5',
 * 'Claude Sonnet 4.5') and OpenRouter ids ('openai/gpt-5.5') must collide.
 * Drops the 'vendor/' prefix, then folds case/punctuation via
 * canonicalEntityKey, so 'anthropic/claude-sonnet-4.5' ≡ 'Claude Sonnet 4.5'.
 * OpenRouter variant suffixes (':free', ':extended') survive the fold
 * ('gpt55free') — distinct SKUs deliberately keep distinct keys.
 */
export function normalizeModelKey(name: string): string {
  const tail = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  return canonicalEntityKey(tail);
}

export type MarketSource = 'first_party' | 'artificial_analysis';

export interface MarketModel extends AaModel {
  source: MarketSource;
}

/** Latest compact AA snapshot parsed into AaModel rows (genuine AA data only — never first-party). */
function latestAaSnapshotModels(limit = 60): { fetchedAt: string; models: AaModel[] } | null {
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

/** Genuine AA rows from the latest stored snapshot — the §6e divergence logger compares against these. */
function _aaSnapshotModels(): AaModel[] {
  return latestAaSnapshotModels()?.models ?? [];
}

interface FpModel {
  /** Best display name seen (open-bench wins over pricing/openrouter rows). */
  name: string | null;
  intelligence: number | null;
  elo: number | null;
  ppIn: number | null;
  ppOut: number | null;
  orIn: number | null;
  orOut: number | null;
  speed: number | null;
}

/**
 * First-party market rows assembled from our own metric_points series
 * (§6a/§6b): capability from 'open-bench' (metric 'intelligence'; 'elo'
 * min-max-mapped onto the 0-100 index when a model has no composite), prices
 * from 'provider-pricing' with 'openrouter' filling the gaps, speed from the
 * 'radar-speed' rollup (§6e). The media/livebench metric keys ('image_elo' /
 * 'video_elo' / 'livebench') are deliberately NOT capability evidence here —
 * different arenas must not qualify a model as covered (§6b note to 6d).
 * A model is first-party-covered when it has a capability signal AND at least
 * one price signal; everything else stays on the AA backstop.
 */
function firstPartyModels(): { latestDate: string | null; models: MarketModel[] } {
  const db = getDb();
  // latest value per series; SQLite resolves bare columns from the max(date) row
  const rows = db
    .select({
      source: metricPoints.source,
      entity: metricPoints.entity,
      metric: metricPoints.metric,
      value: metricPoints.value,
      latest: sql<string>`max(${metricPoints.date})`,
    })
    .from(metricPoints)
    .where(inArray(metricPoints.source, ['provider-pricing', 'open-bench', 'openrouter', 'radar-speed']))
    .groupBy(metricPoints.source, metricPoints.entity, metricPoints.metric)
    .all();

  const acc = new Map<string, FpModel>();
  let latestDate: string | null = null;
  for (const r of rows) {
    if (latestDate === null || r.latest > latestDate) latestDate = r.latest;
    const key = normalizeModelKey(r.entity);
    if (key === '') continue;
    const cur =
      acc.get(key) ??
      ({ name: null, intelligence: null, elo: null, ppIn: null, ppOut: null, orIn: null, orOut: null, speed: null } as FpModel);
    if (r.source === 'open-bench') {
      if (r.metric === 'intelligence') {
        cur.intelligence = r.value;
        cur.name = r.entity;
      } else if (r.metric === 'elo') {
        cur.elo = r.value;
        cur.name ??= r.entity;
      }
    } else if (r.source === 'provider-pricing') {
      if (r.metric === 'price_in') cur.ppIn = r.value;
      else if (r.metric === 'price_out') cur.ppOut = r.value;
      cur.name ??= r.entity;
    } else if (r.source === 'openrouter') {
      if (r.metric === 'price_in') cur.orIn = r.value;
      else if (r.metric === 'price_out') cur.orOut = r.value;
      cur.name ??= r.entity.slice(r.entity.lastIndexOf('/') + 1);
    } else if (r.source === 'radar-speed' && r.metric === 'output_toks_per_s') {
      cur.speed = r.value;
    }
    acc.set(key, cur);
  }

  // ELO-only models land on the 0-100 index via min-max over the ELO cohort.
  const elos = [...acc.values()].filter((m) => m.elo !== null).map((m) => m.elo!);
  const eloLo = elos.length > 0 ? Math.min(...elos) : 0;
  const eloHi = elos.length > 0 ? Math.max(...elos) : 0;

  const models: MarketModel[] = [];
  for (const m of acc.values()) {
    const priceIn = m.ppIn ?? m.orIn;
    const priceOut = m.ppOut ?? m.orOut;
    const covered = (m.intelligence !== null || m.elo !== null) && (priceIn !== null || priceOut !== null);
    if (!covered) continue;
    const intelligence =
      m.intelligence ?? (eloHi === eloLo ? 50 : Math.round(((m.elo! - eloLo) / (eloHi - eloLo)) * 1000) / 10);
    const price =
      priceIn !== null && priceOut !== null
        ? (3 * priceIn + priceOut) / 4 // AA-convention 3:1 blend, keeps value math comparable
        : (priceIn ?? priceOut)!;
    models.push({
      name: m.name ?? '?',
      org: null, // no first-party org signal yet
      intelligence: Math.round(intelligence * 10) / 10,
      coding: null,
      price,
      priceIn,
      priceOut,
      speed: m.speed,
      released: null,
      source: 'first_party',
    });
  }
  models.sort((a, b) => b.intelligence - a.intelligence);
  return { latestDate, models };
}

/**
 * Merged model-market reader (§6d): first-party series first, the AA snapshot
 * as backstop for models with no first-party coverage.
 *
 * AA fallback gate: a stored snapshot means AA was configured when it was
 * fetched, so uncovered models keep their AA rows even when AA_API_KEY is
 * later unset — matching runBoardSync's stale-snapshot backstop policy during
 * the transition. (The spec's strict key-only gate was softened because
 * existing consumers rely on snapshot-only operation with no key set.)
 *
 * SUNSET RULE: when first-party covers ≥90% of board-referenced models for 2
 * consecutive weekly syncs, AA defaults to disabled — ops unsets AA_API_KEY
 * and the remaining snapshot ages out of the backstop role.
 */
function _marketModels(limit = 60): { fetchedAt: string; models: MarketModel[] } | null {
  const fp = firstPartyModels();
  const covered = new Set(fp.models.map((m) => normalizeModelKey(m.name)));
  const aa = latestAaSnapshotModels(limit);
  const models: MarketModel[] = [...fp.models];
  if (aa) {
    for (const m of aa.models) {
      if (covered.has(normalizeModelKey(m.name))) continue;
      models.push({ ...m, source: 'artificial_analysis' });
    }
  }
  if (models.length === 0) return null;
  models.sort((a, b) => b.intelligence - a.intelligence);
  const dates = [fp.latestDate, aa?.fetchedAt ?? null].filter((d): d is string => d !== null);
  return { fetchedAt: dates.sort().pop()!, models: models.slice(0, limit) };
}

/**
 * Models from the merged market reader (first-party series + AA snapshot
 * backstop). Sorted by intelligence, capped to keep the scatter readable.
 * Shape unchanged from the pre-§6d AA-only reader.
 */
function _aaModels(limit = 60): { fetchedAt: string; models: AaModel[] } | null {
  return marketModels(limit);
}

export interface RadarScore {
  composite: number;
  costEfficiency: number | null;
}

/**
 * Latest Radar Score sub-scores per model (§6e), keyed by normalizeModelKey.
 * 'composite' and 'cost_efficiency' may come from different days (a model
 * without price data writes no cost_efficiency row) — each takes its own latest.
 */
function _latestRadarScores(): Map<string, RadarScore> {
  const db = getDb();
  const rows = db
    .select({
      entity: metricPoints.entity,
      metric: metricPoints.metric,
      value: metricPoints.value,
      latest: sql<string>`max(${metricPoints.date})`,
    })
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'radar-score'), inArray(metricPoints.metric, ['composite', 'cost_efficiency'])))
    .groupBy(metricPoints.entity, metricPoints.metric)
    .all();
  const out = new Map<string, RadarScore>();
  for (const r of rows) {
    const key = normalizeModelKey(r.entity);
    if (key === '') continue;
    const cur = out.get(key) ?? { composite: 0, costEfficiency: null };
    if (r.metric === 'composite') cur.composite = r.value;
    else cur.costEfficiency = r.value;
    out.set(key, cur);
  }
  return out;
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
function _aaMedia(limit = 10): { fetchedAt: string; arenas: Partial<Record<MediaKey, MediaModel[]>> } | null {
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
  /** items that made it into a story (storyId set) in the last 7 days — the yield */
  used7d: number;
}

/** Item volume per source: daily counts for sparklines + 7-day totals + story yield. */
function _sourceVolume(days = 14): SourceVolumeRow[] {
  const db = getDb();
  const start = new Date(Date.now() - days * DAY_MS);
  const rows = db
    .select({ fetchedAt: items.fetchedAt, name: sourcesTable.name, used: items.storyId })
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
  const usedBySource = new Map<string, number>();
  const weekAgo = utcDay(new Date(Date.now() - 6 * DAY_MS));
  for (const row of rows) {
    const i = index.get(utcDay(row.fetchedAt));
    if (i === undefined) continue;
    const daily = bySource.get(row.name) ?? new Array<number>(days).fill(0);
    daily[i] += 1;
    bySource.set(row.name, daily);
    if (row.used !== null && utcDay(row.fetchedAt) >= weekAgo) {
      usedBySource.set(row.name, (usedBySource.get(row.name) ?? 0) + 1);
    }
  }
  return [...bySource.entries()]
    .map(([name, daily]) => ({
      name,
      daily,
      total7d: daily.slice(-7).reduce((a, b) => a + b, 0),
      used7d: usedBySource.get(name) ?? 0,
    }))
    .sort((a, b) => b.total7d - a.total7d);
}

export interface JobRunCell {
  status: 'ok' | 'error' | 'running';
  startedAt: Date;
  durationMs: number | null;
}

// known pipeline jobs in display order — anything else with recorded runs
// (rescore, second-look, gate-audit, CLI-only jobs…) follows alphabetically,
// so the timeline can never silently drop a scheduled job again
const KNOWN_JOBS: readonly JobName[] = [
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
  'agent-plans',
  'agent-stacks',
];

/** Recent runs per job for the health timeline (oldest → newest), for every job present in job_runs. */
function _jobHistory(perJob = 28): Record<string, JobRunCell[]> {
  // one descending pass, sliced per job in JS — the old shape ran a separate
  // LIMIT query for each of the ~20 job names on every admin render
  const rows = getDb()
    .select({
      job: jobRuns.job,
      status: jobRuns.status,
      startedAt: jobRuns.startedAt,
      finishedAt: jobRuns.finishedAt,
    })
    .from(jobRuns)
    .orderBy(desc(jobRuns.id))
    .all();

  const recent = new Map<string, JobRunCell[]>();
  for (const r of rows) {
    const bucket = recent.get(r.job) ?? [];
    if (bucket.length >= perJob) continue;
    bucket.push({
      // a 'running' row past the reap threshold means the process died
      // mid-run — present it as failed, not as still running
      status: r.status === 'running' && r.startedAt.getTime() < Date.now() - RUNNING_FRESH_MS ? 'error' : r.status,
      startedAt: r.startedAt,
      durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
    });
    recent.set(r.job, bucket);
  }

  const known = new Set<string>(KNOWN_JOBS);
  const present = [...recent.keys()];
  const jobs = [
    ...KNOWN_JOBS.filter((j) => recent.has(j)),
    ...present.filter((j) => !known.has(j)).sort(),
  ];
  const out: Record<string, JobRunCell[]> = {};
  for (const job of jobs) out[job] = recent.get(job)!.reverse();
  return out;
}

/** Daily LLM call counts (zero-filled) plus the configured cap. */
function _llmUsageHistory(days = 14): { days: { date: string; calls: number }[]; cap: number } {
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

export interface JobUsage {
  job: string;
  runs: number;
  calls: number;
  tokens: number;
}

/** Today's LLM usage per job, summed from job_runs stats (calls/promptTokens/completionTokens). */
export function llmUsageTodayByJob(): JobUsage[] {
  const db = getDb();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const rows = db
    .select({ job: jobRuns.job, stats: jobRuns.stats })
    .from(jobRuns)
    .where(gte(jobRuns.startedAt, dayStart))
    .all();
  const byJob = new Map<string, JobUsage>();
  for (const row of rows) {
    const acc = byJob.get(row.job) ?? { job: row.job, runs: 0, calls: 0, tokens: 0 };
    acc.runs += 1;
    if (row.stats) {
      try {
        const s = JSON.parse(row.stats) as { calls?: number; promptTokens?: number; completionTokens?: number };
        acc.calls += Number(s.calls) || 0;
        acc.tokens += (Number(s.promptTokens) || 0) + (Number(s.completionTokens) || 0);
      } catch {
        /* malformed stats JSON — skip */
      }
    }
    byJob.set(row.job, acc);
  }
  return [...byJob.values()].sort((a, b) => b.calls - a.calls);
}

export interface Funnel {
  items: number;
  stories: number;
  curated: number;
  topSignals: number;
}

/** 7-day pipeline conversion: fetched items → stories → curated → top signals. */
function _pipelineFunnel(days = 7): Funnel {
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
    topSignals: curated.filter((s) => s.topScore >= TOP_SIGNAL_MIN).length,
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
function _latestPatterns(limit = 6): PatternRow[] {
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
  sector: Domain | null;
  children: TopicNode[];
}

/** Latest clustering run as a macro→subtopic tree (largest first at each level). */
function _topicHierarchy(): TopicNode[] | null {
  const db = getDb();
  const rows = db.select().from(topicClusters).all();
  if (rows.length === 0) return null;

  const toNode = (r: (typeof rows)[number]): TopicNode => ({
    id: r.id,
    label: r.label,
    summary: r.summary,
    size: r.size,
    heat: r.heat,
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

/** Day (YYYY-MM-DD UTC) of the latest clustering run — the topic map's as-of date. */
function _topicHierarchyAsOf(): string | null {
  const db = getDb();
  const latest = db
    .select({ date: topicClusters.date })
    .from(topicClusters)
    .orderBy(desc(topicClusters.date))
    .limit(1)
    .get();
  return latest?.date ?? null;
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

export interface FactoryFunnel {
  openings: number;
  briefed: number;
  stacksReady: number;
  launches7d: number;
  comps: number;
}

/** The factory path in numbers: detected → briefed → stack-ready → launch waves → evergreen comps. */
function _factoryFunnel(): FactoryFunnel {
  const db = getDb();
  const active = db
    .select({ brief: opportunitiesTable.brief })
    .from(opportunitiesTable)
    .where(eq(opportunitiesTable.status, 'active'))
    .all();
  return {
    openings: active.length,
    briefed: active.filter((o) => o.brief !== null).length,
    stacksReady: db.select({ c: count() }).from(stacksTable).get()?.c ?? 0,
    launches7d:
      db
        .select({ c: count() })
        .from(launchesTable)
        .where(gte(launchesTable.launchedAt, new Date(Date.now() - 7 * DAY_MS)))
        .get()?.c ?? 0,
    comps: db.select({ c: count() }).from(compsTable).get()?.c ?? 0,
  };
}

/** Latest analyst notes (written by the daily brief job). */
function _latestInsights(): { date: string; items: Insight[] } | null {
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

/*
 * Memoized surface. These are all read rollups over tables the worker owns, so
 * a short in-process TTL turns a page render from dozens of scans into a map
 * lookup without ever showing a user their own stale write.
 */

export const dailyDomainCounts = memo('dailyDomainCounts', TTL.short, _dailyDomainCounts);
export const domainMomentum = memo('domainMomentum', TTL.short, _domainMomentum);
export const entityDailySeries = memo('entityDailySeries', TTL.short, _entityDailySeries);
export const topEntities = memo('topEntities', TTL.short, _topEntities);
export const echoStats = memo('echoStats', TTL.short, _echoStats);
export const latestPatterns = memo('latestPatterns', TTL.short, _latestPatterns);
export const latestInsights = memo('latestInsights', TTL.short, _latestInsights);
export const jobHistory = memo('jobHistory', TTL.short, _jobHistory);

export const aaSnapshotModels = memo('aaSnapshotModels', TTL.long, _aaSnapshotModels);
export const marketModels = memo('marketModels', TTL.long, _marketModels);
export const aaModels = memo('aaModels', TTL.long, _aaModels);
export const latestRadarScores = memo('latestRadarScores', TTL.long, _latestRadarScores);
export const aaMedia = memo('aaMedia', TTL.long, _aaMedia);
export const sourceVolume = memo('sourceVolume', TTL.long, _sourceVolume);
export const llmUsageHistory = memo('llmUsageHistory', TTL.long, _llmUsageHistory);
export const pipelineFunnel = memo('pipelineFunnel', TTL.long, _pipelineFunnel);
export const topicHierarchy = memo('topicHierarchy', TTL.long, _topicHierarchy);
export const topicHierarchyAsOf = memo('topicHierarchyAsOf', TTL.long, _topicHierarchyAsOf);
export const factoryFunnel = memo('factoryFunnel', TTL.long, _factoryFunnel);
