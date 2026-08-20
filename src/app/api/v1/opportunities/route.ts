import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { rateLimited } from '@/lib/api-limit';

/**
 * Public read-only API v1 (Phase 10): active opportunities — the same query
 * behind the MCP get_opportunities tool, minus the agent envelope and the
 * per-caller salting (a shared cached response can't be per-caller anyway).
 * No auth; per-IP rate limit + CDN caching.
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

  const limit = clampInt(new URL(req.url).searchParams.get('limit'), 10, 1, 50);

  const db = getDb();
  const rows = db
    .select()
    .from(opportunities)
    .where(eq(opportunities.status, 'active'))
    .orderBy(desc(opportunities.flipScore))
    .limit(limit)
    .all();
  return NextResponse.json(
    {
      count: rows.length,
      opportunities: rows.map((o) => ({
        slug: o.slug,
        title: o.title,
        sector: o.sector ?? null,
        window: o.window ?? null,
        flip_score: o.flipScore,
        hold_score: o.holdScore,
        exploring_count: o.planRuns,
        verdict: o.verdict,
        confidence: o.confidence,
        thesis: o.thesis,
        has_brief: o.brief !== null,
        has_plan: o.plan !== null,
        first_seen: o.firstSeenAt.toISOString(),
        url: `${config.siteUrl}/opportunities`,
      })),
    },
    { headers: { 'cache-control': CACHE } },
  );
}
