/**
 * Decide Pulse — read-only helpers over metric_points for the curated
 * first-viewport on /app/decide/metrics. No new ingest; first-party by
 * default; AA only when the caller passes showAA=true.
 */
import { and, desc, eq, gte, notLike } from 'drizzle-orm';
import { getDb } from './db';
import { metricPoints, patterns } from './db/schema';
import { LAUNCH_CATEGORIES } from './launches';
import { seriesForMany, utcDay, type SeriesRow } from './metrics';

export interface Mover {
  source: string;
  entity: string;
  metric: string;
  from: number;
  to: number;
  pct: number;
}

export interface MetricKey {
  source: string;
  entity: string;
  metric: string;
}

export interface PulsePreset {
  id: string;
  label: string;
  /** When true, only expose when AA is visible to the viewer. */
  requiresAA?: boolean;
  keys: MetricKey[];
}

export interface PulsePattern {
  kind: string;
  subject: string | null;
  headline: string;
  detail: string;
  score: number;
  date: string;
}

/** Curated GitHub repos for the Coding-agent stars preset (filtered at resolve time). */
export const CODING_AGENT_STAR_REPOS = [
  'anthropics/claude-code',
  'anthropics/claude-plugins-community',
  'NousResearch/hermes-agent',
  'VoltAgent/awesome-agent-skills',
  'agent-substrate/substrate',
] as const;

/** Curated AA entities for the Frontier prices preset (filtered at resolve time). */
export const FRONTIER_PRICE_MODELS = [
  'GPT-5',
  'GPT-5.5',
  'Claude 4 Opus',
  'Claude 4 Sonnet',
  'Gemini 2.5 Pro',
  'o3',
  'o4-mini',
] as const;

/**
 * Biggest first-party series moves over the window: latest in-window value vs
 * the last baseline point before the window. AA-derived series are never
 * eligible (same `notLike source 'aa%'` rule as the public dump).
 */
export function marketMovers(sinceDay: string, limit = 8): Mover[] {
  const db = getDb();
  // 14d lookback so each series has a pre-window baseline point
  const rows = db
    .select({
      source: metricPoints.source,
      entity: metricPoints.entity,
      metric: metricPoints.metric,
      value: metricPoints.value,
      date: metricPoints.date,
    })
    .from(metricPoints)
    .where(and(notLike(metricPoints.source, 'aa%'), gte(metricPoints.date, utcDay(new Date(Date.now() - 14 * 864e5)))))
    .orderBy(metricPoints.date)
    .all();

  const series = new Map<string, { source: string; entity: string; metric: string; pts: { date: string; value: number }[] }>();
  for (const r of rows) {
    const key = `${r.source}\u0001${r.entity}\u0001${r.metric}`;
    const s = series.get(key) ?? { source: r.source, entity: r.entity, metric: r.metric, pts: [] };
    s.pts.push({ date: r.date, value: r.value });
    series.set(key, s);
  }

  const movers: Mover[] = [];
  for (const s of series.values()) {
    const inWindow = s.pts.filter((p) => p.date >= sinceDay);
    if (inWindow.length === 0) continue;
    const before = s.pts.filter((p) => p.date < sinceDay);
    const base = before.length > 0 ? before[before.length - 1]! : inWindow[0]!;
    const last = inWindow[inWindow.length - 1]!;
    if (base.value === 0 || base.date === last.date) continue;
    const pct = ((last.value - base.value) / Math.abs(base.value)) * 100;
    if (Math.abs(pct) < 10) continue; // noise floor — movers only
    movers.push({ source: s.source, entity: s.entity, metric: s.metric, from: base.value, to: last.value, pct });
  }
  return movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, limit);
}

export interface HottestLaunch {
  category: string;
  total: number;
  prevTotal: number;
  pct: number | null;
  series: SeriesRow[];
}

/** Category with the highest launch count over the last `days` (vs prior equal window). */
export function hottestLaunchCategory(days = 7): HottestLaunch | null {
  const cats = [...LAUNCH_CATEGORIES];
  const map = seriesForMany('launches', cats, ['count'], days * 2);
  const since = utcDay(new Date(Date.now() - days * 864e5));
  const prevSince = utcDay(new Date(Date.now() - days * 2 * 864e5));

  let best: HottestLaunch | null = null;
  for (const cat of cats) {
    const pts = map.get(`${cat}\u0000count`) ?? [];
    const recent = pts.filter((p) => p.date >= since);
    const prev = pts.filter((p) => p.date >= prevSince && p.date < since);
    const total = recent.reduce((a, p) => a + p.value, 0);
    const prevTotal = prev.reduce((a, p) => a + p.value, 0);
    if (total === 0) continue;
    if (!best || total > best.total) {
      const pct = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
      best = { category: cat, total, prevTotal, pct, series: recent };
    }
  }
  return best;
}

/**
 * Largest |7d %| move among aa/price_blended. Caller must only invoke when
 * showAA is true.
 */
