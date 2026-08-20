import { and, desc, eq, gt } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { stories } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { DOMAIN_MEMBERSHIP_THRESHOLD, isDomain } from '@/lib/domains';
import { rateLimited } from '@/lib/api-limit';

/**
 * Public read-only API v1 (Phase 10): recent curated stories — the same query
 * behind the MCP get_top_signals tool, minus the agent envelope. No auth;
 * per-IP rate limit + CDN caching are the operating model.
 */

const CACHE = 'public, s-maxage=60, stale-while-revalidate=300';

function clampInt(raw: string | null, dflt: number, min: number, max: number): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.floor(n), min), max);
}

/** Parse a JSON text column with a fallback; never throws. */
function parseJsonColumn<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function GET(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const params = new URL(req.url).searchParams;
  const limit = clampInt(params.get('limit'), 10, 1, 50);
  const hours = clampInt(params.get('hours'), 72, 1, 720);
  const domain = params.get('domain');
  if (domain !== null && !isDomain(domain)) {
    return NextResponse.json({ error: `unknown domain '${domain}'` }, { status: 400 });
  }

  const db = getDb();
  const rows = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(Date.now() - hours * 36e5))))
    .orderBy(desc(stories.topScore))
    .limit(200)
    .all();
  const signals = rows
    .map((s) => ({ s, scores: parseJsonColumn<Record<string, number>>(s.domainScores, {}) }))
    .filter((x) => !domain || (x.scores[domain] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD)
    .slice(0, limit)
    .map(({ s, scores }) => ({
      id: s.id,
      title: s.title,
      score: domain ? (scores[domain] ?? 0) : s.topScore,
      tldr: s.tldr ?? null,
      why_it_matters: s.whyItMatters ?? null,
      created_at: s.createdAt.toISOString(),
      url: `${config.siteUrl}/story/${s.id}`,
    }));
  return NextResponse.json(
    { window_hours: hours, domain: domain ?? 'all', count: signals.length, signals },
    { headers: { 'cache-control': CACHE } },
  );
}
