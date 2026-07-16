import { config } from './config';
import { getDb } from './db';
import { benchmarkSnapshots } from './db/schema';
import {
  AA_MEDIA_ENDPOINTS,
  AA_URL,
  compactAaMediaSnapshot,
  compactAaSnapshot,
  isCompactSnapshot,
} from './board/sync';
import { fetchText } from './ingest/adapters/shared';
import { recordMetrics, type MetricInput } from './metrics';

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
 */
export async function runSnapshot(): Promise<{ snapshots: number; points: number }> {
  if (!config.aaApiKey) {
    console.warn('[snapshot] AA_API_KEY not set — nothing to snapshot');
    return { snapshots: 0, points: 0 };
  }
  const db = getDb();
  let snapshots = 0;
  let points = 0;

  try {
    const compact = compactAaSnapshot(
      await fetchText(AA_URL, { headers: { 'x-api-key': config.aaApiKey } }),
    );
    // never store a raw fallback slice — a junk "latest" snapshot would blank the board charts
    if (!isCompactSnapshot(compact)) throw new Error('AA response was not parseable model data');
    db.insert(benchmarkSnapshots)
      .values({ source: 'artificial-analysis', raw: compact, fetchedAt: new Date() })
      .run();
    snapshots++;
    points += recordMetrics(metricsFromAaCompact(compact));
  } catch (e) {
    console.error('[snapshot] AA llms fetch failed:', e);
  }

  for (const ep of AA_MEDIA_ENDPOINTS) {
    try {
      const compact = compactAaMediaSnapshot(
        await fetchText(ep.url, { headers: { 'x-api-key': config.aaApiKey } }),
      );
      if (!isCompactSnapshot(compact)) throw new Error('media response was not parseable leaderboard data');
      db.insert(benchmarkSnapshots)
        .values({ source: ep.source, raw: compact, fetchedAt: new Date() })
        .run();
      snapshots++;
      points += recordMetrics(metricsFromMediaCompact(ep.source, compact));
    } catch (e) {
      console.error(`[snapshot] ${ep.source} fetch failed:`, e);
    }
  }

  return { snapshots, points };
}
