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
import { CURATION_WINDOW_MS } from '../curate/cluster';
import { pollMinutesFor } from './ingest';
import { MIN_SAMPLE, sourceVerdict, type SourceWindowStats } from './quality';

const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, v) => a + v, 0) / values.length;
}

/** Lenient config parse for cadence reads; malformed JSON falls back to the default cadence. */
function readConfig(config: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(config);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Sample bar scaled to the source's poll cadence: a source polled every 30min
 * gets the full MIN_SAMPLE, a weekly newsletter can't possibly reach 20 items
 * in 30d and would sit in 'watch' forever — floor of 4 keeps the bar meaningful.
 */
export function minSampleFor(pollMinutes: number): number {
  const expectedPolls = (WINDOW_DAYS * 24 * 60) / pollMinutes;
  return Math.max(4, Math.min(MIN_SAMPLE, Math.round(expectedPolls)));
}

/**
 * Per-source rollup accumulator. Counts (fetched/used/curated) are per item —
 * they measure yield. Scores and hindsights are keyed by storyId so the MEANS
 * weight stories, not items: a story covered by 5 items from one feed is one
 * signal, not five votes for its score.
 */
interface SourceAcc {
  fetched: number;
  used: number;
  curated: number;
  /** items inside the curation window or on a 'raw' story — pipeline backlog, not judged yet */
  pending: number;
  /** oldest fetchedAt seen, for the source-age proxy */
  oldestFetchedAt: number | null;
  scores: Map<number, number>;
  hindsights: Map<number, number>;
}

function emptyAcc(): SourceAcc {
  return { fetched: 0, used: 0, curated: 0, pending: 0, oldestFetchedAt: null, scores: new Map(), hindsights: new Map() };
}

export async function runSourceReview(): Promise<{ reviewed: number; drop: number; demote: number }> {
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
  const curationCutoff = Date.now() - CURATION_WINDOW_MS;
  const windowEnd = utcDay();
  const now = new Date();

  const rows = db
    .select({
      sourceId: items.sourceId,
      storyId: items.storyId,
      fetchedAt: items.fetchedAt,
      status: stories.status,
      topScore: stories.topScore,
      hindsight: stories.hindsight,
    })
    .from(items)
    .leftJoin(stories, eq(items.storyId, stories.id))
    .where(gte(items.fetchedAt, since))
    .all();

  const bySource = new Map<number, SourceAcc>();
  for (const r of rows) {
    const acc = bySource.get(r.sourceId) ?? emptyAcc();
    acc.fetched += 1;
    if (acc.oldestFetchedAt === null || r.fetchedAt.getTime() < acc.oldestFetchedAt) {
      acc.oldestFetchedAt = r.fetchedAt.getTime();
    }
    if (r.storyId !== null) acc.used += 1;
    // still awaiting judgement: inside the curation window (curation may yet
    // pick it up) or sitting on a 'raw' story (curated or filtered later)
    if (r.fetchedAt.getTime() >= curationCutoff || r.status === 'raw') acc.pending += 1;
    if (r.status === 'curated' && r.storyId !== null) {
      acc.curated += 1;
      acc.scores.set(r.storyId, r.topScore ?? 0);
      if (r.hindsight !== null && r.hindsight !== undefined) acc.hindsights.set(r.storyId, r.hindsight);
    }
    bySource.set(r.sourceId, acc);
  }

  // Every source gets a row, including ones that ingested nothing — silence is
  // exactly the signal we are trying to surface.
  const all = db.select({ id: sources.id, config: sources.config }).from(sources).all();
  let drop = 0;
  let demote = 0;

  for (const s of all) {
    const acc = bySource.get(s.id) ?? emptyAcc();
    const pollMinutes = pollMinutesFor(readConfig(s.config));
    const stats: SourceWindowStats = {
      fetched: acc.fetched,
      used: acc.used,
      curated: acc.curated,
      pending: acc.pending,
      graded: acc.hindsights.size,
      sourceAgeDays:
        acc.oldestFetchedAt === null ? null : (now.getTime() - acc.oldestFetchedAt) / DAY_MS,
      meanTopScore: mean([...acc.scores.values()]),
      meanHindsight: mean([...acc.hindsights.values()]),
      minSample: minSampleFor(pollMinutes),
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
