import { cache } from 'react';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { metricPoints } from '../db/schema';
import { linearFit, type Fit } from './math';

export interface SeriesPoint {
  date: string;
  value: number;
}

const FRONTIER_FRACTION = 0.9; // "frontier" = within 90% of the day's max intelligence

/**
 * Latest date present in the AA metric series — the anchor for the trailing
 * window and the "data as of" disclosure. Anchoring at Date.now() instead
 * truncated the tail whenever AA ingestion went stale: the forecast then fit
 * old data as if it were current.
 */
export const frontierDataAsOf = cache(function frontierDataAsOf(): string | null {
  const db = getDb();
  const row = db
    .select({ latest: sql<string | null>`max(${metricPoints.date})` })
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'aa'), inArray(metricPoints.metric, ['price_blended', 'intelligence'])))
    .get();
  return row?.latest ?? null;
});

/**
 * Price of frontier intelligence per snapshot day: the cheapest blended price
 * among models at ≥90% of that day's intelligence ceiling.
 * Memoized per request — /trust derives several blocks from the same series.
 */
export const frontierPriceSeries = cache(function frontierPriceSeries(days = 120): SeriesPoint[] {
  const db = getDb();
  // Bounded read: only the window the trailing series can draw from — the old
  // version loaded the entire aa metric history on every /trust render and
  // sliced in JS. The window is anchored at the latest DATA date (not
  // Date.now()) so stale ingestion can't truncate the tail; the +30d slack
  // keeps the series full when snapshots skip days.
  const asOf = frontierDataAsOf();
  if (asOf === null) return [];
  const windowStart = new Date(Date.parse(`${asOf}T00:00:00Z`) - (days + 30) * 864e5)
    .toISOString()
    .slice(0, 10);
  const rows = db
    .select()
    .from(metricPoints)
    .where(
      and(
        eq(metricPoints.source, 'aa'),
        inArray(metricPoints.metric, ['price_blended', 'intelligence']),
        gte(metricPoints.date, windowStart),
      ),
    )
    .all();

  const byDate = new Map<string, Map<string, { price?: number; intelligence?: number }>>();
  for (const r of rows) {
    const models = byDate.get(r.date) ?? new Map();
    const m = models.get(r.entity) ?? {};
    if (r.metric === 'price_blended') m.price = r.value;
    else m.intelligence = r.value;
    models.set(r.entity, m);
    byDate.set(r.date, models);
  }

  const out: SeriesPoint[] = [];
  for (const [date, models] of byDate) {
    let maxIntel = 0;
    for (const m of models.values()) {
      if (m.intelligence !== undefined) maxIntel = Math.max(maxIntel, m.intelligence);
    }
    if (maxIntel === 0) continue;
    let cheapest = Infinity;
    for (const m of models.values()) {
      if (
        m.intelligence !== undefined &&
        m.price !== undefined &&
        m.price > 0 &&
        m.intelligence >= maxIntel * FRONTIER_FRACTION
      ) {
        cheapest = Math.min(cheapest, m.price);
      }
    }
    if (Number.isFinite(cheapest)) out.push({ date, value: cheapest });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(-days);
});

export interface Forecast {
  history: SeriesPoint[];
  /** empty until enough history has accrued */
  projection: { date: string; mid: number; lo: number; hi: number }[];
  fit: Fit | null;
  /** Distinct days actually used in the fit (positive values only). */
  daysOfHistory: number;
  /** History points dropped from the fit because value ≤ 0 (the fit is in log space). */
  droppedFromFit: number;
  /** Latest date in the underlying data — disclose it; stale ingestion otherwise reads as current. */
  asOf: string | null;
}

const MIN_FIT_DAYS = 5;

/** Exported for tests: log-linear fit + band over a series, projected forward. */
export function projectSeries(history: SeriesPoint[], horizonDays: number): Forecast {
  // the fit runs in log space, so value ≤ 0 points are unusable — count only
  // the days that actually feed the fit and report how many were dropped
  // (the old daysOfHistory counted them toward the 5-day minimum and let a
  // 3-point fit sail through as "5 days of history")
  const eligible = history.filter((p) => p.value > 0);
  const droppedFromFit = history.length - eligible.length;
  const daysOfHistory = new Set(eligible.map((p) => p.date)).size;
  const asOf = history.reduce((max, p) => (p.date > max ? p.date : max), '') || null;
  if (daysOfHistory < MIN_FIT_DAYS) {
    return { history, projection: [], fit: null, daysOfHistory, droppedFromFit, asOf };
  }
  const t0 = Date.parse(eligible[0].date);
  const pts = eligible.map((p) => ({ x: (Date.parse(p.date) - t0) / 864e5, y: Math.log10(p.value) }));
  const fit = linearFit(pts);
  if (!fit) return { history, projection: [], fit: null, daysOfHistory, droppedFromFit, asOf };

  const lastX = pts[pts.length - 1].x;
  const band = Math.max(fit.residualStd, 0.02); // never draw a zero-width band
  const projection = [];
  for (let d = 0; d <= horizonDays; d += Math.max(1, Math.round(horizonDays / 30))) {
    const x = lastX + d;
    const mid = fit.slope * x + fit.intercept;
    // heuristic ±1σ in log space, widened with distance from the data —
    // NOT a statistical confidence interval
    const spread = band * (1 + d / Math.max(7, lastX + 1));
    projection.push({
      date: new Date(t0 + x * 864e5).toISOString().slice(0, 10),
      mid: 10 ** mid,
      lo: 10 ** (mid - spread),
      hi: 10 ** (mid + spread),
    });
  }
  return { history, projection, fit, daysOfHistory, droppedFromFit, asOf };
}

/** The headline forecast: where the price of frontier intelligence is heading. */
export function forecastFrontierPrice(horizonDays = 30): Forecast {
  const forecast = projectSeries(frontierPriceSeries(), horizonDays);
  return { ...forecast, asOf: frontierDataAsOf() };
}
