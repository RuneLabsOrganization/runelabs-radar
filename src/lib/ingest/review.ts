/**
 * Periodic source review: turn 30 days of ingest into one persisted judgement
 * per source. This is the feedback loop the yield number never had — the point
 * is that a zero-yield feed becomes visible without anyone remembering to look.
 *
 * Idempotent: re-running on the same UTC day overwrites that day's row.
 */
import { eq, gte } from 'drizzle-orm';
import { getDb } from '../db';
import { items, sourceQuality, sources, stories } from '../db/schema';
import { utcDay } from '../metrics';
import { sourceVerdict, type SourceWindowStats } from './quality';

const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, v) => a + v, 0) / values.length;
}

export async function runSourceReview(): Promise<{ reviewed: number; drop: number; demote: number }> {
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
  const windowEnd = utcDay();
  const now = new Date();

  const rows = db
    .select({
      sourceId: items.sourceId,
      storyId: items.storyId,
      status: stories.status,
      topScore: stories.topScore,
      hindsight: stories.hindsight,
    })
    .from(items)
    .leftJoin(stories, eq(items.storyId, stories.id))
    .where(gte(items.fetchedAt, since))
    .all();

  const bySource = new Map<number, { fetched: number; used: number; curated: number; scores: number[]; hindsights: number[] }>();
  for (const r of rows) {
    const acc = bySource.get(r.sourceId) ?? { fetched: 0, used: 0, curated: 0, scores: [], hindsights: [] };
    acc.fetched += 1;
    if (r.storyId !== null) acc.used += 1;
    if (r.status === 'curated') {
      acc.curated += 1;
      acc.scores.push(r.topScore ?? 0);
      if (r.hindsight !== null && r.hindsight !== undefined) acc.hindsights.push(r.hindsight);
    }
    bySource.set(r.sourceId, acc);
  }

  // Every source gets a row, including ones that ingested nothing — silence is
  // exactly the signal we are trying to surface.
  const all = db.select({ id: sources.id }).from(sources).all();
  let drop = 0;
  let demote = 0;

  for (const s of all) {
    const acc = bySource.get(s.id) ?? { fetched: 0, used: 0, curated: 0, scores: [], hindsights: [] };
    const stats: SourceWindowStats = {
      fetched: acc.fetched,
      used: acc.used,
      curated: acc.curated,
      meanTopScore: mean(acc.scores),
      meanHindsight: mean(acc.hindsights),
    };
    const { verdict, reason } = sourceVerdict(stats);
    if (verdict === 'drop') drop += 1;
    if (verdict === 'demote') demote += 1;

    db.insert(sourceQuality)
      .values({
        sourceId: s.id,
        windowEnd,
        windowDays: WINDOW_DAYS,
        fetched: stats.fetched,
        used: stats.used,
        curated: stats.curated,
        meanTopScore: stats.meanTopScore,
        meanHindsight: stats.meanHindsight,
        verdict,
        reason,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [sourceQuality.sourceId, sourceQuality.windowEnd, sourceQuality.windowDays],
        set: {
          fetched: stats.fetched,
          used: stats.used,
          curated: stats.curated,
          meanTopScore: stats.meanTopScore,
          meanHindsight: stats.meanHindsight,
          verdict,
          reason,
          createdAt: now,
        },
      })
      .run();
  }

  return { reviewed: all.length, drop, demote };
}
