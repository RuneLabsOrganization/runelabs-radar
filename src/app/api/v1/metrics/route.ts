import { and, desc, eq, notLike, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { metricPoints } from '@/lib/db/schema';
import { seriesFor } from '@/lib/metrics';
import { config } from '@/lib/config';
import { rateLimited } from '@/lib/api-limit';

/**
 * Public read-only API v1 (Phase 10): the metrics store — the same queries
 * behind the MCP list_metrics / get_metric_series tools. With `source`,
 * `entity` and `metric` params it returns one series; without them it
 * enumerates the available keys. FIRST-PARTY ONLY: aa*-sourced series are
 * rejected (explicit) and hidden (enumeration) unless AA_PUBLIC=true —
 * republication requires a redistribution agreement (same gate as
 * src/lib/dump.ts and get_market_models' marketVisible check).
 */

const CACHE = 'public, s-maxage=60, stale-while-revalidate=300';

function clampInt(raw: string | null, dflt: number, min: number, max: number): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.floor(n), min), max);
}

export async function GET(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const params = new URL(req.url).searchParams;
  const source = params.get('source');
  const entity = params.get('entity');
  const metric = params.get('metric');

  if (!config.aaPublic && source !== null && source.startsWith('aa')) {
    return NextResponse.json(
      { error: `source '${source}' is not available on the public API` },
      { status: 403 },
    );
  }
  if ((entity !== null || metric !== null) && !(source && entity && metric)) {
    return NextResponse.json({ error: 'source, entity and metric are required together' }, { status: 400 });
  }

  const db = getDb();
  if (source && entity && metric) {
    const days = clampInt(params.get('days'), 90, 1, 365);
    const points = seriesFor(source, entity, metric, days);
    const first = points[0]?.value;
    const last = points[points.length - 1]?.value;
    return NextResponse.json(
      {
        found: points.length > 0,
        source,
        entity,
        metric,
        ...(first !== undefined ? { first } : {}),
        ...(last !== undefined ? { last } : {}),
        ...(first !== undefined && last !== undefined
          ? {
              delta: Math.round((last - first) * 1000) / 1000,
              change_pct: first !== 0 ? Math.round(((last - first) / first) * 1000) / 10 : null,
            }
          : {}),
        points,
      },
      { headers: { 'cache-control': CACHE } },
    );
  }

  const limit = clampInt(params.get('limit'), 50, 1, 200);
  const conds = [
    ...(source ? [eq(metricPoints.source, source)] : []),
    ...(config.aaPublic ? [] : [notLike(metricPoints.source, 'aa%')]),
  ];
  const rows = db
    .select({
      source: metricPoints.source,
      entity: metricPoints.entity,
      metric: metricPoints.metric,
      latest: sql<string>`max(${metricPoints.date})`,
      points: sql<number>`count(*)`,
    })
    .from(metricPoints)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(metricPoints.source, metricPoints.entity, metricPoints.metric)
    .orderBy(desc(sql`max(${metricPoints.date})`))
    .limit(limit)
    .all();
  return NextResponse.json({ count: rows.length, metrics: rows }, { headers: { 'cache-control': CACHE } });
}
