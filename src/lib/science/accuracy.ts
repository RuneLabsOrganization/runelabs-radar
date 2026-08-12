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
}

/**
 * Score calibration: do higher top_scores actually turn into higher
 * hindsight? Bucketed proof for the accuracy page.
 */
export function calibrationBuckets(): CalibrationBucket[] {
  const db = getDb();
  const rows = db
    .select({ topScore: stories.topScore, hindsight: stories.hindsight })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), isNotNull(stories.hindsight)))
    .all();

  const buckets: CalibrationBucket[] = [
    { label: '40–59', count: 0, meanScore: 0, meanHindsight: null },
    { label: '60–79', count: 0, meanScore: 0, meanHindsight: null },
    { label: '80–100', count: 0, meanScore: 0, meanHindsight: null },
  ];
  for (const r of rows) {
    const b = r.topScore >= 80 ? buckets[2] : r.topScore >= 60 ? buckets[1] : buckets[0];
    b.meanScore += r.topScore;
    b.meanHindsight = (b.meanHindsight ?? 0) + (r.hindsight ?? 0);
    b.count++;
  }
  for (const b of buckets) {
    if (b.count > 0) {
      b.meanScore = Math.round(b.meanScore / b.count);
      b.meanHindsight = Math.round((b.meanHindsight ?? 0) / b.count);
    }
  }
  return buckets;
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
