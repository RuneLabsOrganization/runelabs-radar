import { and, asc, eq, gte } from 'drizzle-orm';
import { getDb } from './db';
import { metricPoints } from './db/schema';

export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface MetricInput {
  source: string;
  entity: string;
  metric: string;
  value: number;
  date?: string; // defaults to today (UTC)
}

/** Idempotent daily write: re-running a job the same day updates in place. */
export function upsertMetric(p: MetricInput): void {
  const db = getDb();
  db.insert(metricPoints)
    .values({
      source: p.source,
      entity: p.entity,
      metric: p.metric,
      value: p.value,
      date: p.date ?? utcDay(),
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [metricPoints.source, metricPoints.entity, metricPoints.metric, metricPoints.date],
      set: { value: p.value },
    })
    .run();
}

export function recordMetrics(points: MetricInput[]): number {
  let n = 0;
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue;
    upsertMetric(p);
    n++;
  }
  return n;
}

/** Time series for one (source, entity, metric), oldest first. */
export function seriesFor(
  source: string,
  entity: string,
  metric: string,
  days = 90,
): { date: string; value: number }[] {
  const db = getDb();
  const start = utcDay(new Date(Date.now() - days * 864e5));
  return db
    .select({ date: metricPoints.date, value: metricPoints.value })
    .from(metricPoints)
    .where(
      and(
        eq(metricPoints.source, source),
        eq(metricPoints.entity, entity),
        eq(metricPoints.metric, metric),
        gte(metricPoints.date, start),
      ),
    )
    .orderBy(asc(metricPoints.date))
    .all();
}
