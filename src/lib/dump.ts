import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { asc, notLike } from 'drizzle-orm';
import { getDb } from './db';
import { metricPoints } from './db/schema';
import { config } from './config';

export const DATASET_FILENAME = 'dataset.jsonl.gz';

/** The public dump lives next to the database file. */
export function datasetPath(): string {
  return path.join(path.dirname(path.resolve(config.databasePath)), DATASET_FILENAME);
}

/**
 * Daily public dataset dump ("databook"): every first-party metric_points
 * row as JSONL `{source,entity,metric,date,value}`, gzipped, written next to
 * the DB. AA-sourced series are excluded unless AA_PUBLIC — republication
 * requires a redistribution agreement (see config.aaPublic). Idempotent:
 * full rewrite via tmp + rename, safe to re-run.
 */
export async function runDatasetDump(): Promise<{ series: number; points: number; bytes: number }> {
  const db = getDb();
  const rows = db
    .select({
      source: metricPoints.source,
      entity: metricPoints.entity,
      metric: metricPoints.metric,
      date: metricPoints.date,
      value: metricPoints.value,
    })
    .from(metricPoints)
    .where(config.aaPublic ? undefined : notLike(metricPoints.source, 'aa%'))
    .orderBy(asc(metricPoints.source), asc(metricPoints.entity), asc(metricPoints.metric), asc(metricPoints.date))
    .all();

  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
  const gz = zlib.gzipSync(Buffer.from(jsonl, 'utf8'));

  const file = datasetPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, gz);
  fs.renameSync(tmp, file);

  const keys = new Set(rows.map((r) => `${r.source}${r.entity}${r.metric}`));
  return { series: keys.size, points: rows.length, bytes: gz.length };
}
