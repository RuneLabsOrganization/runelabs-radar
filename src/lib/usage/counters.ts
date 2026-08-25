/**
 * Durable fixed-window counters for rate limits and per-feature caps.
 *
 * Replaces the module-level Maps that previously lived in mcp/server.ts and
 * mcp/tools/scout.ts: those reset on deploy and are wrong the moment a second
 * replica exists. One row per (bucket, feature, windowStart); reads and writes
 * are a single statement each.
 *
 * Windows are UTC-aligned so a quota never wobbles with the server timezone.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { usageCounters } from '../db/schema';

export type CounterWindow = 'hour' | 'day';

/** Rows older than this are garbage — no window in use is longer than a day. */
const RETENTION_MS = 2 * 864e5;

/** UTC-aligned start of the window containing `now`. */
export function windowStart(window: CounterWindow, now: Date = new Date()): Date {
  if (window === 'hour') {
    return new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(),
    ));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Increment and return the new count for this bucket/feature/window. */
export function bump(
  bucket: string,
  feature: string,
  window: CounterWindow,
  now: Date = new Date(),
): number {
  const db = getDb();
  const start = windowStart(window, now);
  db.insert(usageCounters)
    .values({ bucket, feature, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.bucket, usageCounters.feature, usageCounters.windowStart],
      set: { count: sql`${usageCounters.count} + 1` },
    })
    .run();
  return peek(bucket, feature, window, now);
}

/** Current count without incrementing. Zero when the window has rolled over. */
export function peek(
  bucket: string,
  feature: string,
  window: CounterWindow,
  now: Date = new Date(),
): number {
  const row = getDb()
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.bucket, bucket),
        eq(usageCounters.feature, feature),
        eq(usageCounters.windowStart, windowStart(window, now)),
      ),
    )
    .get();
  return row?.count ?? 0;
}

/** Drop expired rows so a flood of unique buckets cannot grow the table forever. */
export function gcCounters(now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const res = getDb().delete(usageCounters).where(lt(usageCounters.windowStart, cutoff)).run();
  return res.changes;
}
