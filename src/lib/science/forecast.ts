import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { metricPoints } from '../db/schema';
import { linearFit, type Fit } from './math';

export interface SeriesPoint {
  date: string;
  value: number;
}

const FRONTIER_FRACTION = 0.9; // "frontier" = within 90% of the day's max intelligence

/**
 * Price of frontier intelligence per snapshot day: the cheapest blended price
 * among models at ≥90% of that day's intelligence ceiling.
 */
export function frontierPriceSeries(days = 120): SeriesPoint[] {
  const db = getDb();
  const rows = db
    .select()
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'aa'), inArray(metricPoints.metric, ['price_blended', 'intelligence'])))
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
}

export interface Forecast {
  history: SeriesPoint[];
  /** empty until enough history has accrued */
  projection: { date: string; mid: number; lo: number; hi: number }[];
  fit: Fit | null;
  daysOfHistory: number;
}

const MIN_FIT_DAYS = 5;

/** Exported for tests: log-linear fit + band over a series, projected forward. */
export function projectSeries(history: SeriesPoint[], horizonDays: number): Forecast {
  const daysOfHistory = new Set(history.map((p) => p.date)).size;
  if (daysOfHistory < MIN_FIT_DAYS) {
    return { history, projection: [], fit: null, daysOfHistory };
  }
  const t0 = Date.parse(history[0].date);
  const pts = history
    .filter((p) => p.value > 0)
    .map((p) => ({ x: (Date.parse(p.date) - t0) / 864e5, y: Math.log10(p.value) }));
  const fit = linearFit(pts);
  if (!fit) return { history, projection: [], fit: null, daysOfHistory };

  const lastX = pts[pts.length - 1].x;
  const band = Math.max(fit.residualStd, 0.02); // never draw a zero-width band
  const projection = [];
  for (let d = 0; d <= horizonDays; d += Math.max(1, Math.round(horizonDays / 30))) {
    const x = lastX + d;
    const mid = fit.slope * x + fit.intercept;
    // uncertainty grows with distance from the data
    const spread = band * (1 + d / Math.max(7, lastX + 1));
    projection.push({
      date: new Date(t0 + x * 864e5).toISOString().slice(0, 10),
      mid: 10 ** mid,
      lo: 10 ** (mid - spread),
      hi: 10 ** (mid + spread),
    });
  }
  return { history, projection, fit, daysOfHistory };
}

/** The headline forecast: where the price of frontier intelligence is heading. */
export function forecastFrontierPrice(horizonDays = 30): Forecast {
  return projectSeries(frontierPriceSeries(), horizonDays);
}
