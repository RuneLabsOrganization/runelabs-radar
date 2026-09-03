import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { getDb, type Db } from './db';
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
  upsertOne(getDb(), p);
}

function upsertOne(db: Pick<Db, 'insert'>, p: MetricInput): void {
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
  // one WAL commit for the whole batch — a job run records hundreds of points
  getDb().transaction((tx) => {
    for (const p of points) {
      if (!Number.isFinite(p.value)) continue;
      upsertOne(tx, p);
      n++;
    }
  });
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

export type SeriesRow = { date: string; value: number };

/**
 * Series for many entity/metric pairs in one query, keyed `entity\u0000metric`.
 * Charts that plot every model would otherwise issue one query per model per
 * metric — 120+ round-trips to draw a single scatter.
 */
export function seriesForMany(
  source: string,
  entities: string[],
  metrics: string[],
  days = 90,
): Map<string, SeriesRow[]> {
  const out = new Map<string, SeriesRow[]>();
  if (entities.length === 0 || metrics.length === 0) return out;
  const start = utcDay(new Date(Date.now() - days * 864e5));
  const rows = getDb()
    .select({
      entity: metricPoints.entity,
      metric: metricPoints.metric,
      date: metricPoints.date,
      value: metricPoints.value,
    })
    .from(metricPoints)
    .where(
      and(
        eq(metricPoints.source, source),
        inArray(metricPoints.entity, entities),
        inArray(metricPoints.metric, metrics),
        gte(metricPoints.date, start),
      ),
    )
    .orderBy(asc(metricPoints.date))
    .all();
  for (const r of rows) {
    const key = `${r.entity}\u0000${r.metric}`;
    const bucket = out.get(key);
    if (bucket) bucket.push({ date: r.date, value: r.value });
    else out.set(key, [{ date: r.date, value: r.value }]);
  }
  return out;
}