export function aaPricePressure(limit = 1): Mover | null {
  const sinceDay = utcDay(new Date(Date.now() - 7 * 864e5));
  const db = getDb();
  const rows = db
    .select({
      entity: metricPoints.entity,
      value: metricPoints.value,
      date: metricPoints.date,
    })
    .from(metricPoints)
    .where(
      and(
        eq(metricPoints.source, 'aa'),
        eq(metricPoints.metric, 'price_blended'),
        gte(metricPoints.date, utcDay(new Date(Date.now() - 14 * 864e5))),
      ),
    )
    .orderBy(metricPoints.date)
    .all();

  const byEntity = new Map<string, { date: string; value: number }[]>();
  for (const r of rows) {
    const list = byEntity.get(r.entity) ?? [];
    list.push({ date: r.date, value: r.value });
    byEntity.set(r.entity, list);
  }

  const movers: Mover[] = [];
  for (const [entity, pts] of byEntity) {
    const inWindow = pts.filter((p) => p.date >= sinceDay);
    if (inWindow.length === 0) continue;
    const before = pts.filter((p) => p.date < sinceDay);
    const base = before.length > 0 ? before[before.length - 1]! : inWindow[0]!;
    const last = inWindow[inWindow.length - 1]!;
    if (base.value === 0 || base.date === last.date) continue;
    const pct = ((last.value - base.value) / Math.abs(base.value)) * 100;
    if (Math.abs(pct) < 5) continue;
    movers.push({ source: 'aa', entity, metric: 'price_blended', from: base.value, to: last.value, pct });
  }
  movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return movers.slice(0, limit)[0] ?? null;
}

const WATCHLIST_SOURCES = new Set(['github', 'npm', 'provider-pricing']);

/** Top movers preferring adoption/price sources; skips launches (covered by launch tile). */
export function risingWatchlist(limit = 5): Mover[] {
  const sinceDay = utcDay(new Date(Date.now() - 7 * 864e5));
  const all = marketMovers(sinceDay, 24);
  const preferred = all.filter((m) => WATCHLIST_SOURCES.has(m.source));
  const pool = preferred.length > 0 ? preferred : all.filter((m) => m.source !== 'launches');
  return pool.slice(0, limit);
}

/** First-party anomaly nibble; skips price-drop unless showAA. */
export function pulseAnomaly(showAA: boolean): PulsePattern | null {
  const db = getDb();
  const latest = db.select({ date: patterns.date }).from(patterns).orderBy(desc(patterns.date)).limit(1).get();
  if (!latest) return null;
  const pats = db
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
    .limit(8)
    .all();

  const allowed = pats.filter((p) => {
    if (p.kind === 'price-drop') return showAA;
    return p.kind === 'launch-spike' || p.kind === 'sector-spike' || p.kind === 'entity-surge' || p.kind === 'cluster-heat';
  });
  const ranked = [...allowed].sort((a, b) => {
    const rank = (k: string) => (k === 'launch-spike' ? 0 : k === 'sector-spike' ? 1 : 2);
    const d = rank(a.kind) - rank(b.kind);
    return d !== 0 ? d : b.score - a.score;
  });
  return ranked[0] ?? null;
}

/** Launch-heat series for the hero chart (all categories, 90d). */
export function launchHeatSeries(days = 90): { source: string; entity: string; metric: string; points: SeriesRow[] }[] {
  const cats = [...LAUNCH_CATEGORIES];
  const map = seriesForMany('launches', cats, ['count'], days);
  return cats
    .map((cat) => ({
      source: 'launches',
      entity: cat,
      metric: 'count',
      points: map.get(`${cat}\u0000count`) ?? [],
    }))
    .filter((s) => s.points.length > 0);
}

function existingKeys(source: string, entities: string[], metric: string): MetricKey[] {
  if (entities.length === 0) return [];
  const db = getDb();
  const found = new Set(
    db
      .select({ entity: metricPoints.entity })
      .from(metricPoints)
      .where(and(eq(metricPoints.source, source), eq(metricPoints.metric, metric)))
      .all()
      .map((r) => r.entity),
  );
  return entities.filter((e) => found.has(e)).map((entity) => ({ source, entity, metric }));
}

/**
 * Named explorer presets. Coding-agent / Frontier lists are filtered to keys
 * that exist in the store so chips never navigate to empty overlays.
 */
export function resolvePulsePresets(showAA: boolean): PulsePreset[] {
  const launchKeys: MetricKey[] = LAUNCH_CATEGORIES.map((entity) => ({
    source: 'launches',
    entity,
    metric: 'count',
  }));
  const starKeys = existingKeys('github', [...CODING_AGENT_STAR_REPOS], 'stars');
  const priceKeys = showAA ? existingKeys('aa', [...FRONTIER_PRICE_MODELS], 'price_blended') : [];

  const out: PulsePreset[] = [{ id: 'launch-heat', label: 'Launch heat', keys: launchKeys }];
  if (starKeys.length > 0) {
    out.push({ id: 'coding-agent-stars', label: 'Coding-agent stars', keys: starKeys });
  }
  if (priceKeys.length > 0) {
    out.push({ id: 'frontier-prices', label: 'Frontier prices', requiresAA: true, keys: priceKeys });
  }
  return out;
}
