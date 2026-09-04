import { and, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { getDb } from '../db';
import { forecasts, stories } from '../db/schema';
import { forecastFrontierPrice, frontierPriceSeries } from './forecast';
import { utcDay } from '../metrics';
import { median } from '../stats';
import { RESCORE_MIN_AGE_MS, RESCORE_MAX_AGE_MS } from './hindsight';

export interface CalibrationBucket {
  label: string;
  count: number;
  meanScore: number;
  meanHindsight: number | null;
  medianHindsight: number | null;
  /** % of the band with hindsight > 0 — "did anything follow at all". */
  followThroughRate: number;
  /** Curated stories in the band old enough to have been graded (≥36h). */
  eligible: number;
  /**
   * graded / eligible, %. Null when nothing is eligible. Below ~90 the band's
   * stats are survivors — stories that missed the rescore window vanish from
   * the bands rather than counting, which flatters calibration — and the
   * trust page marks the band accordingly.
   */
  coveragePct: number | null;
}

/** Display-level integer median (hindsight points are integers; float median lives in stats). */
function medianInt(values: number[]): number | null {
  const m = median(values);
  return m === null ? null : Math.round(m);
}

/** Average ranks (1-based); tied values share the mean of their positions. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!.i] = rank;
    i = j + 1;
  }
  return out;
}

/**
 * Spearman rank correlation — the precise single number for "does a higher
 * score mean it mattered". Robust to the zero-inflated hindsight distribution
 * (ties get average ranks). Null when n<2 or one side is constant.
 */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = rx.length;
  const mx = rx.reduce((a, v) => a + v, 0) / n;
  const my = ry.reduce((a, v) => a + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * Score calibration: do higher top_scores actually turn into higher
 * hindsight? Bucketed on the feed's own bands (archive <40, scan 40-69,
 * top signal 70+). Median reported alongside mean — small-n skew is real.
 */
export function calibrationBuckets(): CalibrationBucket[] {
  const db = getDb();
  const rows = db
    .select({ topScore: stories.topScore, hindsight: stories.hindsight })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), isNotNull(stories.hindsight)))
    .all();
  // everything that SHOULD have a grade by now — the coverage denominator
  const eligibleRows = db
    .select({ topScore: stories.topScore })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), lte(stories.createdAt, new Date(Date.now() - RESCORE_MIN_AGE_MS))))
    .all();

  const bands: {
    label: string;
    test: (s: number) => boolean;
    scores: number[];
    hindsights: number[];
    eligible: number;
  }[] = [
    { label: '<40', test: (s) => s < 40, scores: [], hindsights: [], eligible: 0 },
    { label: '40–69', test: (s) => s >= 40 && s < 70, scores: [], hindsights: [], eligible: 0 },
    { label: '70–100', test: (s) => s >= 70, scores: [], hindsights: [], eligible: 0 },
  ];
  for (const r of rows) {
    const band = bands.find((b) => b.test(r.topScore))!;
    band.scores.push(r.topScore);
    band.hindsights.push(r.hindsight ?? 0);
  }
  for (const r of eligibleRows) {
    bands.find((b) => b.test(r.topScore))!.eligible += 1;
  }
  return bands.map((b) => ({
    label: b.label,
    count: b.scores.length,
    meanScore: b.scores.length ? Math.round(b.scores.reduce((a, s) => a + s, 0) / b.scores.length) : 0,
    meanHindsight: b.hindsights.length
      ? Math.round(b.hindsights.reduce((a, h) => a + h, 0) / b.hindsights.length)
      : null,
    medianHindsight: medianInt(b.hindsights),
    followThroughRate: b.hindsights.length
      ? Math.round((b.hindsights.filter((h) => h > 0).length / b.hindsights.length) * 100)
      : 0,
    eligible: b.eligible,
    coveragePct: b.eligible === 0 ? null : Math.round((b.scores.length / b.eligible) * 100),
  }));
}

/** Every graded story as a {score, hindsight} point — the scatter behind the bands. */
export function calibrationPoints(): { score: number; hindsight: number }[] {
  const db = getDb();
  return db
    .select({ score: stories.topScore, hindsight: stories.hindsight })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), isNotNull(stories.hindsight)))
    .all()
    .map((r) => ({ score: r.score, hindsight: r.hindsight ?? 0 }));
}

/**
 * Curated stories not yet graded but still inside (or approaching) the 36-60h
 * rescore window — the "pending, not hidden" count. Stories older than 60h
 * without hindsight missed the window; those are the backlog (see
 * rescoreBacklog). Return type stays a bare number because the MCP
 * get_accuracy tool consumes it as one.
 */
export function pendingGrades(): number {
  const db = getDb();
  const rows = db
    .select({ id: stories.id })
    .from(stories)
    .where(
      and(
        eq(stories.status, 'curated'),
        isNull(stories.hindsight),
        gte(stories.createdAt, new Date(Date.now() - RESCORE_MAX_AGE_MS)),
      ),
    )
    .all();
  return rows.length;
}

