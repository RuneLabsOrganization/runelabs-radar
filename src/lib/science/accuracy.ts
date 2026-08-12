import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { forecasts, metricPoints, stories } from '../db/schema';
import { forecastFrontierPrice } from './forecast';
import { utcDay } from '../metrics';

export interface CalibrationBucket {
  label: string;
  count: number;
  meanScore: number;
  meanHindsight: number | null;
  medianHindsight: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
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

  const bands: { label: string; test: (s: number) => boolean; scores: number[]; hindsights: number[] }[] = [
    { label: '<40', test: (s) => s < 40, scores: [], hindsights: [] },
    { label: '40–69', test: (s) => s >= 40 && s < 70, scores: [], hindsights: [] },
    { label: '70–100', test: (s) => s >= 70, scores: [], hindsights: [] },
  ];
  for (const r of rows) {
    const band = bands.find((b) => b.test(r.topScore))!;
    band.scores.push(r.topScore);
    band.hindsights.push(r.hindsight ?? 0);
  }
  return bands.map((b) => ({
    label: b.label,
    count: b.scores.length,
    meanScore: b.scores.length ? Math.round(b.scores.reduce((a, s) => a + s, 0) / b.scores.length) : 0,
    meanHindsight: b.hindsights.length
      ? Math.round(b.hindsights.reduce((a, h) => a + h, 0) / b.hindsights.length)
      : null,
    medianHindsight: median(b.hindsights),
  }));
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
  errorPct: number | null;
}

/**
 * Past forecasts vs what actually happened (realized = cheapest frontier-tier
 * price in metric_points at date+horizon). Nulls until enough time passes.
 */
export function forecastGrades(): ForecastGrade[] {
  const db = getDb();
  const rows = db.select().from(forecasts).orderBy(desc(forecasts.date)).limit(60).all();
  return rows.map((r) => {
    const targetDate = new Date(new Date(`${r.date}T00:00:00Z`).getTime() + 30 * 864e5);
    const realized = db
      .select({ value: sql<number>`min(${metricPoints.value})` })
      .from(metricPoints)
      .where(
        and(
          eq(metricPoints.source, 'aa'),
          eq(metricPoints.metric, 'price_blended'),
          sql`date(${metricPoints.date}) >= date(${targetDate.toISOString().slice(0, 10)})`,
        ),
      )
      .limit(1)
      .get();
    const rv = realized?.value ?? null;
    return {
      date: r.date,
      predicted: r.predicted,
      realized: rv,
      errorPct: rv !== null && r.predicted > 0 ? Math.round(((rv - r.predicted) / r.predicted) * 100) : null,
    };
  });
}
