import { config } from './config';
import { getDb } from './db';
import { benchmarkSnapshots } from './db/schema';
import {
  AA_MEDIA_ENDPOINTS,
  AA_URL,
  compactAaMediaSnapshot,
  compactAaSnapshot,
  fetchAaAll,
  isCompactSnapshot,
} from './board/sync';
import { fetchText } from './ingest/adapters/shared';
import { recordMetrics, type MetricInput } from './metrics';
import { recordForecast } from './science/accuracy';

/** Flattens a compact AA LLM snapshot into daily metric points. Exported for tests. */
export function metricsFromAaCompact(compactRaw: string): MetricInput[] {
  try {
    const parsed = JSON.parse(compactRaw) as { compact?: boolean; models?: unknown };
    if (!parsed.compact || !Array.isArray(parsed.models)) return [];
    const out: MetricInput[] = [];
    for (const m of parsed.models as Record<string, unknown>[]) {
      if (typeof m.name !== 'string') continue;
      const entity = m.name;
      for (const [key, metric] of [
        ['price', 'price_blended'],
        ['intelligence', 'intelligence'],
        ['coding', 'coding'],
        ['speed', 'speed'],
      ] as const) {
        if (typeof m[key] === 'number') {
          out.push({ source: 'aa', entity, metric, value: m[key] as number });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Flattens a compact media snapshot (ELO leaderboard) into daily metric points. */
export function metricsFromMediaCompact(source: string, compactRaw: string): MetricInput[] {
  try {
    const parsed = JSON.parse(compactRaw) as { compact?: boolean; models?: unknown };
    if (!parsed.compact || !Array.isArray(parsed.models)) return [];
    const out: MetricInput[] = [];
    for (const m of parsed.models as Record<string, unknown>[]) {
      if (typeof m.name !== 'string' || typeof m.elo !== 'number') continue;
      out.push({ source, entity: m.name, metric: 'elo', value: m.elo });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Daily snapshot job: pulls the AA LLM + media leaderboards, stores compact
 * snapshots (same store the board and charts read) and accumulates the
 * per-model time series that forecasting rides on.
 *
 * Throws when EVERY source fails, so job_runs records an error. It used to
 * swallow each failure and report "ok" with 0/0 — which hid the 2026-11-04
 * retirement of AA's legacy endpoints for 17 days. A partial failure still
 * succeeds and names the failed sources in `failed`.
 */
export async function runSnapshot(): Promise<{
  snapshots: number;
  points: number;
  forecastRecorded?: boolean;
  failed?: string[];
}> {
  if (!config.aaApiKey) {
    console.warn('[snapshot] AA_API_KEY not set — nothing to snapshot');
    return { snapshots: 0, points: 0 };
  }
  const db = getDb();
  let snapshots = 0;
  let points = 0;
  const failed: string[] = [];
  const errors: string[] = [];
  const get = (url: string) => fetchText(url, { headers: { 'x-api-key': config.aaApiKey } });

  try {
    const compact = compactAaSnapshot(await fetchAaAll(AA_URL, get));
    // never store a raw fallback slice — a junk "latest" snapshot would blank the board charts
    if (!isCompactSnapshot(compact)) throw new Error('AA response was not parseable model data');
    db.insert(benchmarkSnapshots)
      .values({ source: 'artificial-analysis', raw: compact, fetchedAt: new Date() })
      .run();
    snapshots++;
    points += recordMetrics(metricsFromAaCompact(compact));
  } catch (e) {
    console.error('[snapshot] AA llms fetch failed:', e);
    failed.push('artificial-analysis');
    errors.push(`artificial-analysis: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const ep of AA_MEDIA_ENDPOINTS) {
    try {
      const compact = compactAaMediaSnapshot(await fetchAaAll(ep.url, get));
      if (!isCompactSnapshot(compact)) throw new Error('media response was not parseable leaderboard data');
      db.insert(benchmarkSnapshots)
        .values({ source: ep.source, raw: compact, fetchedAt: new Date() })
        .run();
      snapshots++;
      points += recordMetrics(metricsFromMediaCompact(ep.source, compact));
    } catch (e) {
      console.error(`[snapshot] ${ep.source} fetch failed:`, e);
      failed.push(ep.source);
      errors.push(`${ep.source}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Forecast AFTER today's AA points land (it used to ride the 08:00 rescore
  // tick, decoupled from whether any new data had arrived). recordForecast
  // refuses a stale fit, and a failed AA fetch above leaves the data stale.
  let forecast: Awaited<ReturnType<typeof recordForecast>>;
  try {
    forecast = recordForecast();
    if (!forecast.recorded) console.warn(`[snapshot] forecast not recorded: ${forecast.reason}`);
  } catch (e) {
    console.error('[snapshot] forecast record failed:', e);
    forecast = { recorded: false };
  }

  if (snapshots === 0) {
    throw new Error(`every Artificial Analysis fetch failed — ${errors.join('; ')}`);
  }
  return { snapshots, points, forecastRecorded: forecast.recorded, ...(failed.length ? { failed } : {}) };
}
