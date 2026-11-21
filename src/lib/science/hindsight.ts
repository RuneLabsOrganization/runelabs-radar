import { and, asc, count, desc, eq, gte, isNull, lt, lte, ne } from 'drizzle-orm';
import { getDb } from '../db';
import { launches, stories, votes } from '../db/schema';
import { titleSimilarity } from '../curate/cluster';
import { clamp } from '../stats';

/** Stories enter the hindsight window at 36h and leave at 60h. */
export const RESCORE_MIN_AGE_MS = 36 * 36e5;
export const RESCORE_MAX_AGE_MS = 60 * 36e5;
/** Echoes/launches stop counting 5 days after the story — the full observation window. */
export const OBSERVATION_WINDOW_MS = 5 * 864e5;
/**
 * Most in-window stories one rescore run will grade. The job runs HOURLY, so
 * the 24h window gets ~24 passes at this cap — far above curated volume. (It
 * used to run once a day capped at 120 while ~200 stories/day were curated:
 * everything past the first 120 aged out of the window ungraded, which is how
 * the trust page ended up at ~35% coverage with a five-figure backlog.)
 */
export const RESCORE_DAILY_CAP = 400;
/**
 * Most past-window (backlog) stories one run will catch up on. Backlog grades
 * are reconstructed AS OF createdAt + BACKLOG_GRADE_AGE_MS (see runRescore),
 * so a late grade sees what an on-time grade would have seen.
 */
export const RESCORE_BACKLOG_CAP = 400;
/** The as-of age a backlog story is graded at — the middle of the 36–60h window. */
export const BACKLOG_GRADE_AGE_MS = 48 * 36e5;

/**
 * The hindsight weights — the single source of truth. The trust page imports
 * these; a pinning test fails if they ever move without the page noticing.
 */
export const HINDSIGHT_WEIGHTS = {
  /** Later stories mention the same entities, idf-discounted (see below). */
  entityEcho: { max: 30, fullMarksAt: 5 },
  /** A tracked launch (Show HN / Product Hunt) ships a named entity. */
  launch: 25,
  /** Later stories develop the same topic (Jaccard 0.3–0.55: same topic, not a dupe). */
  followThrough: { max: 25, fullMarksAt: 5 },
  /** Net human votes (up − down) × perNetVote, capped ±cap. */
  votes: { perNetVote: 5, cap: 15 },
} as const;

/**
 * Hindsight scoring — no LLM, observed signals only. Answers "did this story
 * actually matter?" two days after curation, which calibrates the front-door
 * top_score and powers the public accuracy page.
 *
 * Weight semantics (heuristic v2, documented honestly):
 *   entity echo     up to 30 — later stories sharing an entity, each weighted
 *                   by 1/log(2 + that entity's total mentions in the window):
 *                   an echo of a rare entity is evidence, the fifth story
 *                   mentioning "openai" is mostly noise. A story contributes
 *                   its rarest shared entity's weight.
 *   launch           flat 25 — a tracked launch sharing an entity
 *   follow-through  up to 25 — later stories that develop the story WITHOUT
 *                   sharing an entity. Priority rule: a story that scores echo
 *                   never also scores follow-through (no double-counting).
 *   team votes       ±15 — net human votes × 5
 *
 * The "full marks" caps are calibrated for the full 5-day observation window,
 * but grading happens at 36–60h. The caps are therefore scaled by
 * elapsed/full-window (floored at 1): a story graded 36h in is judged against
 * what 36 hours could have produced, not against five days of follow-through
 * it never had the chance to earn.
 */
