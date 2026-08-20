import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { boardEntries } from '@/lib/db/schema';
import { isDomain } from '@/lib/domains';
import { rateLimited } from '@/lib/api-limit';

/**
 * Public read-only API v1 (Phase 10): the cost-benefit board — the same query
 * behind the MCP get_best_right_now tool, grouped by domain for direct
 * consumption. No auth; per-IP rate limit + CDN caching.
 */

const CACHE = 'public, s-maxage=60, stale-while-revalidate=300';

interface BoardEntry {
  task: string;
  best_overall: string | null;
  best_value: string | null;
  cheapest_viable: string | null;
  cost_note: string | null;
  verdict: string | null;
  updated_at: string | null;
}

export async function GET(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const domain = new URL(req.url).searchParams.get('domain');
  if (domain !== null && !isDomain(domain)) {
    return NextResponse.json({ error: `unknown domain '${domain}'` }, { status: 400 });
  }

  const db = getDb();
  const rows = db
    .select()
    .from(boardEntries)
    .where(domain ? eq(boardEntries.domain, domain) : undefined)
    .orderBy(boardEntries.domain, boardEntries.task)
    .all();
  const board: Record<string, BoardEntry[]> = {};
  for (const r of rows) {
    (board[r.domain] ??= []).push({
      task: r.task,
      best_overall: r.bestOverall ?? null,
      best_value: r.bestValue ?? null,
      cheapest_viable: r.cheapestViable ?? null,
      cost_note: r.costNote ?? null,
      verdict: r.runelabsVerdict ?? null,
      updated_at: r.updatedAt ? r.updatedAt.toISOString() : null,
    });
  }
  return NextResponse.json({ count: rows.length, board }, { headers: { 'cache-control': CACHE } });
}