/**
 * The backlog: curated stories that aged PAST the 60h rescore window still
 * ungraded — missed by the daily cap or by downtime. Published beside
 * pendingGrades so a growing backlog can never hide inside "pending".
 */
export function rescoreBacklog(): number {
  const db = getDb();
  const rows = db
    .select({ id: stories.id })
    .from(stories)
    .where(
      and(
        eq(stories.status, 'curated'),
        isNull(stories.hindsight),
        lte(stories.createdAt, new Date(Date.now() - RESCORE_MAX_AGE_MS)),
      ),
    )
    .all();
  return rows.length;
}

/**
 * Is the calibration monotonic — do higher score bands earn strictly higher
 * mean hindsight? False when inverted (or a band is empty); the page shows
 * this verbatim, with sample size, because publishing the miss IS the point.
 */
export function calibrationMonotonic(buckets: CalibrationBucket[]): boolean {
  const means = buckets.map((b) => b.meanHindsight);
  if (means.some((m) => m === null)) return false;
  for (let i = 1; i < means.length; i++) {
    if (means[i]! < means[i - 1]!) return false;
  }
  return true;
}

export interface AccuracyMiss {
  id: number;
  title: string;
  topScore: number;
  hindsight: number;
}

/** The published misses: high score/low follow-through vs low score/high follow-through. */
export function accuracyMisses(limit = 3): { overRated: AccuracyMiss[]; underRated: AccuracyMiss[] } {
  const db = getDb();
  const graded = db
    .select({
      id: stories.id,
      title: stories.title,
      topScore: stories.topScore,
      hindsight: stories.hindsight,
    })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), isNotNull(stories.hindsight)))
    .all();
  const overRated = graded
    .filter((s) => s.topScore >= 70)
    .sort((a, b) => (a.hindsight ?? 0) - (b.hindsight ?? 0))
    .slice(0, limit) as AccuracyMiss[];
  const underRated = graded
    .filter((s) => s.topScore < 60)
    .sort((a, b) => (b.hindsight ?? 0) - (a.hindsight ?? 0))
    .slice(0, limit) as AccuracyMiss[];
  return { overRated, underRated };
}

/** First day the rescore job wrote hindsight — the "grading since" counter. */
export function gradingSince(): string | null {
  const db = getDb();
  const row = db
    .select({ at: stories.hindsightAt })
    .from(stories)
    .where(isNotNull(stories.hindsightAt))
    .orderBy(stories.hindsightAt)
    .limit(1)
    .get();
  return row?.at ? row.at.toISOString().slice(0, 10) : null;
}

/** Nightly: persist today's frontier-price forecast so future-us can grade it. */
export function recordForecast(): { recorded: boolean } {
  const db = getDb();
  const f = forecastFrontierPrice(30);
  const last = f.projection[f.projection.length - 1];
  if (!last) return { recorded: false }; // not enough history to project yet
  db.insert(forecasts)
    .values({
      date: utcDay(),
      metric: 'frontier_price_30d',
      predicted: last.mid,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
  return { recorded: true };
}

export interface ForecastGrade {
  date: string;
  predicted: number;
  realized: number | null;
  /** The series date the realized value was actually read at — disclosed because it can lag the 30d target. */
  realizedDate: string | null;
  /**
   * Signed log error, %: ln(realized/predicted) · 100. Symmetric — predicting
   * 2× too high and 2× too low score the same magnitude — which the naive
   * percent error on a falling price is not (over-predictions bottom out at
   * −100% while under-predictions are unbounded, flattering the average).
   * Positive means realized came in ABOVE the forecast (we aimed low).
   */
  errorPct: number | null;
}

/**
 * Past forecasts vs what actually happened. Realized = the frontier-tier
 * blended price AT the 30d target (first series point on/after the target
 * date — the actual date is disclosed per grade), computed with the same
 * frontier definition the forecast predicts — not the cheapest price of any
 * model at any later date, which drifted as prices fell. Nulls until the
 * target date passes.
 */
export function forecastGrades(): ForecastGrade[] {
  const db = getDb();
  const rows = db.select().from(forecasts).orderBy(desc(forecasts.date)).limit(60).all();
  const series = frontierPriceSeries();
  return rows.map((r) => {
    const target = new Date(new Date(`${r.date}T00:00:00Z`).getTime() + 30 * 864e5).toISOString().slice(0, 10);
    const point = series.find((p) => p.date >= target);
    const rv = point?.value ?? null;
    return {
      date: r.date,
      predicted: r.predicted,
      realized: rv,
      realizedDate: rv !== null ? point!.date : null,
      errorPct:
        rv !== null && r.predicted > 0 && rv > 0 ? Math.round(Math.log(rv / r.predicted) * 100) : null,
    };
  });
}