export function hindsightScore(
  story: {
    id: number;
    title: string;
    entities: string | null;
    createdAt: Date;
  },
  /**
   * The moment the grade is taken. Defaults to now (on-time grading). Backlog
   * catch-up passes createdAt + 48h so nothing observed after that moment —
   * later stories, later launches — leaks into a grade that is published as a
   * 36–60h grade. Votes carry no timestamp and always count (the human override).
   */
  asOf: Date = new Date(),
): number {
  const db = getDb();
  // the observable horizon: the full window, but never past the grading moment
  const horizon = new Date(Math.min(story.createdAt.getTime() + OBSERVATION_WINDOW_MS, asOf.getTime()));

  let names: string[] = [];
  try {
    names = (JSON.parse(story.entities ?? '[]') as { name: string }[]).map((e) => e.name.toLowerCase());
  } catch {
    /* no entities */
  }

  // bounded: echoes past 5 days stop being evidence for a 2-day-old story,
  // and the load must never grow with total history
  const later = db
    .select({ id: stories.id, title: stories.title, entities: stories.entities })
    .from(stories)
    .where(
      and(
        gte(stories.createdAt, story.createdAt),
        lte(stories.createdAt, horizon),
        ne(stories.id, story.id),
      ),
    )
    .limit(3000)
    .all();

  const parsed = later.map((s) => {
    let other: string[] = [];
    try {
      other = (JSON.parse(s.entities ?? '[]') as { name: string }[]).map((e) => e.name.toLowerCase());
    } catch {
      /* no entities */
    }
    return { title: s.title, names: other };
  });

  // idf-style discount: an echo of a rare entity is evidence; the tenth story
  // mentioning "openai" is mostly noise. Popularity = the entity's total
  // mentions across the observation window AND the 5 days before it — an
  // entity that was already everywhere when the story landed gets discounted
  // even if only a few of those mentions came after.
  const popular = db
    .select({ entities: stories.entities })
    .from(stories)
    .where(
      and(
        gte(stories.createdAt, new Date(story.createdAt.getTime() - OBSERVATION_WINDOW_MS)),
        lte(stories.createdAt, horizon),
        ne(stories.id, story.id),
      ),
    )
    .limit(3000)
    .all();
  const mentions = new Map<string, number>();
  for (const s of popular) {
    try {
      const other = (JSON.parse(s.entities ?? '[]') as { name: string }[]).map((e) => e.name.toLowerCase());
      for (const n of new Set(other)) mentions.set(n, (mentions.get(n) ?? 0) + 1);
    } catch {
      /* skip */
    }
  }
  const entityWeight = (n: string) => 1 / Math.log(2 + (mentions.get(n) ?? 0));

  let echoWeight = 0;
  let followThrough = 0;
  for (const p of parsed) {
    const shared = names.filter((n) => p.names.includes(n));
    if (shared.length > 0) {
      // rarest shared entity carries the evidence; one story counts once
      echoWeight += Math.max(...shared.map(entityWeight));
      continue; // priority rule: an echo is never also follow-through
    }
    const sim = titleSimilarity(story.title, p.title);
    if (sim >= 0.3 && sim < 0.55) followThrough++;
  }

  // launch materialization: a launch sharing an entity, after the story
  let materialized = 0;
  if (names.length > 0) {
    const rows = db
      .select({ title: launches.title })
      .from(launches)
      .where(
        and(
          gte(launches.launchedAt, story.createdAt),
          lte(launches.launchedAt, horizon),
          // a launch we had not ingested yet was not observable at grading time
          lte(launches.createdAt, asOf),
        ),
      )
      .limit(1000)
      .all();
    materialized = rows.some((r) => names.some((n) => n.length >= 3 && r.title.toLowerCase().includes(n))) ? 1 : 0;
  }

  const net =
    db
      .select({ value: votes.value })
      .from(votes)
      .where(eq(votes.storyId, story.id))
      .all()
      .reduce((acc, v) => acc + v.value, 0) ?? 0;

  // caps scale with the elapsed share of the observation window (floor 1)
  const elapsedRatio = clamp((asOf.getTime() - story.createdAt.getTime()) / OBSERVATION_WINDOW_MS, 0, 1);
  const echoCap = Math.max(1, HINDSIGHT_WEIGHTS.entityEcho.fullMarksAt * elapsedRatio);
  const followCap = Math.max(1, HINDSIGHT_WEIGHTS.followThrough.fullMarksAt * elapsedRatio);

  const score =
    Math.min(1, echoWeight / echoCap) * HINDSIGHT_WEIGHTS.entityEcho.max +
    materialized * HINDSIGHT_WEIGHTS.launch +
    Math.min(1, followThrough / followCap) * HINDSIGHT_WEIGHTS.followThrough.max +
    Math.max(
      -HINDSIGHT_WEIGHTS.votes.cap,
      Math.min(HINDSIGHT_WEIGHTS.votes.cap, net * HINDSIGHT_WEIGHTS.votes.perNetVote),
    );

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Hourly job. Two passes, in-window first:
 *
 * 1. ON TIME — curated stories inside the 36–60h window without a grade,
 *    OLDEST first (the ones about to age out go first), up to
 *    RESCORE_DAILY_CAP. Graded as of now.
 * 2. CATCH-UP — curated stories already past 60h without a grade (missed by
 *    downtime or an overflowing run), NEWEST first, up to RESCORE_BACKLOG_CAP.
 *    Graded as of createdAt + 48h, so a late grade is the grade the story
 *    would have got on time, not a 5-day grade mislabelled as a 2-day one.
 *
 * Idempotent (skips graded rows). Returns what it graded and what is still
 * waiting: `backlog` = in-window overflow + past-window stories not reached.
 */
export async function runRescore(): Promise<{ scored: number; caughtUp: number; backlog: number }> {
  const db = getDb();
  const now = Date.now();
  const due = db
    .select()
    .from(stories)
    .where(
      and(
        eq(stories.status, 'curated'),
        isNull(stories.hindsight),
        lte(stories.createdAt, new Date(now - RESCORE_MIN_AGE_MS)),
        gte(stories.createdAt, new Date(now - RESCORE_MAX_AGE_MS)),
      ),
    )
    .orderBy(asc(stories.createdAt))
    .all();

  const batch = due.slice(0, RESCORE_DAILY_CAP);
  for (const s of batch) {
    db.update(stories)
      .set({ hindsight: hindsightScore(s), hindsightAt: new Date() })
      .where(eq(stories.id, s.id))
      .run();
  }

  const pastWindow = and(
    eq(stories.status, 'curated'),
    isNull(stories.hindsight),
    lt(stories.createdAt, new Date(now - RESCORE_MAX_AGE_MS)),
  );
  // bounded read — the backlog can be five figures; only this run's slice is loaded
  const missedTotal = db.select({ n: count() }).from(stories).where(pastWindow).get()?.n ?? 0;
  const catchUp = db
    .select()
    .from(stories)
    .where(pastWindow)
    .orderBy(desc(stories.createdAt))
    .limit(RESCORE_BACKLOG_CAP)
    .all();
  for (const s of catchUp) {
    const asOf = new Date(s.createdAt.getTime() + BACKLOG_GRADE_AGE_MS);
    db.update(stories)
      .set({ hindsight: hindsightScore(s, asOf), hindsightAt: new Date() })
      .where(eq(stories.id, s.id))
      .run();
  }

  return {
    scored: batch.length,
    caughtUp: catchUp.length,
    backlog: due.length - batch.length + (missedTotal - catchUp.length),
  };
}
